# The Ledger — Poker Session Tracker

A standalone website for tracking cash games and tournaments: profit and loss
per session, a cumulative bankroll chart, monthly and per-stakes breakdowns,
and distribution stats (median, standard deviation, max drawdown, streaks).
Sessions can be recorded in multiple currencies and are totalled in one.

Cash games and tournaments share **one bankroll** — net profit and the
cumulative chart cover both — but are **analysed separately**, because a
tournament has no bb/100 and a cash game has no ROI. See
[Formats](#formats) below.

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
const FX_RATES = { INR: 1, HKD: 11.15, USD: 96.5 };
```

Sessions are stored in the currency you played in. The dropdown is generated
from these keys, so **adding a currency here is the only change needed** —
`stats.js` already carries symbols for USD, EUR, GBP, SGD, AUD, CAD and JPY,
and anything without one falls back to its three-letter code. A few extras are
commented out; uncomment what you play in and delete the rest, since the rate
service is asked for exactly these codes.

**The numbers are only a fallback.** Rates are fetched live — see below.

### How rates work

Rates come from [Frankfurter](https://frankfurter.dev) (European Central Bank
reference rates; no API key, no account, no cost), and are used **only to
prefill the form**. When you save a session, the rate is written onto that row
and never changes again.

That freezing is the point. If totals used today's rate, the rupee value of a
session played in March would move every single day and your all-time profit
would never be the same number twice. Instead each session keeps what it was
worth when you played it, so the ledger reconciles with a screenshot from last
month.

The rate field sits next to the currency picker on any non-base session:

- **It's editable.** The cage gave you a worse rate than the market? Type what
  you actually got. What you save is what that session is valued at.
- **It says where the number came from** — `live rate · 24 Jul`, `cached
  rate`, or a red `from config.js` when it couldn't reach the service. The ECB
  publishes on working days only, so a Sunday fetch legitimately returns
  Friday's rate and the date says so.
- **↻ refetches.** A background refresh never overwrites a number you typed.
- Session rows show the rate they were valued at (`≈ ₹78,050 @11.15`), so two
  identical HK$7,000 wins reading differently is explained on the row rather
  than being a mystery.

Offline it falls back to the last cached rates (kept in `localStorage`, refreshed
at most twice a day), and then to the static `FX_RATES` above. So the app is
fully usable with no signal, which is the whole point of it being a PWA —
editing `FX_RATES` now only affects that offline fallback, and no longer
restates any history.

Also in `config.js`:

```js
const HANDS_PER_HOUR = 20;
```

bb/100 is a rate per hundred hands, but a live ledger records hours — nobody
counts hands at the table. Hands are estimated as `hours × HANDS_PER_HOUR`, so
that figure is only ever as good as this number. 20 suits an unhurried
full-ring game; a brisk room is nearer 30, 6-max or a shot clock 35–40, online
several times higher.

Changing it rescales bb/100 for every past session and changes **no money
figure**, which is measured rather than estimated. Lowering it *raises* the
reported rate — the same profit spread over fewer hands — and widens the
confidence interval by exactly the same factor, so how much the number can be
trusted doesn't move. It only changes the unit it's quoted in.

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

## Formats

The **Type** picker on the session form switches between a cash game and a
tournament. It rewrites the labels around it, because the same columns mean
different things:

| Field | Cash game | Tournament |
|---|---|---|
| Stakes | the blind level, `50/100` | the event name, `Sunday Main` |
| Buy-in | what you sat down with | the prize-pool portion of **one** entry |
| Fee | — | the rake on **one** entry |
| Entries | — | 1 for a freezeout, 2+ if you re-entered |
| Cash-out | what you left with | total winnings, 0 if you busted |
| Finish / Field | — | optional, for the best-finish figure |

So a tournament costs `(buy-in + fee) × entries`, which is why profit is no
longer simply cash-out minus buy-in. That arithmetic lives in exactly one
place, `totalCost()` in `stats.js`, and everything downstream inherits it.

**What each format gets you.** Above the first divider, every figure counts
every session — one bankroll. Below it:

- **Cash games** — bb/100 with a confidence interval, hourly rate, hours.
- **Tournaments** — ROI, in-the-money rate, buy-ins, winnings, best finish.

The hourly rate is deliberately cash-only. A tournament's length is set by the
structure rather than by you, so money-per-hour says more about the blind
levels than about how you played; ROI is the figure that means something.

### bb/100 and the confidence interval

The interval is the point. A win rate measured over a few hundred hours is
mostly noise, and a bare "4.2 bb/100" invites you to believe a number the
sample cannot support — so the app prints `+4.2 ± 6.0` and puts the full
reading in the row's tooltip.

Two properties worth knowing:

- **No currency conversion happens.** Profit and the big blind are both in the
  session's own currency, so the ratio is dimensionless — an HKD session pools
  with an INR one directly, at no exchange rate.
- **A session is only counted if it can be.** It must be a cash game, have
  hours recorded, and have a stakes string with two numbers in it. Anything
  else is dropped rather than guessed at, so the figure is based on fewer
  sessions than the ledger holds — the tooltip says how many.

Standard deviation typically lands near 80–100 bb/100 for live NLHE. A figure
far outside that usually means a stakes string is being parsed wrong, not that
your game is unusual.

### Tags

Free-form labels on a session — `tilted`, `short-handed`, `late`. Type them
comma-separated, or tap the chips under the field for ones you've used before.
They're lowercased and de-duplicated on save, so `Tilted` and `tilted ` don't
become two chips for one idea. Each tag becomes a filter, which is the point:
it's how you find out what your "tilted" sessions actually cost you.

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
| `config.js` | Your Supabase credentials, currency list, offline fallback rates |
| `stats.js` | Pure logic: money, formatting, statistics. No DOM, no network. |
| `rates.js` | Live exchange rates. The only file that fetches FX or uses localStorage. |
| `app.js` | Auth, data access, rendering |
| `tests.html` / `tests.js` | Test runner for `stats.js` |
| `schema.sql` | Run once on a new project — current table shape |
| `migration_001_currency.sql` | Adds `currency`, drops `hours`. Existing projects only. |
| `migration_002_index.sql` | Adds the `(user_id, date)` index. Existing projects only. |
| `migration_003_hours.sql` | Re-adds `hours`, nullable. Existing projects only. |
| `migration_004_tournaments.sql` | Adds `session_type` and the tournament columns. Existing projects only. |
| `migration_005_tags.sql` | Adds `tags`. Existing projects only. |
| `migration_006_fx_rate.sql` | Adds `fx_rate` and backfills it. Existing projects only. |
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
