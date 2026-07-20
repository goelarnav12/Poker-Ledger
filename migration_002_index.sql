-- Migration 002 — index the one query the app actually makes.
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Not needed on a project created from the current schema.sql: that file
-- already includes this index. This exists for projects created before it.
--
-- loadSessions() always issues `select * from sessions order by date`, and RLS
-- rewrites it to add `where user_id = auth.uid()`. That is a (user_id, date)
-- lookup, so this index serves both the filter and the sort.

create index if not exists sessions_user_date_idx on sessions (user_id, date);

-- Confirm it exists:
--   select indexname from pg_indexes where tablename = 'sessions';
