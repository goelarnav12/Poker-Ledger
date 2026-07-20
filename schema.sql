-- Run this once in your Supabase project's SQL Editor:
-- Dashboard -> SQL Editor -> New Query -> paste all of this -> Run

create extension if not exists pgcrypto;

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  date date not null,
  location text not null,
  stakes text not null,
  buy_in numeric not null,
  cash_out numeric not null,
  -- Amounts above are denominated in this currency. The app converts to
  -- BASE_CURRENCY for totals using the FX_RATES map in config.js.
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  -- Optional. A session without hours is excluded from the hourly rate rather
  -- than counted as zero, so leaving this null is a legitimate choice.
  hours numeric check (hours is null or hours > 0),
  notes text,
  created_at timestamptz not null default now()
);

-- Every query the app makes is "my sessions, by date", so index exactly that.
create index if not exists sessions_user_date_idx on sessions (user_id, date);

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
