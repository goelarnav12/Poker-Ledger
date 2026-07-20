# Poker_ledger

## Running

No build step and no package manager. Static files loaded directly by `index.html`; dependencies (`@supabase/supabase-js@2`, `chart.js@4.4.4` plus `chartjs-adapter-date-fns`, Google Fonts) come from CDN `<script>` tags.

Tests: open `tests.html` in a browser. It loads `stats.js` and `tests.js` only — no Supabase, no network, no framework. Reload to re-run. Anything deterministic enough to test belongs in `stats.js`.

```sh
cd Poker_ledger && python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` via `file://` also mostly works, but Supabase auth is happier over http.

Deploy = drag the folder to any static host (Netlify Drop, GitHub Pages, Vercel).

## Architecture

Single-page app with no framework and no modules — everything is global scope, loaded in order: `config.js` (Supabase + currency constants), `stats.js`, then `app.js`.

The split matters: **`stats.js` is pure** — no DOM, no network, no app state, every function deterministic — which is what makes `tests.html` possible. `app.js` owns the DOM, Supabase access, and rendering. New arithmetic goes in `stats.js` with a test; new markup goes in `app.js`.

State lives in three module-level globals in [app.js](app.js): `client` (Supabase), `currentUser`, and `sessions` (the full row set, always fetched whole). There is no local cache or optimistic update — every mutation (`addSession`, `deleteSession`) is followed by a full `loadSessions()` + `render()`. Keep that pattern; the data volume is a personal ledger.

Flow: `boot()` → checks for placeholder config → creates client → restores session or shows `authView` → `onAuthStateChange` drives all view swapping by toggling `style.display` on `#authView` / `#app` / `#bankrollBlock`.

`render()` is the single entry point for all UI updates; it calls every renderer.

The add/edit form is one `<form>` doing both jobs; `editingId` being non-null is the only thing that distinguishes them. `openForm(session|null)` and `closeForm()` are the only ways to change that state — always go through them, since they also reset the title, the submit button label, and the currency-dependent amount labels.

Deleting is two-step: the first click on ✕ arms the button for 4s, the second commits. There is no undo, so don't replace it with a one-click delete. Chart.js instances are stored in the `profitChart` / `stakesChart` globals and **must** be `.destroy()`ed before re-creating, which the renderers already do.

Field names are camelCase in JS and snake_case in Postgres; `loadSessions()` and `addSession()` are the only places that translation happens. Keep it there.

## Currency

Sessions are stored in the currency they were played in (`sessions.currency`, an ISO-4217-shaped code). `BASE_CURRENCY` and `FX_RATES` in `config.js` are the single source of truth: the add-session dropdown is built from `Object.keys(FX_RATES)`, so adding a currency there is the whole change.

The rule is that **anything summing across sessions must go through `toBase()` first** — `computeStats`, both charts. Only a single session's own figure is shown in its native currency (`fmt(n, s.currency)`); the list row appends the base-converted value so the totals are traceable. `stakesLabel()` qualifies non-base stakes as `5/10 (HKD)`, because a 5/10 HKD game is not the 5/10 you'd read in rupees — chart labels and filter chips both key off it, so they stay consistent.

Rates are static, not live. Editing one retroactively restates every past session in that currency.

Lists are rendered by building HTML strings and re-attaching listeners afterward. Any user-supplied value interpolated into those templates must go through `escapeHtml()` — location, stakes, and notes already do.

## Database

`schema.sql` is run once by hand in the Supabase SQL Editor and describes the *current* shape of the table, for a fresh project. Changes to an existing project go in a numbered `migration_NNN_*.sql` run by hand in the same place — `migration_001_currency.sql` added `currency` and dropped `hours`. `import_sessions.sql` is a one-off backfill of 36 sessions and is safe to re-run (it anti-joins on `(user_id, date, stakes)`).

Note the SQL Editor is not psql: no `\set`, no `:'var'` interpolation. One table, `sessions`, with RLS enabled and four policies keyed on `auth.uid() = user_id`. That RLS policy is the only thing protecting the data — the anon/publishable key in `config.js` is public by design. Never edit the schema in a way that drops or weakens those policies.
