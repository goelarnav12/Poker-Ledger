# Poker_ledger

## Running

No build step and no package manager. Static files loaded directly by
`index.html`; dependencies (`@supabase/supabase-js@2`, `chart.js@4.4.4` plus
`chartjs-adapter-date-fns`, Google Fonts) come from CDN `<script>` tags.

```sh
cd Poker_ledger && python3 -m http.server 8000   # then open http://localhost:8000
```

`file://` mostly works, but Supabase auth and the service worker both want
http — use the server.

Tests: open `tests.html`. It loads `stats.js` and `tests.js` only — no Supabase,
no network, no framework. Reload to re-run. **Anything deterministic enough to
test belongs in `stats.js`**, and the tests pin their own FX rates via
`setCurrencyConfig()` so retuning `config.js` can't turn them red.

## Architecture

Single-page app, no framework, no modules — everything is global scope, loaded
in order: `config.js` (Supabase + currency constants), `stats.js`, `app.js`.

The split is the point: **`stats.js` is pure** — no DOM, no network, no app
state, every function deterministic. `app.js` owns the DOM, Supabase access and
rendering. New arithmetic goes in `stats.js` with a test; new markup goes in
`app.js`. `app.js` has no tests, which is exactly where the bugs have been.

State is module-level globals in [app.js](app.js): `client`, `currentUser`,
`sessions` (the full row set, always fetched whole), the three filters
(`activeFilter`, `activeLocation`, `activeRange`), `editingId`, and the three
Chart.js instances. There is no local cache and no optimistic update — every
mutation is followed by a full `loadSessions()` + `render()`. Keep that; the
data volume is a personal ledger.

Flow: `boot()` → placeholder-config check → create client → restore session or
show `authView` → `onAuthStateChange` swaps `#authView` / `#app`.

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

Field names are camelCase in JS and snake_case in Postgres. `loadSessions()`
and `toRow()` are the only places that translation happens. Keep it there.

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

## Currency

Sessions are stored in the currency they were played in (`sessions.currency`,
ISO-4217-shaped). `BASE_CURRENCY` and `FX_RATES` in `config.js` are the single
source of truth — the form's dropdown is built from `Object.keys(FX_RATES)`, so
adding a currency there is the whole change.

**Anything summing across sessions must go through `toBase()` first.** Only a
single session's own figure is shown natively (`fmt(n, s.currency)`); the list
row appends the base-converted value so the totals stay traceable.
`stakesLabel()` qualifies non-base stakes as `5/10 (HKD)` — a 5/10 HKD game is
not the 5/10 you'd read in rupees — and chart labels and filter chips both key
off it so they stay consistent.

Rates are static and global. Editing one retroactively restates every past
session in that currency.

## Hours

Optional and nullable. **`null` means "not recorded" and is not zero.** A
session without hours is excluded from the hourly rate entirely — counting it
as zero hours would inflate the rate, and counting its profit without its time
would deflate it. `computeStats` reports `timedCount` so the UI can say what the
rate is based on, and the Hourly rows only render once at least one session has
hours.

## Filters

`activeFilter` (stakes), `activeLocation` (venue) and `activeRange` (date) all
feed `visibleSessions()`, which drives **the figures and the charts as well as
the list**. Filtering to 100/200 and still seeing all-time stats was the single
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

## Database

`schema.sql` is run once by hand in the Supabase SQL Editor and describes the
*current* shape, for a fresh project. Changes to an existing project go in a
numbered `migration_NNN_*.sql`, run by hand in the same place:

| File | What it does |
|---|---|
| `migration_001_currency.sql` | added `currency`, dropped the old NOT NULL `hours` |
| `migration_002_index.sql` | index on `(user_id, date)` |
| `migration_003_hours.sql` | re-added `hours`, nullable, `check (hours > 0)` |

`import_sessions.sql` is a one-off backfill and is safe to re-run — it
anti-joins on `(user_id, date, stakes)`. Its email is a placeholder set once via
`set_config`, read back by `current_setting`.

The SQL Editor is not psql: no `\set`, no `:'var'`. It also runs as `postgres`,
which **bypasses RLS** — that's why the import works despite `auth.uid()` being
null there, and why it's a bad place to test whether a policy actually works.

One table, `sessions`, RLS enabled, four policies keyed on
`auth.uid() = user_id`. Those policies are the only thing protecting the data —
the publishable key in `config.js` is public by design. Never weaken them, and
never put a service-role key in `config.js`.

**Free-tier projects pause after 7 days of low activity** and are eventually
deleted if left paused. Opening the app while logged in issues a real `select`
and counts as activity.

## Deploy

Two live hosts, both from `main`:

- **Vercel** — git-connected, so a push to `main` deploys automatically.
  `vercel.json` sets `Cache-Control: must-revalidate` on everything because the
  filenames are not content-hashed; a long max-age means a stale `app.js`.
  Deliberately **no SPA rewrite** (unlike Health_tracker): tabs are hash-based,
  so nothing needs a server-side fallback, and a catch-all would endanger
  `tests.html` and the `.sql` files.
- **GitHub Pages** — served from `/Poker-Ledger/`, not a domain root.

That subpath is why **every path in the manifest and service worker is
relative** (`./`, including `start_url` and `scope`). Absolute paths work on
Vercel and silently break installability on Pages.

`sw.js` is hand-written (no build step, so no Workbox) and is **network-first,
cache-as-fallback** — cache-first would serve a stale un-hashed `app.js`
forever. It skips `*.supabase.co` entirely: caching the ledger would show stale
sessions, and caching the auth exchange would replay a stale token.
