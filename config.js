// -----------------------------------------------------------------
// Paste your own Supabase project values below.
// Find them at: Supabase Dashboard -> Project Settings -> API Keys
//   - SUPABASE_URL      = "Project URL"
//   - SUPABASE_ANON_KEY = "Publishable key" (starts with sb_publishable_...)
//                          (older projects: use the "anon" key from the
//                          Legacy API Keys tab instead — works the same way)
// -----------------------------------------------------------------
const SUPABASE_URL = "https://lkizapostyywexkmfjts.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxraXphcG9zdHl5d2V4a21manRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODUxMTAsImV4cCI6MjEwMDA2MTExMH0.DbbRFD04Ue30JFrHzsHLEwSnpDPir4s8EQvt359vxuE";

// -----------------------------------------------------------------
// Currency
//
// Sessions are stored in whatever currency you played in. Totals, both
// charts, and the Net Profit figure are converted to BASE_CURRENCY using
// the rates below — "1 unit of this currency = N units of BASE_CURRENCY".
//
// These are static rates, not live ones. Editing a rate retroactively
// restates every past session in that currency, which is what you want for
// a ledger you read in one denomination, but it does mean the historical
// numbers move when you update it. The dropdown in the add-session form is
// built from these keys, so adding a currency here is all it takes.
// -----------------------------------------------------------------
// Rates are "1 unit of this currency = N units of BASE_CURRENCY".
// Adding a key here is the WHOLE change: the form's dropdown is built from
// Object.keys(FX_RATES), and stats.js already knows the symbols for USD, EUR,
// GBP, SGD, AUD, CAD and JPY. Uncomment or add whatever you actually play in —
// an unused currency is just a longer dropdown.
const BASE_CURRENCY = "INR";
const FX_RATES = {
  INR: 1,
  HKD: 11.15,   // stale: ~12.30 as of Jul 2026 — see the note in README
  USD: 96.5,    // Jul 2026
  // EUR: 112.0,
  // GBP: 129.0,
  // SGD: 75.0,
  // AUD: 63.0,
};

// -----------------------------------------------------------------
// Hands per hour
//
// bb/100 is a rate per hundred hands, but a live ledger records hours — no
// one counts hands at the table. Hands are therefore estimated as
// hours × this number, so the bb/100 figure and its confidence interval are
// only ever as good as this estimate.
//
// 20 suits an unhurried live full-ring game — a slow dealer, players who
// tank, a table that talks. A brisk room runs nearer 30, a 6-max or
// shot-clock game 35-40, and online several times higher.
//
// Changing it rescales bb/100 for every past session — it does not change
// any money figure, which is measured, not estimated. Lowering it RAISES the
// reported rate (the same profit over fewer hands), and widens the interval
// by the same factor, so how much the number can be trusted is unchanged.
// -----------------------------------------------------------------
const HANDS_PER_HOUR = 20;
