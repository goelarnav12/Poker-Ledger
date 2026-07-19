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
  hours numeric not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table sessions enable row level security;

-- Each user can only ever see, add, edit, or delete their own sessions.
create policy "select own sessions"
  on sessions for select
  using (auth.uid() = user_id);

create policy "insert own sessions"
  on sessions for insert
  with check (auth.uid() = user_id);

create policy "update own sessions"
  on sessions for update
  using (auth.uid() = user_id);

create policy "delete own sessions"
  on sessions for delete
  using (auth.uid() = user_id);
