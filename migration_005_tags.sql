-- migration_005_tags.sql
--
-- Adds free-form tags to sessions. Existing projects only; safe to re-run.
--
-- A text[] rather than a join table: tags are read on every render as part of
-- the row that is already being fetched, never queried independently, and the
-- whole ledger is loaded whole anyway. A second table would add a join and a
-- second set of RLS policies to protect for no gain at this data volume.
--
-- NOT NULL with a '{}' default, so tag handling never has to branch on null —
-- an untagged session has an empty array, which is what the filter code
-- already expects to iterate.

alter table sessions
  add column if not exists tags text[] not null default '{}';

-- GIN makes `tags @> '{tilted}'` an index scan. Strictly speaking the app
-- filters client-side (it holds every session in memory), so this earns its
-- keep only if you ever query tags from the SQL editor — which is exactly
-- when you would want it and exactly when adding it is inconvenient.
create index if not exists sessions_tags_idx on sessions using gin (tags);
