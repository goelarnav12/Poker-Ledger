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
// Sessions are stored in whatever currency you played in, and each one
// remembers the rate it was saved at (see migration_006). That frozen rate is
// what every total and chart converts with — so a session played in March
// keeps its March value forever, and the all-time figure settles instead of
// drifting with the market.
//
// THE MAP BELOW IS NO LONGER THE SOURCE OF TRUTH FOR VALUATION. Rates are
// fetched live (rates.js) to prefill the form. This map now does two jobs:
//
//   1. It lists the currencies the dropdown offers. Adding a key is still the
//      whole change needed to support a new one.
//   2. Its numbers are the FALLBACK when the rate service can't be reached and
//      nothing is cached — offline on a plane, say. The form flags it in red
//      when it has fallen back to one of these, because a hand-typed rate can
//      be months old.
//
// Editing a number here therefore no longer restates history. It only changes
// what a NEW session is prefilled with when there's no network.
// -----------------------------------------------------------------
// "1 unit of this currency = N units of BASE_CURRENCY", used only as an
// offline fallback. Adding a key is the whole change needed to offer a
// currency; stats.js already knows the symbols for USD, EUR, GBP, SGD, AUD,
// CAD and JPY, and anything else falls back to its three-letter code.
// The rate service is asked for exactly these codes, so an unused currency is
// a slower fetch as well as a longer dropdown.
const BASE_CURRENCY = "INR";
const FX_RATES = {
  INR: 1,
  HKD: 11.15,
  USD: 96.5,
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
