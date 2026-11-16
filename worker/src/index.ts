// Poker Ledger's sync API. Runs on Cloudflare Workers, stores rows in D1.
//
// This Worker is storage, not a participant. It never reads the meaning of a
// session: every figure in the app is computed in the browser, and
// this file only moves opaque JSON `payload`s in and out of one generic
// `records` table. There are no permissions to model and no fields to validate
// the meaning of.
//
// A sync PASSWORD gates it — the client derives an auth hash from the password
// and presents it as a bearer token, exactly as the sibling Vault does. Unlike
// Vault, the payloads here are plaintext JSON rather than ciphertext: a
// deliberate, lower-stakes trade for a personal ledger on your own account, in
// exchange for a password you can reset without losing everything.
//
// D1 rather than KV deliberately: KV is eventually consistent (up to 60s), and
// the client mutates then refetches. On KV a just-saved session would
// intermittently vanish on the next pull, which reads as "did that save?".

export type Env = {
  DB: D1Database
  /** Comma-separated origins allowed to call this Worker. */
  ALLOWED_ORIGINS: string
}

type MetaRow = {
  salt: string
  auth_hash_hash: string
  kdf_iterations: number
}

const json = (body: unknown, status = 200, origin?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors(origin) },
  })

const fail = (message: string, status: number, origin?: string) =>
  json({ error: message }, status, origin)

// ---------------------------------------------------------------- CORS

function cors(origin?: string): Record<string, string> {
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    // Caches must not serve one origin's response to another.
    vary: 'Origin',
  }
}

/**
 * Exact-match allowlist. No wildcards and no suffix matching: `*.vercel.app`
 * would let anyone's preview deployment call your log, and endsWith checks
 * are defeated by `evil-yourdomain.com`.
 */
function allowedOrigin(request: Request, env: Env): string | undefined {
  const origin = request.headers.get('Origin')
  if (!origin) return undefined
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  return allowed.includes(origin) ? origin : undefined
}

// ---------------------------------------------------------------- auth

const encoder = new TextEncoder()

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Compared in constant time so response latency can't be used to guess the token. */
function safeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a)
  const bb = encoder.encode(b)
  if (ab.byteLength !== bb.byteLength) return false
  return crypto.subtle.timingSafeEqual(ab, bb)
}

async function getMeta(env: Env): Promise<MetaRow | null> {
  return env.DB.prepare(
    'select salt, auth_hash_hash, kdf_iterations from sync_meta where id = 1',
  ).first<MetaRow>()
}

/**
 * True when the bearer token matches. The token is the auth hash the client
 * derives from the sync password — a PBKDF2 output, not the password itself.
 */
async function authenticate(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return false
  const meta = await getMeta(env)
  if (!meta) return false
  const presented = await sha256Hex(header.slice('Bearer '.length))
  return safeEqual(presented, meta.auth_hash_hash)
}

// ---------------------------------------------------------------- routes

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request, env)

    if (request.method === 'OPTIONS') {
      // Preflight from an origin we don't allow gets no CORS headers, so the
      // browser blocks the real request before it is ever sent.
      return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) })
    }
    if (request.headers.get('Origin') && !origin) {
      return fail('Origin not allowed', 403)
    }

    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    try {
      return await route(request, env, url, path, origin)
    } catch (err) {
      // Never echo the error back: D1 messages can quote the SQL and the row
      // values that failed.
      console.error('poker-ledger worker error', err)
      return fail('Internal error', 500, origin)
    }
  },
} satisfies ExportedHandler<Env>

async function route(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  origin?: string,
): Promise<Response> {
  const { method } = request

  // Liveness only. Deliberately says nothing about whether a log exists.
  if (path === '/' && method === 'GET') {
    return json({ ok: true, service: 'poker-ledger' }, 200, origin)
  }

  // ---- the salt, served to anyone ----
  // Unauthenticated of necessity: without it the client cannot derive the token
  // it would authenticate with. A salt is not a secret. Returns null before the
  // first signup, which is how the client knows to show "set a password".
  if (path === '/salt' && method === 'GET') {
    const meta = await getMeta(env)
    if (!meta) return json(null, 200, origin)
    return json({ salt: meta.salt, kdfIterations: meta.kdf_iterations }, 200, origin)
  }

  // ---- signup: first caller claims the log, forever ----
  if (path === '/signup' && method === 'POST') {
    const { salt, authHash } = (await request.json()) as { salt?: string; authHash?: string }
    if (!salt || !authHash) return fail('salt and authHash are required', 400, origin)
    // Length-checked so a client bug can't quietly claim the store with a weak
    // or empty salt.
    if (salt.length < 40) return fail('Salt is too short', 400, origin)

    if (await getMeta(env)) {
      return fail('This ledger is already set up. Unlock it instead.', 409, origin)
    }
    await env.DB.prepare(
      'insert into sync_meta (id, salt, auth_hash_hash, kdf_iterations, created_at) values (1, ?, ?, ?, ?)',
    )
      .bind(salt, await sha256Hex(authHash), 650000, new Date().toISOString())
      .run()
    return json({ ok: true }, 201, origin)
  }

  // ---- login: verify the token before the client trusts its own password ----
  if (path === '/login' && method === 'POST') {
    const { authHash } = (await request.json()) as { authHash?: string }
    if (!authHash) return fail('authHash is required', 400, origin)

    const meta = await getMeta(env)
    const invalid = fail('Wrong sync password', 401, origin)
    if (!meta) return invalid
    if (!safeEqual(await sha256Hex(authHash), meta.auth_hash_hash)) return invalid

    return json({ ok: true }, 200, origin)
  }

  // Everything past here requires the bearer token.
  if (!(await authenticate(request, env))) return fail('Unauthorized', 401, origin)

  // ---- change the sync password ----
  //
  // No re-encryption to do (payloads are plaintext), so this is a one-column
  // update. Requires the token, so only someone already signed in can rotate it.
  if (path === '/auth-password' && method === 'PUT') {
    const { authHash } = (await request.json()) as { authHash?: string }
    if (!authHash) return fail('authHash is required', 400, origin)
    await env.DB.prepare('update sync_meta set auth_hash_hash = ? where id = 1')
      .bind(await sha256Hex(authHash))
      .run()
    return json({ ok: true }, 200, origin)
  }

  // ---- pull: one store's rows changed at or after the cursor ----
  //
  // Per-table and cursor-based so the client's existing sync loop is unchanged.
  // Tombstones (deleted_at set) ARE returned — that is how a delete reaches
  // another device. `since` uses >=, not >, because two rows can share a
  // millisecond and > would skip the second one forever.
  if (path === '/pull' && method === 'GET') {
    const table = url.searchParams.get('table')
    const since = url.searchParams.get('since')
    if (!table) return fail('table is required', 400, origin)

    const query = since
      ? env.DB.prepare(
        'select id, payload, updated_at, deleted_at from records where table_name = ? and updated_at >= ? order by updated_at asc',
      ).bind(table, since)
      : env.DB.prepare(
        'select id, payload, updated_at, deleted_at from records where table_name = ? order by updated_at asc',
      ).bind(table)

    const { results } = await query.all<{
      id: string
      payload: string
      updated_at: string
      deleted_at: string | null
    }>()

    return json(
      results.map((r) => ({
        id: r.id,
        payload: r.payload,
        updatedAt: r.updated_at,
        deletedAt: r.deleted_at,
      })),
      200,
      origin,
    )
  }

  // ---- push: batch upsert one store's rows ----
  //
  // Server-side last-write-wins: the DO UPDATE only fires when the incoming
  // row is at least as new as the stored one. Without this guard, two devices
  // pushing concurrently could let an older write clobber a newer one — the
  // client resolves LWW on pull, but the server is the last line for a race
  // between two pushes.
  if (path === '/push' && method === 'POST') {
    const body = (await request.json()) as {
      table?: string
      records?: { id: string; payload: string; updatedAt: string; deletedAt: string | null }[]
    }
    if (!body.table || !Array.isArray(body.records)) {
      return fail('table and records are required', 400, origin)
    }
    if (body.records.length === 0) return json({ ok: true }, 200, origin)

    const stmt = env.DB.prepare(
      `insert into records (table_name, id, payload, updated_at, deleted_at)
       values (?, ?, ?, ?, ?)
       on conflict(table_name, id) do update set
         payload = excluded.payload,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at
       where excluded.updated_at >= records.updated_at`,
    )
    await env.DB.batch(
      body.records.map((r) =>
        stmt.bind(body.table, r.id, r.payload, r.updatedAt, r.deletedAt ?? null)),
    )
    return json({ ok: true }, 200, origin)
  }

  return fail('Not found', 404, origin)
}
