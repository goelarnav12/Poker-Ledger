# Poker_ledger

## Running

No build step and no package manager for the site. Static files loaded directly
by `index.html`; dependencies (`chart.js@4.4.4` plus `chartjs-adapter-date-fns`,
Google Fonts) come from CDN `<script>` tags. The one exception is `worker/`,
the Cloudflare Worker, which has its own `package.json` and deploys with
Wrangler (`npm run deploy` in `worker/`).

```sh
cd Poker_ledger && python3 -m http.server 8000   # then open http://localhost:8000
```

`file://` does not work: the password derivation (WebCrypto) and the service
worker both need http on localhost or https, and the Worker only answers the
origins in `worker/wrangler.toml` (`http://localhost:8000` is one). Use the
server, on port 8000. It talks to the LIVE ledger; for a throwaway one run
`npx wrangler dev` in `worker/` and point `API_URL` at `http://localhost:8787`
temporarily.

Tests: open `tests.html`. It loads `stats.js`, `rates.js` and `tests.js` only — no
server, no network, no framework. Reload to re-run. **Anything deterministic enough to
test belongs in `stats.js`**, and the tests pin their own FX rates via
`setCurrencyConfig()` so retuning `config.js` can't turn them red.

## Architecture

Single-page app, no framework, no modules — everything is global scope, loaded
in order: `config.js` (Worker URL + currency constants), `backend.js`,
`stats.js`, `rates.js`, `app.js`. The order is the dependency direction:
`stats.js` reads nothing below it, `backend.js` and `rates.js` may read config,
and only `app.js` touches the DOM.

**`backend.js` is the only file that talks to the server.** It holds the
password-to-token derivation (PBKDF2), the token in `localStorage`
(`pl.syncToken`), and `pullRecords` / `pushRecord`. No DOM in it.

The split is the point: **`stats.js` is pure** — no DOM, no network, no app
state, every function deterministic. `app.js` owns the DOM, the data layer and
rendering. New arithmetic goes in `stats.js` with a test; new markup goes in
`app.js`. `app.js` has no tests, which is exactly where the bugs have been.

State is module-level globals in [app.js](app.js): `authMode`,
`sessions` (the full row set, always fetched whole), the three filters
(`activeFilter`, `activeLocation`, `activeRange`), `editingId`, and the three
Chart.js instances. There is no local cache and no optimistic update — every
mutation is followed by a full `loadSessions()` + `render()`. Keep that; the
data volume is a personal ledger.

Flow: `boot()` → placeholder-config check → a saved token goes straight to
`enterApp()`, otherwise `showAuth()` shows the lock screen. `showAuth()` asks
the Worker for `/salt`: null means no password exists yet ("Set a password"),
otherwise "Unlock". A saved token is only proven by the first pull; a 401
there calls `lockApp()`. "Lock" in the footer is `lockApp()` too.

`render()` is the single entry point for all UI updates. It calls
`renderFilters()` first — which may reset a stale filter — and every figure,
chart and row after that reads through `visibleSessions()`. Each chart renderer
calls it itself rather than being handed a list; it's a pure derivation of the
same state, so the results agree.

The raw `sessions` array is still read in a handful of places, and each is
deliberate — if you're changing one, know which kind it is:

- **Describes the whole ledger, so must not narrow with a filter**:
  `renderStrap()` (the period under the masthead), the datalist suggestions,
  the chip options, and the `multiVenue` / `multiYear` flags that decide whether
  a row prints its venue and year. Deriving those last two from the filtered set
  would make columns appear and disappear as you click chips.
- **Needs the total to compare against**: the "12 of 36" counts in the filter
  note and the Sessions heading.
- **Is a backup**: CSV export, which must never be filtered.

Rows are stored whole, as camelCase JSON, exactly as the app holds them, plus
`id`, `createdAt`, `updatedAt` and `deletedAt`. `fromStored()` and `toStored()`
are the only places a stored row is shaped. Keep it there.

- **The browser makes ids and timestamps** (`crypto.randomUUID()`,
  `new Date().toISOString()`). The server defaults nothing.
- **A save rewrites the whole row** with a fresh `updatedAt`; the Worker keeps
  the copy with the later one.
- **A delete is a tombstone** (`deletedAt` set), pushed like any other row and
  filtered out in `loadSessions()`. In the UI it is still permanent.
- **No field is validated server-side.** The form's checks in `app.js` are the
  only ones.

Lists are built as HTML strings with listeners re-attached afterwards. Any
user-supplied value interpolated into a template must go through
`escapeHtml()` — it escapes quotes too, because several values land inside
attributes.

### Traps

- **Charts must be `.destroy()`ed before re-creating**, and a chart built while
  its panel is `hidden` comes out **0×0** — Chart.js measures the container at
  construction. `showTab()` therefore rebuilds all three whenever Overview is
  revealed. Don't "optimise" that away.
- **The add/edit form is one `<form>`**; `editingId` being non-null is the only
  difference. `openForm(session|null)` and `closeForm()` are the only ways to
  change that state — they also reset the title, the submit label and the
  currency-dependent amount labels.
- **Deleting is two-step**: first click arms the button for 4s, second commits.
  There is no undo. Don't make it one click.
- Tabs live in the URL hash and follow the ARIA pattern (arrows, Home/End,
  roving tabindex). Shortcuts `n` / `1` / `2` are suppressed while typing.

## Formats

One table, two formats, **one bankroll**. `session_type` is `'cash'` or
`'tournament'`; a row with neither (anything predating migration_004) is cash,
which is why `isTournament()` tests for the tournament value rather than
against the cash one.

**`totalCost()` is the single place cost is computed.** Cash is the buy-in;
a tournament is `(buy_in + fee) × entries`. `profitOf()` reads it, so every
chart, total, streak and drawdown downstream inherited tournaments for free —
that was the whole point of routing it through one function. Don't reintroduce
`cashOut - buyIn` anywhere.

A tournament reuses `stakes` for its event name, which is deliberate: it means
`stakesLabel()`, the chip filters and the by-stakes chart all work unchanged,
and it means `parseBigBlind()` returns null for tournaments without anything
having to test the type. `stakesLabel()` does skip the currency suffix for
tournaments — "Sunday Main (HKD)" reads as a different event, not a different
denomination.

**The analysis splits, the bankroll doesn't.** `computeStats` returns shared
figures over everything, plus `bb` (cash only, may be null) and `tourney`. The
hourly rate is CASH ONLY — a tournament's length is set by its structure, so
including it measures the blind levels rather than the player. `renderStats`
draws a `sectionRow` divider before each group and omits the group entirely
when it is empty.

## bb/100

`winRateCI()` returns null rather than zero when nothing qualifies — a zero
would look like a measurement. A session counts only if it is cash, has hours,
and has a stakes string with two numbers.

- **No FX conversion, and that is not an oversight.** Profit and the big blind
  are both native, so the ratio is dimensionless and sessions in different
  currencies pool directly. Adding `toBase()` here would be a bug.
- **Hands are estimated**, `hours × HANDS_PER_HOUR` from config.js. That's the
  one soft number in the file; the money figures are all measured.
- **The interval is the feature.** SD per 100 is `sqrt(100 × varPerHand)`, not
  100 × the per-hand SD — variance scales with hands, not linearly. The
  per-session residual is divided by that session's hands before pooling,
  which is what makes a 10-hour session comparable with a 2-hour one. Expect
  SD near 80–100 bb/100 for live NLHE; far outside that means a stakes string
  is parsing wrong.

## Tags

`text[]`, NOT NULL defaulting to `{}`, so nothing branches on null.
`parseTags()` lowercases, trims, dedupes and drops blanks on the way in —
normalise there, never at the display end. Tag options come from ALL sessions
(same rule as the other chips), and `renderTagSuggestions()` re-renders on
every input event so the chips and the comma-separated field can't disagree.
A datalist can't do that job: it matches the whole field, and the field is a
list.

## Currency

Sessions are stored in the currency they were played in (`sessions.currency`,
ISO-4217-shaped). `Object.keys(FX_RATES)` in `config.js` builds the dropdown,
so adding a currency there is still the whole change.

**The rate a session is valued at lives ON THE SESSION** (`fx_rate`,
migration_006), frozen when it was saved. This is the invariant the whole
feature exists for: rates are fetched live, so without pinning, a March
session's rupee value would move every day and the all-time total would never
be the same number twice.

- **`toBaseFor(s, amount)` — not `toBase(amount, cur)` — for anything that
  sums a session's money.** `toBase` uses the CURRENT rate and is right only
  when there is no session in hand. `profitBase` and `tournamentStats` both go
  through `toBaseFor`. Using the wrong one silently revalues history and no
  test of a single session would catch it.
- `sessionRate(s)` falls back to the current rate when `fxRate` is null — that
  is every row predating migration_006, and it reproduces the old behaviour
  exactly. It also rejects a non-positive or non-numeric rate rather than
  trusting it into an Infinity.
- `FX_RATES` is now a FALLBACK, not the source of truth. Editing a number
  there changes what a new offline session is prefilled with; it restates
  nothing.

`stakesLabel()` qualifies non-base stakes as `5/10 (HKD)` — a 5/10 HKD game is
not the 5/10 you'd read in rupees — and chart labels and filter chips both key
off it so they stay consistent. A tournament skips the suffix, since its
`stakes` is an event name.

## rates.js

Loaded between `stats.js` and `app.js`: it may read config, and `stats.js` must
never read it. The only file that touches the FX network or localStorage, and
it has **no top-level side effects**, which is what lets `tests.html` load it
and test the pure parts with no network.

- **`invertQuotes` is the dangerous function.** Frankfurter quotes
  base→symbol (one rupee buys 0.01036 dollars); the app needs symbol→base.
  Flipping it the wrong way understates a foreign session by four orders of
  magnitude, which is why it is named, isolated and tested rather than a `1 /`
  inside a fetch handler.
- **Every failure path returns null and degrades**, never throws: fresh cache →
  network → stale cache → `FX_RATES` → ask the user. Offline is a supported
  state, not an error, and the form labels a config fallback in red because
  that number can be months old.
- Concurrent callers share one in-flight request (`inFlight`). The form asks on
  open and on every currency change.
- The service worker **skips `api.frankfurter.dev`** for the same reason it
  skips the Worker: rates.js does its own caching with an age it understands, and
  a second cache underneath would serve a rate the app believes is fresh.

## Hours

Optional and nullable. **`null` means "not recorded" and is not zero.** A
session without hours is excluded from the hourly rate entirely — counting it
as zero hours would inflate the rate, and counting its profit without its time
would deflate it. `computeStats` reports `timedCount` so the UI can say what the
rate is based on, and the Hourly rows only render once at least one session has
hours.

## Filters

`activeFilter` (stakes), `activeLocation` (venue), `activeRange` (date),
`activeType` (cash/tournament) and `activeTag` all feed `visibleSessions()`,
which drives **the figures and the charts as well as the list**. Filtering to 100/200 and still seeing all-time stats was the single
most confusing thing about an earlier layout — don't reintroduce it.

Two rules that look redundant but aren't:

- Chip *options* are derived from **all** sessions, never the filtered set —
  otherwise picking one value deletes every other chip and strands you.
- A filtered-away value that no longer exists resets to `all` on every
  `renderFilters()`, or deleting the last session at a stake leaves the list
  empty with no chip to clear.

`activeRange` is a preset (`thisMonth` / `90d` / `thisYear`) **or** a literal
`YYYY-MM`, which is what clicking a by-month bar selects; that month then gets
its own chip so there is always a visible way to clear it.

CSV export writes **every** session, never the filtered view. A backup that
silently omits rows is worse than none.

## Server

`worker/` is this app's own Cloudflare Worker (`poker-ledger-api`) with a D1
database (`poker-ledger`), copied from Tally's and deliberately NOT shared with
it. A generic store: one `records` table, each session's full JSON as
`payload`, under `table_name = 'sessions'`. The Worker never reads a payload.

- **One sync password, no accounts.** `sync_meta` holds a single row (salt +
  hash of the token). The first `/signup` claims the ledger; later ones get 409.
- **`ALLOWED_ORIGINS` in `worker/wrangler.toml` is an exact-match list.** A new
  host (or port) must be added there and the Worker redeployed, or every
  request from it fails with "Origin not allowed".
- **Password reset** is `delete from sync_meta` via `wrangler d1 execute`; the
  records are untouched and the next visit shows "Set a password".

## Deploy

Two live hosts, both from `main`:

- **Vercel** — git-connected, so a push to `main` deploys automatically.
  `vercel.json` sets `Cache-Control: must-revalidate` on everything because the
  filenames are not content-hashed; a long max-age means a stale `app.js`.
  Deliberately **no SPA rewrite** (unlike Health_tracker): tabs are hash-based,
  so nothing needs a server-side fallback, and a catch-all would endanger
  `tests.html`.
- **GitHub Pages** — served from `/Poker-Ledger/`, not a domain root.
- **The Worker** does NOT deploy on push. Changes under `worker/` need
  `npm run deploy` there. `.vercelignore` keeps `worker/` off Vercel.

That subpath is why **every path in the manifest and service worker is
relative** (`./`, including `start_url` and `scope`). Absolute paths work on
Vercel and silently break installability on Pages.

`sw.js` is hand-written (no build step, so no Workbox) and is **network-first,
cache-as-fallback** — cache-first would serve a stale un-hashed `app.js`
forever. It skips `*.workers.dev` entirely: caching the ledger would show stale
sessions. **Bump `CACHE` in `sw.js` whenever the shell file list changes.**
