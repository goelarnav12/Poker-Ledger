# The Ledger — Poker Session Tracker

A standalone website for tracking cash game sessions: profit and loss per
session, a cumulative bankroll chart, monthly and per-stakes breakdowns, and
distribution stats (median, standard deviation, max drawdown, streaks).
Sessions can be recorded in multiple currencies and are totalled in one.

Your data lives in your own free Supabase database behind your own login, so it
follows you across devices and nobody else can read it.

No build step, no package manager, no framework. Total cost: **$0**.

---

## Setup

### 1. Create the database

1. Sign up at [supabase.com](https://supabase.com) and click **New Project**.
   Save the database password somewhere; pick a region near you.
2. Open **SQL Editor → New Query**, paste the entire contents of
   [`schema.sql`](schema.sql), and Run.

   This creates the `sessions` table, an index, and four Row Level Security
   policies that restrict every row to the account that created it.

### 2. Connect the site

**Project Settings → API Keys**, then copy two values into
[`config.js`](config.js):

```js
const SUPABASE_URL = "https://xxxxx.supabase.co";   // "Project URL"
const SUPABASE_ANON_KEY = "sb_publishable_xxxx";    // "Publishable key"
```

The URL must be the `https://<ref>.supabase.co` API host — **not** the
`supabase.com/dashboard/project/...` address in your browser bar. Using the
dashboard URL makes every request fail.

Older projects show a "Legacy API Keys" tab instead; the **anon** key there
works identically.

### 3. Set your currencies

Also in `config.js`:

```js
const BASE_CURRENCY = "INR";
const FX_RATES = { INR: 1, HKD: 11.15 };
```

Sessions are stored in the currency you played in. Every total, both bar
charts, and the Net Profit figure are converted to `BASE_CURRENCY` using these
rates. The currency dropdown in the form is generated from these keys, so
adding a currency here is the only change needed.

Rates are static, not live. Changing one restates every past session in that
currency — fine for a ledger you read in one denomination, but be aware the
historical numbers move.

### 4. Create your login

Serve the folder and sign up:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Supabase requires email confirmation by default. Either click the link it
sends, or turn it off under **Authentication → Sign In / Providers → Email**.

If you are hosting the site anywhere other than localhost, set
**Authentication → URL Configuration → Site URL** to that address first, or
the confirmation link will point at localhost and fail.

---

## Hosting

Plain static files, so any static host works: GitHub Pages (Settings → Pages →
Deploy from a branch → `main` → `/ (root)`), Netlify Drop, Cloudflare Pages,
Vercel.

Two things to do once it is public:

- Set the Supabase **Site URL** to your live address, as above.
- Turn **off** new signups once your own account exists
  (**Authentication → Sign In / Providers → Email**). Otherwise anyone who
  finds the URL can create an account on your project. They could never read
  your sessions — RLS prevents that — but they would consume your free tier.

---

## Tests

Open [`tests.html`](tests.html) in a browser. Reload to re-run.

It exercises the pure functions in `stats.js` — currency conversion,
formatting, and every statistic — with no network, no Supabase, and no
framework. Currency rates are pinned inside the tests, so retuning `FX_RATES`
cannot turn them red.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Styling |
| `config.js` | Your Supabase credentials and currency settings |
| `stats.js` | Pure logic: money, formatting, statistics. No DOM, no network. |
| `app.js` | Auth, data access, rendering |
| `tests.html` / `tests.js` | Test runner for `stats.js` |
| `schema.sql` | Run once on a new project — current table shape |
| `migration_001_currency.sql` | Adds `currency`, drops `hours`. Existing projects only. |
| `migration_002_index.sql` | Adds the `(user_id, date)` index. Existing projects only. |
| `import_sessions.sql` | One-off backfill of historical sessions |

`schema.sql` always describes the *current* shape of the table, so a fresh
project needs only that file — the migrations exist to bring older projects up
to date, and running them on a new project does nothing.

The two structural rules worth keeping: anything deterministic enough to test
belongs in `stats.js`, and anything that sums across sessions must convert to
the base currency first.

---

## Security

The publishable/anon key is designed to be public; it is safe in source code
and in this repository. What actually protects your data is Row Level Security
— the four policies in `schema.sql` restrict every read and write to rows where
`user_id` matches the logged-in account.

Those policies are the only thing standing between your data and anyone with
the key. Never weaken them, and never put a **service role** key in
`config.js`; that one bypasses RLS entirely.
