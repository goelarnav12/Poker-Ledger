# The Ledger — Poker Session Tracker

A standalone website for tracking cash games and tournaments: profit and loss
per session, a cumulative bankroll chart, monthly and per-stakes breakdowns,
and distribution stats (median, standard deviation, max drawdown, streaks).
Sessions can be recorded in multiple currencies and are totalled in one.

Cash games and tournaments share **one bankroll** — net profit and the
cumulative chart cover both — but are **analysed separately**, because a
tournament has no bb/100 and a cash game has no ROI. See
[Formats](#formats) below.

Your data lives in your own free Cloudflare database (a Worker + D1) behind one
password, so it follows you across devices and nobody else can read it.

No build step, no package manager and no framework for the site itself (the
small server in `worker/` is deployed with Wrangler). Total cost: **$0**.

---

## Setup

### 1. Deploy the server

The server is a small Cloudflare Worker with a D1 database, in
[`worker/`](worker/). It only stores rows; every figure is computed in the
browser. You need a free Cloudflare account and Node.

```sh
cd worker
npm install
npx wrangler login
npx wrangler d1 create poker-ledger      # prints a database_id
```

Paste that `database_id` into [`worker/wrangler.toml`](worker/wrangler.toml).
In the same file, set `ALLOWED_ORIGINS` to the exact addresses your site is
served from (comma-separated, no trailing slash). Only those pages may call the
Worker. Then:

```sh
npm run db:remote     # creates the two tables from schema.sql
npm run deploy        # prints the Worker's URL
```

### 2. Connect the site

Paste the Worker's URL into [`config.js`](config.js), with no trailing slash:

```js
const API_URL = "https://poker-ledger-api.<your-subdomain>.workers.dev";
```

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

### 4. Set your password

Serve the folder and open it:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

The first visit asks you to **set a password**. There is no email and no
account: one ledger per Worker, and the first password set claims it for good.
Every later visit, on any device, asks for that password once and then
remembers it on that device until you press **Lock**.

**Forgotten the password?** There is no reset email. Clear the password row
and set a new one; your sessions are untouched:

```sh
cd worker
npx wrangler d1 execute poker-ledger --remote --command "delete from sync_meta"
```

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

Once it is public, add the live address to `ALLOWED_ORIGINS` in
`worker/wrangler.toml` and run `npm run deploy` in `worker/` again. A page
served from an address that is not on that list cannot reach your ledger.

---

## Tests

Open [`tests.html`](tests.html) in a browser. Reload to re-run.

It exercises the pure functions in `stats.js` — currency conversion,
formatting, and every statistic — with no network, no server, and no
framework. Currency rates are pinned inside the tests, so retuning `FX_RATES`
cannot turn them red.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Styling |
| `config.js` | The Worker's URL, currency list, offline fallback rates |
| `stats.js` | Pure logic: money, formatting, statistics. No DOM, no network. |
| `rates.js` | Live exchange rates. The only file that fetches FX. |
| `backend.js` | The only file that talks to the server: password, load, save |
| `app.js` | Lock screen, data layer, rendering |
| `tests.html` / `tests.js` | Test runner for `stats.js` |
| `worker/` | The Cloudflare Worker + D1 server, deployed with Wrangler |
| `schema.sql`, `migration_*.sql`, `import_sessions.sql` | The old Supabase (Postgres) schema, from before the move to Cloudflare in Nov 2026. Reference only; nothing runs them. |

The two structural rules worth keeping: anything deterministic enough to test
belongs in `stats.js`, and anything that sums across sessions must convert to
the base currency first.

---

## Security

One password protects the ledger. It never leaves your browser: it is stretched
with PBKDF2 (650,000 rounds) into a token, and only that token is sent. The
server stores a hash of the token, so even a copy of its database does not let
anyone sign in.

The Worker's URL in `config.js` is not a secret. The Worker also only answers
pages served from the addresses in `ALLOWED_ORIGINS`.

Sessions are stored as readable JSON on your own Cloudflare account, not
encrypted. That is a deliberate trade: it is what lets a forgotten password be
reset without losing the data.
