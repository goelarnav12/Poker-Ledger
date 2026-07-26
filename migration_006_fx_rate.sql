-- migration_006_fx_rate.sql
--
-- Freezes the exchange rate onto each session. Existing projects only —
-- schema.sql already describes the post-migration shape. Safe to re-run.
--
-- WHY THIS COLUMN EXISTS
--
-- Rates used to be static constants in config.js, which meant editing one
-- retroactively restated every past session in that currency. Rates are now
-- fetched live, which would make that far worse: the rupee value of a session
-- played in March would change every single day, and the all-time total would
-- never be the same number twice.
--
-- So the live rate is only ever used to PREFILL a new session. Once saved, the
-- rate lives on the row and that session's value never moves again. The ledger
-- becomes reproducible: a screenshot from last week still reconciles today.
--
-- Null means "not recorded" — the same rule `hours` follows. The app falls back
-- to the current best-known rate for those, which is why the backfill below
-- matters: it pins the history that already exists.

alter table sessions
  add column if not exists fx_rate numeric
    check (fx_rate is null or fx_rate > 0);

-- Backfill with the STATIC rates that were in config.js up to this migration,
-- so turning the feature on changes no figure you have already seen. Base
-- currency is 1 by definition; HKD was 11.15.
--
-- Deliberately NOT today's live rate. That would be a one-time restatement of
-- history as a side effect of a schema change, which is exactly the surprise
-- this column exists to prevent. If you'd rather revalue a session at a
-- different rate, edit that session and set the rate by hand.
update sessions set fx_rate = 1     where fx_rate is null and currency = 'INR';
update sessions set fx_rate = 11.15 where fx_rate is null and currency = 'HKD';

-- Any other currency is left null on purpose: there was no static rate for it,
-- so there is nothing truthful to pin it to. Those rows read at the current
-- rate until you open one and set it.
