-- migration_004_tournaments.sql
--
-- Adds tournament support to the sessions table. Existing projects only —
-- schema.sql already describes the post-migration shape, so a fresh project
-- does not need this file. Safe to re-run.
--
-- Tournaments share the sessions table rather than getting their own, so there
-- is ONE bankroll: net profit, the cumulative chart and the by-month chart all
-- cover both formats. What differs is the analysis — a tournament has no
-- bb/100 and a cash game has no ROI — so the app computes those separately
-- and the table just has to carry the extra fields.
--
-- Field reuse for a tournament row:
--   stakes    the event name ("Sunday Million"), not a blind level
--   buy_in    the prize-pool portion of ONE entry
--   fee       the rake portion of ONE entry
--   entries   1 for a freezeout, 2+ if you re-entered or rebought
--   cash_out  total winnings, 0 if you busted
--
-- Total cost is therefore (buy_in + fee) * entries, which is why profit is no
-- longer simply cash_out - buy_in. stats.js `totalCost()` is the one place
-- that arithmetic lives.

alter table sessions
  add column if not exists session_type text not null default 'cash'
    check (session_type in ('cash', 'tournament'));

-- All four are null for a cash session, and null means "not recorded" rather
-- than zero — the same rule `hours` already follows.
alter table sessions
  add column if not exists fee numeric
    check (fee is null or fee >= 0);

alter table sessions
  add column if not exists entries integer
    check (entries is null or entries >= 1);

-- Finishing position. Null is legitimate: you always know whether you cashed
-- (cash_out > 0) but you do not always bother recording where you busted.
alter table sessions
  add column if not exists place integer
    check (place is null or place >= 1);

alter table sessions
  add column if not exists field_size integer
    check (field_size is null or field_size >= 1);

-- A place cannot be better than first or worse than the field it came from.
-- Written as a NOT VALID constraint then validated separately so that a row
-- already in the table with bad data reports itself instead of failing the
-- whole migration silently.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_place_within_field'
  ) then
    alter table sessions
      add constraint sessions_place_within_field
      check (place is null or field_size is null or place <= field_size)
      not valid;
    alter table sessions validate constraint sessions_place_within_field;
  end if;
end $$;
