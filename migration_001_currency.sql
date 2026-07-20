-- Migration 001 — per-session currency, and drop `hours`.
-- Run this ONCE in the Supabase SQL Editor, BEFORE import_sessions.sql.
--
-- WARNING: the last statement drops the `hours` column and any data in it.
-- If you have sessions with hours you care about, save them first:
--     select date, location, stakes, hours from sessions order by date;

-- 1. Every session now carries the currency its amounts are denominated in.
--    Existing rows are assumed to be in INR; change the default below if that
--    is wrong for your data BEFORE running this.
alter table sessions
  add column if not exists currency text not null default 'INR';

-- 2. Keep it to ISO-4217-shaped codes so the app's FX_RATES lookup has a
--    predictable key. `do` block so re-running is not an error.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_currency_format'
  ) then
    alter table sessions
      add constraint sessions_currency_format check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

-- 3. Hours were never reliably recorded, and the Hourly Rate stat they fed has
--    been removed from the app.
alter table sessions drop column if exists hours;
