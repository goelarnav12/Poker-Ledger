-- D1 schema. Applied with:
--   wrangler d1 execute poker-ledger --remote --file=./schema.sql
--
-- The server is storage, not a participant. It never reads the meaning of a
-- session — every figure in the app is computed in the browser, and
-- this Worker only moves opaque JSON rows in and out. So there is no relational
-- schema here mirroring the app's tables; there is one generic record store.
--
-- Unlike the sibling Vault, the `payload` here is PLAINTEXT JSON, not
-- ciphertext. That is a deliberate, lower-stakes choice for a personal ledger on
-- your own Cloudflare account (see README): the sync password gates access and
-- can be reset without losing data, where Vault trades that for zero-knowledge.

-- The password gate. Exactly one row, no username or email: there is only ever
-- one ledger, so an identifier would distinguish nothing. The first signup
-- claims it; later ones are rejected, so an endpoint open to the internet can't
-- be used by anyone else to create an account on your Worker.
create table if not exists sync_meta (
  id integer primary key check (id = 1),
  -- Random 256-bit PBKDF2 salt, base64. Served unauthenticated, because the
  -- client cannot derive its token without it. A salt is not a secret; its job
  -- is to stop one precomputed table working against every store built from
  -- this code.
  salt text not null,
  -- SHA-256 of the auth hash the client derives — NOT the auth hash itself. The
  -- client's value is already a PBKDF2 output; hashing it again means a dump of
  -- this table doesn't even yield a replayable bearer token.
  auth_hash_hash text not null,
  kdf_iterations integer not null default 650000,
  created_at text not null
);

-- One row per synced object. Poker Ledger has a single store, 'sessions'.
-- `payload` is the full camelCase domain row as JSON; the columns are only the
-- structural facts the sync loop needs — which store, which id, when touched,
-- whether tombstoned.
create table if not exists records (
  -- Which store this belongs to. Only 'sessions' today.
  table_name text not null,
  -- Client-generated id (crypto.randomUUID, or a deterministic id for
  -- recurring posts), never defaulted by the database — a row has a stable
  -- identity from the moment it exists offline, not from server acknowledgement.
  id text not null,
  payload text not null,
  -- ISO timestamp. The clock last-write-wins compares, and the cursor the
  -- incremental pull walks.
  updated_at text not null,
  -- Soft delete: a tombstone propagates the deletion to other devices instead
  -- of the row reappearing from a stale client. Kept, never hard-deleted.
  deleted_at text,
  primary key (table_name, id)
);

-- Pull is "everything changed at or after the cursor", so the cursor walks this.
create index if not exists records_updated_idx on records (updated_at);
