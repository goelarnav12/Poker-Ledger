-- Backfill of 36 cash-game sessions (Jan-Jul 2026).
--
-- Run this ONCE in the Supabase SQL Editor, AFTER migration_001_currency.sql.
-- Safe to re-run: the anti-join at the bottom skips any (date, stakes) pair
-- this account already has, so a second run inserts nothing.
--
-- Only PnL was recorded for these sessions, so buy_in is 0 and cash_out holds
-- the net result. The app only ever displays (cash_out - buy_in), so this
-- reads correctly everywhere.

-- Fail loudly rather than inserting nothing: if the address below matches no
-- auth.users row, the CTE is empty, the cross join yields zero rows, and the
-- editor just reports success on 0 rows. (The address appears twice — here and
-- in the `me` CTE. Change both.)
do $$
begin
  if not exists (
    select 1 from auth.users where lower(email) = lower('goelarnav12@gmail.com')
  ) then
    raise exception 'No auth.users row matches that email. Sign up in the app first, or correct the address in this script.';
  end if;
end $$;

with me as (
  -- >>> Change this if your Ledger login is a different address. <<<
  select id from auth.users where lower(email) = lower('goelarnav12@gmail.com')
),
incoming(date, location, stakes, buy_in, cash_out, currency, notes) as (
  values
    ('2026-01-09'::date, 'Pranshu''s Game'::text, '50/100'::text, 0::numeric, 14150::numeric, 'INR'::text, 'Imported from spreadsheet; PnL only, buy-in not recorded.'::text),
    ('2026-01-16', 'Pranshu''s Game', '50/100', 0, -30000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-01-23', 'Pranshu''s Game', '50/100', 0, 7750, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-01-25', 'Pranshu''s Game', '50/100', 0, 76150, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-01-31', 'Pranshu''s Game', '50/100', 0, 74150, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-02-01', 'Pranshu''s Game', '50/100', 0, -100000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-02-06', 'Pranshu''s Game', '50/100', 0, 10000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-02-13', 'Pranshu''s Game', '50/100', 0, -50000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-02-15', 'Pranshu''s Game', '50/100', 0, -40000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-02-21', 'Pranshu''s Game', '50/100', 0, -50000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-02-22', 'Pranshu''s Game', '50/100', 0, -20000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-02-27', 'Pranshu''s Game', '50/100', 0, -20000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-03-01', 'Pranshu''s Game', '50/100', 0, 88700, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-03-06', 'Pranshu''s Game', '50/100', 0, -40000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-03-08', 'Pranshu''s Game', '50/100', 0, -20000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-03-13', 'Pranshu''s Game', '50/100', 0, -30000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-03-15', 'Pranshu''s Game', '50/100', 0, -10000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-03-20', 'Pranshu''s Game', '50/100', 0, 51400, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-03-28', 'Venetian Macau', '5/10', 0, 7000, 'HKD', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-04-10', 'Pranshu''s Game', '50/100', 0, 50000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-04-12', 'Pranshu''s Game', '50/100', 0, -30000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-04-13', 'Pranshu''s Game', '50/100', 0, -40000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-04-17', 'Pranshu''s Game', '50/100', 0, 8100, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-04-26', 'Pranshu''s Game', '50/100', 0, 63700, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-05-03', 'Pranshu''s Game', '50/100', 0, -20000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-05-15', 'Pranshu''s Game', '50/100', 0, 20000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-05-22', 'Pranshu''s Game', '50/100', 0, 35000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-05-31', 'Pranshu''s Game', '50/100', 0, 5000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-06-05', 'Pranshu''s Game', '50/100', 0, 60000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-06-07', 'Pranshu''s Game', '50/100', 0, -50000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-06-12', 'Pranshu''s Game', '100/200', 0, 79300, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-06-19', 'Pranshu''s Game', '100/200', 0, -55000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-06-21', 'Pranshu''s Game', '100/200', 0, -20000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-07-03', 'Pranshu''s Game', '100/200', 0, -10000, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-07-10', 'Pranshu''s Game', '100/200', 0, 29400, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.'),
    ('2026-07-18', 'Pranshu''s Game', '100/200', 0, 47500, 'INR', 'Imported from spreadsheet; PnL only, buy-in not recorded.')
)
insert into sessions (user_id, date, location, stakes, buy_in, cash_out, currency, notes)
select me.id, i.date, i.location, i.stakes, i.buy_in, i.cash_out, i.currency, i.notes
from incoming i
cross join me
where not exists (
  select 1 from sessions s
  where s.user_id = me.id and s.date = i.date and s.stakes = i.stakes
);
