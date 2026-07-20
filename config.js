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
const BASE_CURRENCY = "INR";
const FX_RATES = {
  INR: 1,
  HKD: 11.15,
};
