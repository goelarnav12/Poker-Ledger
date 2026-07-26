// ---------------------------------------------------------------------------
// rates.js — live exchange rates.
//
// The only file that talks to the FX network, and the only one that touches
// localStorage. No DOM: app.js renders, this fetches. stats.js stays pure and
// never learns that rates can come from anywhere but a number handed to it.
//
// The rate a session is VALUED at is frozen on the session row (`fxRate`, see
// migration_006). Everything here exists to prefill that field for a new
// session — nothing in this file can change what a saved session is worth.
//
// Loaded between stats.js and app.js. Nothing here runs at load time, which is
// what lets tests.html load it and exercise the pure parts with no network.
// ---------------------------------------------------------------------------

// Frankfurter: European Central Bank reference rates, no API key, no rate
// limit worth worrying about, and CORS open to any origin. Chosen over the
// alternatives because the payload is tiny (you name the symbols you want) and
// because it returns the DATE its rates are from, which matters — the ECB
// publishes on working days only, so a Sunday fetch is legitimately Friday's
// number and the UI should say so rather than imply it is live to the minute.
const RATES_ENDPOINT = 'https://api.frankfurter.dev/v1/latest';

const RATES_CACHE_KEY = 'pokerLedger.rates.v1';

// Refetch at most twice a day. ECB publishes once per working day, so anything
// more frequent is just noise — and a cached rate means the form still
// prefills sensibly with no signal, which a PWA has to handle.
const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const RATES_TIMEOUT_MS = 8000;

/**
 * Turn a Frankfurter payload into "units of base per one unit of X".
 *
 * The API quotes the inverse of what this app wants: asking for base=INR gives
 * `{ USD: 0.01036 }`, meaning one rupee buys 0.01036 dollars. A ledger in
 * rupees needs the other direction — one dollar is 96.5 rupees — so every
 * quote is inverted. Getting this backwards would understate a foreign session
 * by four orders of magnitude, which is exactly why it is a named, tested
 * function rather than a `1 /` buried in a fetch handler.
 *
 * Pure. Bad or zero quotes are dropped rather than turned into Infinity.
 */
function invertQuotes(quotes, base) {
  const out = {};
  if (base) out[base] = 1;                 // a currency is always 1 of itself
  for (const [code, quote] of Object.entries(quotes || {})) {
    const n = Number(quote);
    if (!isFinite(n) || n <= 0) continue;
    out[code] = 1 / n;
  }
  return out;
}

/** Shape a fetched payload into what the cache and the app consume. */
function ratesFromPayload(payload, base) {
  if (!payload || typeof payload !== 'object') return null;
  const rates = invertQuotes(payload.rates, base);
  // Just the base and nothing else means the request returned no usable quote.
  if (Object.keys(rates).length <= 1) return null;
  return { base, rates, date: payload.date || null, fetchedAt: Date.now() };
}

function readCache() {
  try {
    const raw = localStorage.getItem(RATES_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    // A cache from a different base currency values everything wrongly; drop it.
    return c && c.rates && c.base === baseCurrency() ? c : null;
  } catch {
    return null;
  }
}

function writeCache(c) {
  try {
    localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(c));
  } catch {
    // Private mode, or a full quota. Rates just aren't cached; not fatal.
  }
}

function cacheIsFresh(c) {
  return !!c && typeof c.fetchedAt === 'number' &&
    Date.now() - c.fetchedAt < RATES_MAX_AGE_MS;
}

/** The currencies worth asking for: everything in FX_RATES except the base. */
function wantedCodes() {
  return Object.keys(ACTIVE_RATES_CODES()).filter((c) => c !== baseCurrency());
}

// Indirection so this file doesn't reach into config.js directly — the codes
// come from the same map that builds the currency dropdown, so the two can
// never drift.
function ACTIVE_RATES_CODES() {
  return typeof FX_RATES !== 'undefined' ? FX_RATES : { [baseCurrency()]: 1 };
}

let inFlight = null;

/**
 * Fetch fresh rates. Resolves to null on any failure — no signal, a timeout, a
 * 500, an unsupported base currency. Callers fall back to the cache and then
 * to the static config values, so a failed fetch degrades to exactly the
 * behaviour this app had before live rates existed.
 */
async function fetchRates() {
  const codes = wantedCodes();
  if (!codes.length) return null;
  const url = `${RATES_ENDPOINT}?base=${encodeURIComponent(baseCurrency())}` +
              `&symbols=${encodeURIComponent(codes.join(','))}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(RATES_TIMEOUT_MS) });
    if (!res.ok) return null;
    const shaped = ratesFromPayload(await res.json(), baseCurrency());
    if (shaped) writeCache(shaped);
    return shaped;
  } catch {
    return null;
  }
}

/**
 * The best rates available, fetching only when the cache has gone stale.
 *
 * Concurrent callers share one request — the form asks on open and on every
 * currency change, and three overlapping fetches for the same numbers would be
 * rude to a free service.
 */
async function ensureRates() {
  const cached = readCache();
  if (cacheIsFresh(cached)) return cached;
  if (!inFlight) inFlight = fetchRates().finally(() => { inFlight = null; });
  // A failed refresh still beats nothing: a rate from yesterday prefills far
  // better than a rate from whenever config.js was last edited by hand.
  return (await inFlight) || cached;
}

/** Force a refetch, for the ↻ button. Returns null if it failed. */
async function refreshRates() {
  if (!inFlight) inFlight = fetchRates().finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * The rate to prefill for `cur`, and where it came from — the UI says which,
 * because "12.30, live, 24 Jul" and "11.15, from config.js" deserve different
 * amounts of trust.
 */
function prefillRate(cur, snapshot) {
  if (cur === baseCurrency()) return { rate: 1, source: 'base', date: null };
  const live = snapshot && snapshot.rates ? snapshot.rates[cur] : undefined;
  if (typeof live === 'number' && isFinite(live) && live > 0) {
    return {
      rate: live,
      source: cacheIsFresh(snapshot) ? 'live' : 'cached',
      date: snapshot.date || null,
    };
  }
  const stat = ACTIVE_RATES_CODES()[cur];
  if (typeof stat === 'number' && isFinite(stat) && stat > 0) {
    return { rate: stat, source: 'config', date: null };
  }
  return { rate: null, source: 'unknown', date: null };
}

/** Rates are money: four decimals, and no exponent notation in the input. */
function formatRate(n) {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '';
  return String(Math.round(n * 10000) / 10000);
}
