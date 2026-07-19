# The Ledger — Poker Session Tracker

A real, standalone website (not a Claude artifact) for tracking your cash game
sessions: buy-in/cash-out, hourly rate, win rate, a cumulative profit chart,
and results broken down by stakes. Your data is stored in your own free
Supabase database and protected behind your own login, so it follows you
across any device or browser.

Total cost: **$0**. Setup time: **~10 minutes**.

---

## 1. Create your free database (Supabase)

1. Go to [supabase.com](https://supabase.com) and sign up for a free account.
2. Click **New Project**. Pick any name, a database password (save it
   somewhere safe), and a region close to you. Free tier is fine.
3. Once the project finishes provisioning, open the **SQL Editor** in the
   left sidebar, click **New Query**, paste in the entire contents of
   `schema.sql` (included in this folder), and click **Run**.
   This creates your `sessions` table and locks it down so only you can
   ever read or write your own rows.
4. Go to **Project Settings → API Keys**. Copy:
   - The **Project URL**
   - The **Publishable key** (starts with `sb_publishable_...`) — on the
     "Publishable and secret API keys" tab. If your project only shows a
     "Legacy API Keys" tab, use the **anon** key instead; it works exactly
     the same way.

## 2. Connect the site to your database

Open `config.js` in this folder and paste in the two values:

```js
const SUPABASE_URL = "https://xxxxx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xxxxxxxxxxxx";
```

Save the file. That's the only code change you need to make.

## 3. Host it for free

Any static host works since this is plain HTML/CSS/JS. Two easy options:

### Option A — Netlify Drop (fastest, no account needed to try it)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag this whole folder (`poker-tracker`) into the browser window.
3. You'll get a live `https://your-site-name.netlify.app` URL instantly.
4. Sign up for a free Netlify account if you want the link to stay live
   permanently and be able to update it later.

### Option B — GitHub Pages
1. Create a free GitHub account and a new repository.
2. Upload all the files in this folder to the repository (drag-and-drop
   works fine on github.com, or use `git push` if you're comfortable with git).
3. Go to the repo's **Settings → Pages**, set the source to your main branch
   and root folder, and save.
4. Your site will be live at `https://yourusername.github.io/repo-name`
   within a minute or two.

Cloudflare Pages and Vercel are also free and work the same way if you'd
rather use one of those.

## 4. Start tracking

Visit your new URL, click **Sign Up**, enter an email and password, and log
your first session. If your Supabase project has email confirmation turned
on (it's on by default), check your inbox and confirm before logging in —
or turn it off for personal use under **Authentication → Providers → Email**
in the Supabase dashboard.

---

## Notes on security

The publishable/anon key is meant to be public — it's safe to have it sitting
in your site's source code. What actually protects your data is the Row
Level Security policy in `schema.sql`, which only allows a logged-in user to
see or modify rows where `user_id` matches their own account. Don't lose
this policy if you ever edit the schema.

## Files

- `index.html` — page structure
- `style.css` — styling
- `app.js` — auth + data logic
- `config.js` — your Supabase credentials go here
- `schema.sql` — run once in Supabase to set up the database
