-- Run this once in your Supabase project's SQL Editor:
-- Dashboard -> SQL Editor -> New Query -> paste all of this -> Run

create extension if not exists pgcrypto;

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  date date not null,
  location text not null,
  -- A blind level ("50/100") for a cash game, the event name for a tournament.
  stakes text not null,
  -- Cash: what you sat down with. Tournament: the prize-pool portion of ONE
  -- entry — see `fee` and `entries` below, and `totalCost()` in stats.js.
  buy_in numeric not null,
  cash_out numeric not null,
  -- Amounts above are denominated in this currency.
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  -- Units of BASE_CURRENCY per one unit of `currency`, FROZEN at the moment
  -- the session was saved. Rates are fetched live, but only to prefill a new
  -- session — pinning it here is what stops a March session's rupee value
  -- drifting every day and the all-time total never settling.
  -- Null means "not recorded"; those fall back to the current rate.
  fx_rate numeric check (fx_rate is null or fx_rate > 0),
  -- Optional. A session without hours is excluded from the hourly rate rather
  -- than counted as zero, so leaving this null is a legitimate choice.
  hours numeric check (hours is null or hours > 0),
  notes text,

  -- Both formats share this table so there is one bankroll. Only the analysis
  -- differs: bb/100 is cash-only, ROI and ITM are tournament-only.
  session_type text not null default 'cash'
    check (session_type in ('cash', 'tournament')),
  -- The four below are null for a cash session. Null means "not recorded",
  -- never zero — the same rule `hours` follows.
  fee numeric check (fee is null or fee >= 0),
  entries integer check (entries is null or entries >= 1),
  place integer check (place is null or place >= 1),
  field_size integer check (field_size is null or field_size >= 1),
  constraint sessions_place_within_field
    check (place is null or field_size is null or place <= field_size),

  -- Free-form labels ("tilted", "short-handed"). NOT NULL with a '{}' default
  -- so nothing has to branch on null to iterate them.
  tags text[] not null default '{}',

  created_at timestamptz not null default now()
);

-- Every query the app makes is "my sessions, by date", so index exactly that.
create index if not exists sessions_user_date_idx on sessions (user_id, date);

-- Only useful for querying tags from the SQL editor; the app filters in
-- memory, having already loaded every row.
create index if not exists sessions_tags_idx on sessions using gin (tags);

alter table sessions enable row level security;

-- Each user can only ever see, add, edit, or delete their own sessions.
create policy "select own sessions"
  on sessions for select
  using (auth.uid() = user_id);

create policy "insert own sessions"
  on sessions for insert
  with check (auth.uid() = user_id);

-- `with check` as well as `using`, otherwise an update could reassign user_id
-- and hand the row to another account.
create policy "update own sessions"
  on sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own sessions"
  on sessions for delete
  using (auth.uid() = user_id);
