-- Migration 003 — bring back `hours`, this time optional.
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Not needed on a project created from the current schema.sql, which already
-- includes the column. This is for projects created before it.
--
-- Migration 001 dropped `hours` because it was `not null` and nothing reliably
-- filled it. It returns nullable: a session with no hours recorded is excluded
-- from the hourly rate entirely rather than being counted as zero, which would
-- otherwise inflate the rate.

alter table sessions
  add column if not exists hours numeric;

-- Hours must be a positive duration when present. The app also treats 0 and
-- negatives as "not recorded", but there is no reason to let them into the
-- table in the first place.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_hours_positive'
  ) then
    alter table sessions
      add constraint sessions_hours_positive check (hours is null or hours > 0);
  end if;
end $$;

-- Confirm:
--   select count(*) as total, count(hours) as with_hours from sessions;
