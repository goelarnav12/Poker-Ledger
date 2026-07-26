// ---------------------------------------------------------------------------
// stats.js — pure logic: currency, formatting, and statistics.
//
// Nothing in here touches the DOM, the network, or app.js state. Every function
// is deterministic: same input, same output. That is the whole point — it makes
// the arithmetic behind the numbers on screen unit-testable, which tests.html
// does. Keep it that way; rendering belongs in app.js.
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS = {
  INR:'₹', HKD:'HK$', USD:'$', EUR:'€', GBP:'£', SGD:'S$', AUD:'A$', CAD:'C$', JPY:'¥'
};

// Currency config is injected rather than read straight from config.js, so the
// tests can pin known rates instead of breaking every time you retune FX_RATES.
let ACTIVE_RATES = typeof FX_RATES     !== 'undefined' ? FX_RATES     : { INR:1 };
let ACTIVE_BASE  = typeof BASE_CURRENCY !== 'undefined' ? BASE_CURRENCY : 'INR';

const warnedCurrencies = new Set();

function setCurrencyConfig(rates, base){
  ACTIVE_RATES = rates;
  ACTIVE_BASE = base;
  warnedCurrencies.clear();
}
function baseCurrency(){ return ACTIVE_BASE; }

// bb/100 is a per-hand rate, but this ledger records hours, not hands — nobody
// counts hands in a live game. So hands are estimated as hours × this, and the
// figure is only ever as good as the estimate. Set in config.js; a slow live
// full-ring game is around 20, a brisk one 30, 6-max or online higher.
// Injectable so the tests can pin it, same as the currency config.
let ACTIVE_HPH = typeof HANDS_PER_HOUR !== 'undefined' ? HANDS_PER_HOUR : 30;
function setHandsPerHour(n){ ACTIVE_HPH = n; }
function handsPerHour(){ return ACTIVE_HPH; }

// ---------- Money ----------
function symbolFor(cur){ return CURRENCY_SYMBOLS[cur] || cur + ' '; }

function rateFor(cur){
  const r = ACTIVE_RATES[cur];
  if(typeof r !== 'number'){
    // Don't silently fold a foreign amount into the base total at 1:1 without
    // saying so — that quietly corrupts every aggregate on the page.
    if(!warnedCurrencies.has(cur)){
      warnedCurrencies.add(cur);
      console.warn(`No FX rate for "${cur}" in config.js — treating it as 1:1 with ${ACTIVE_BASE}. Totals will be wrong until you add it to FX_RATES.`);
    }
    return 1;
  }
  return r;
}

function toBase(amount, cur){ return amount * rateFor(cur); }

// A row with no session_type is a cash game: every session predating
// migration_004 is one, and the column defaults to 'cash' for the same reason.
function isTournament(s){ return s.sessionType === 'tournament'; }

// What the session cost you, in its own currency.
//
// Cash: the buy-in, as it always was. Tournament: every entry costs the
// prize-pool portion PLUS the fee, and you may have entered more than once.
// This is the only place that arithmetic lives — profitOf() reads it, so
// every chart, total and statistic downstream inherits it for free.
function totalCost(s){
  if(!isTournament(s)) return s.buyIn;
  const entries = typeof s.entries === 'number' && s.entries >= 1 ? s.entries : 1;
  const fee = typeof s.fee === 'number' && isFinite(s.fee) ? s.fee : 0;
  return (s.buyIn + fee) * entries;
}

function profitOf(s){ return s.cashOut - totalCost(s); }   // native currency
function profitBase(s){ return toBase(profitOf(s), s.currency); }

// You cashed if you got paid. Deliberately NOT derived from `place`, which is
// optional — you always know whether money came back, you don't always record
// where you busted.
function inTheMoney(s){ return isTournament(s) && s.cashOut > 0; }

// Stakes only mean something next to their currency: a 5/10 HKD game is not the
// 5/10 you'd read in rupees. Used for chart labels and filter chips alike.
// A tournament's `stakes` is its event name, which needs no such qualifying.
function stakesLabel(s){
  if(isTournament(s)) return s.stakes;
  return s.currency === ACTIVE_BASE ? s.stakes : `${s.stakes} (${s.currency})`;
}

// ---------- Formatting ----------
function fmt(n, cur){
  const sign = n < 0 ? '-' : '';
  return sign + symbolFor(cur || ACTIVE_BASE) +
    Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0});
}

// Ledger style: every amount carries an explicit sign, so a column of figures
// reads as credits and debits. Uses a true minus (U+2212), which is the same
// width as + in tabular figures — a hyphen is narrower and breaks alignment.
function fmtSigned(n, cur){
  if(n === 0) return fmt(0, cur);
  return (n > 0 ? '+' : '−') + symbolFor(cur || ACTIVE_BASE) +
    Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0});
}

// Axis labels: ₹163,350 is too wide for a tick, so compact to ₹163.4k.
// Math.round rather than toFixed(1): 163350/1000 is stored a hair under
// 163.35, so toFixed would round it *down* to 163.3.
function fmtAxis(v){
  const a = Math.abs(v), sign = v < 0 ? '-' : '';
  const sym = symbolFor(ACTIVE_BASE);
  return a >= 1000 ? sign + sym + (Math.round(a/100)/10) + 'k' : sign + sym + a;
}

// Big blinds carry a sign like money does, but one decimal rather than none:
// the difference between 4 and 4.4 bb/100 is most of a career.
function fmtBB(n){
  if(!isFinite(n)) return '—';
  const r = Math.abs(n).toFixed(1);
  // Compare the rounded string, not the raw number: -0.04 must print as 0.0
  // without a minus sign in front of it.
  if(parseFloat(r) === 0) return '0.0';
  return (n > 0 ? '+' : '−') + r;
}

function resultClass(n){ return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'; }

function escapeHtml(str){
  // Quotes matter too: these values are interpolated into attributes
  // (e.g. data-stakes="..."), which innerHTML serialization does not escape.
  return String(str ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// Most-used first. Browsers render datalist options in DOM order, so the venue
// you play weekly sits at the top rather than wherever it happens to sort.
function byFrequency(values){
  const counts = new Map();
  values.forEach(v=>{ if(v) counts.set(v, (counts.get(v)||0)+1); });
  return [...counts.entries()]
    .sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]))
    .map(e=>e[0]);
}

// ---------- Statistics ----------
// ISO dates sort correctly as plain strings, so no Date parsing needed.
function chronological(list){
  return [...list].sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

function median(nums){
  if(!nums.length) return 0;
  const s = [...nums].sort((a,b)=>a-b);
  const mid = Math.floor(s.length/2);
  return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2;
}

// Sample standard deviation (n-1). Undefined for a single session, so 0.
function stdDev(nums){
  const n = nums.length;
  if(n < 2) return 0;
  const mean = nums.reduce((a,b)=>a+b,0) / n;
  return Math.sqrt(nums.reduce((s,x)=> s + (x-mean)**2, 0) / (n-1));
}

// Largest peak-to-trough fall in the running bankroll, and how far below the
// all-time peak it currently sits. Peak starts at 0 because the bankroll does:
// if your first session loses, that is already a drawdown.
function drawdown(profitsChrono){
  let cum = 0, peak = 0, max = 0;
  for(const p of profitsChrono){
    cum += p;
    if(cum > peak) peak = cum;
    const dd = peak - cum;
    if(dd > max) max = dd;
  }
  return { max, current: peak - cum };
}

// A break-even session (exactly 0) ends both streaks without starting either.
function streaks(profitsChrono){
  let win = 0, loss = 0, longestWin = 0, longestLoss = 0;
  for(const p of profitsChrono){
    if(p > 0){ win++; loss = 0; }
    else if(p < 0){ loss++; win = 0; }
    else { win = 0; loss = 0; }
    if(win > longestWin) longestWin = win;
    if(loss > longestLoss) longestLoss = loss;
  }
  return { longestWin, longestLoss, currentWin: win, currentLoss: loss };
}

// Hours are optional per session. A session with no hours recorded must be
// excluded from the rate entirely — counting it as zero hours would inflate
// the rate, and counting its profit without its time would deflate it. So the
// hourly figure is derived only from sessions that have both.
function timedSessions(list){
  return list.filter(s => typeof s.hours === 'number' && isFinite(s.hours) && s.hours > 0);
}

// ---------- Tags ----------
function sessionTags(s){ return Array.isArray(s.tags) ? s.tags : []; }
function hasTag(s, tag){ return sessionTags(s).includes(tag); }

// Most-used first, matching how the venue and stakes suggestions are ordered.
function allTags(list){
  return byFrequency(list.flatMap(sessionTags));
}

// Tags are typed by hand, so normalise before storing: lowercase, trimmed,
// deduped, and blanks dropped. Without this "Tilted", "tilted " and "tilted"
// become three chips for one idea.
function parseTags(input){
  return [...new Set(
    String(input ?? '')
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
  )];
}

// ---------- Cash-game win rate (bb/100) ----------
// The big blind is the second number in the stakes string: "50/100" is 100,
// and "2/5/10" (a straddled game) is still 5. Anything without two numbers —
// notably a tournament's event name — has no big blind, and returns null
// rather than a guess.
function parseBigBlind(stakes){
  const nums = String(stakes ?? '').match(/\d+(?:\.\d+)?/g);
  if(!nums || nums.length < 2) return null;
  const bb = parseFloat(nums[1]);
  return isFinite(bb) && bb > 0 ? bb : null;
}

// Profit measured in big blinds. This is why bb/100 needs no FX conversion:
// profit and the big blind are both in the session's own currency, so the
// ratio is dimensionless and a HKD session pools with an INR one directly.
function profitInBB(s){
  const bb = parseBigBlind(s.stakes);
  return bb === null ? null : profitOf(s) / bb;
}

// A session counts toward bb/100 only if it is cash, has a parseable big
// blind, and has hours recorded — hands are derived from hours, so a session
// with no hours has no denominator and must be dropped rather than assumed.
function bbSessions(list){
  return list.filter(s =>
    !isTournament(s) &&
    typeof s.hours === 'number' && isFinite(s.hours) && s.hours > 0 &&
    parseBigBlind(s.stakes) !== null
  );
}

// Win rate in bb/100 with a confidence interval around it.
//
// The interval is the point of this function. A poker win rate over a few
// hundred hours is mostly noise, and a bare "4.2 bb/100" invites you to
// believe it; "4.2, somewhere between −1.8 and +10.2" tells you the truth,
// which is that you do not yet know.
//
// Returns null when nothing qualifies, so the caller can hide the row instead
// of printing a zero that looks like a measurement.
function winRateCI(list, z = 1.96){          // z = 1.96 is the 95% interval
  const usable = bbSessions(list);
  const n = usable.length;
  if(!n) return null;

  const rows = usable.map(s => ({ bb: profitInBB(s), hands: s.hours * ACTIVE_HPH }));
  const hands = rows.reduce((a,r)=> a + r.hands, 0);
  const bb    = rows.reduce((a,r)=> a + r.bb, 0);
  if(hands <= 0) return null;

  const perHand  = bb / hands;
  const bbPer100 = perHand * 100;
  const base = { bbPer100, hands, sessions: n, bb, hours: hands / ACTIVE_HPH };

  // One session gives a point but no spread — there is nothing to be
  // confident or unconfident about yet.
  if(n < 2) return { ...base, sdPer100: null, se: null, low: null, high: null };

  // Variance per hand, pooled across sessions of different lengths. Each
  // session's residual is how far its result strayed from what its own length
  // predicted; dividing the squared residual by that session's hands is what
  // makes a 10-hour session comparable with a 2-hour one, because a random
  // walk's variance grows linearly with its length.
  const varPerHand = rows.reduce((acc, r) => {
    const resid = r.bb - perHand * r.hands;
    return acc + (resid * resid) / r.hands;
  }, 0) / (n - 1);

  // Variance scales with hands, so SD over 100 hands is sqrt(100 · varPerHand)
  // — NOT 100 × the per-hand SD. Live NLHE typically lands near 80–100 bb/100;
  // a figure far outside that usually means the stakes string is being parsed
  // wrong, not that your game is unusual.
  const sdPer100 = Math.sqrt(varPerHand * 100);
  const se = Math.sqrt(varPerHand / hands) * 100;

  return { ...base, sdPer100, se, low: bbPer100 - z * se, high: bbPer100 + z * se };
}

// ---------- Tournaments ----------
// Every money figure is converted to the base currency, because unlike bb/100
// these are absolute amounts that have to pool across currencies.
function tournamentStats(list){
  const t = list.filter(isTournament);
  const n = t.length;
  if(!n){
    return { count:0, cost:0, winnings:0, profit:0, roi:0,
             itm:0, itmRate:0, bestPlace:null, entries:0, avgField:null };
  }

  const cost     = t.reduce((a,s)=> a + toBase(totalCost(s), s.currency), 0);
  const winnings = t.reduce((a,s)=> a + toBase(s.cashOut, s.currency), 0);
  const itm      = t.filter(inTheMoney).length;
  const entries  = t.reduce((a,s)=> a + (typeof s.entries === 'number' && s.entries >= 1 ? s.entries : 1), 0);

  const placed = t.filter(s => typeof s.place === 'number' && s.place >= 1);
  const fields = t.filter(s => typeof s.fieldSize === 'number' && s.fieldSize >= 1);

  return {
    count: n,
    cost,
    winnings,
    profit: winnings - cost,
    // ROI is return on what you actually spent, so re-entries are already in
    // the denominator via totalCost(). Guarded because a freeroll costs 0.
    roi: cost > 0 ? (winnings - cost) / cost * 100 : 0,
    itm,
    itmRate: itm / n * 100,
    bestPlace: placed.length ? Math.min(...placed.map(s=>s.place)) : null,
    entries,
    avgField: fields.length
      ? fields.reduce((a,s)=> a + s.fieldSize, 0) / fields.length
      : null
  };
}

// Every figure returned is in the base currency.
function computeStats(list){
  const chrono = chronological(list);
  const profits = chrono.map(profitBase);
  const n = profits.length;

  const totalProfit = profits.reduce((a,b)=>a+b, 0);
  const wins = profits.filter(p=>p>0).length;

  // Hourly rate is a CASH figure. A tournament's return is measured as ROI —
  // its length is set by the structure rather than by you, so rupees-per-hour
  // says more about the blind levels than about how you played.
  const cash = chrono.filter(s => !isTournament(s));
  const timed = timedSessions(cash);
  const totalHours = timed.reduce((a,s)=> a + s.hours, 0);
  const timedProfit = timed.reduce((a,s)=> a + profitBase(s), 0);

  return {
    count:       n,
    totalProfit,
    winRate:     n ? wins/n*100 : 0,
    avg:         n ? totalProfit/n : 0,
    median:      median(profits),
    stdDev:      stdDev(profits),
    best:        n ? Math.max(...profits) : 0,
    worst:       n ? Math.min(...profits) : 0,
    drawdown:    drawdown(profits),
    streaks:     streaks(profits),
    totalHours,
    timedCount:  timed.length,      // how many sessions the rate is based on
    hourly:      totalHours > 0 ? timedProfit / totalHours : 0,
    cashCount:   cash.length,
    bb:          winRateCI(cash),   // null until a cash session has hours
    tourney:     tournamentStats(chrono)
  };
}

// ---------- Date ranges ----------
// `today` is injectable so this is testable without freezing the clock.
function isoDate(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// A range is either a preset, 'all', or a literal 'YYYY-MM' meaning one month
// — which is what clicking a bar on the by-month chart selects.
function matchesRange(dateStr, range, today){
  if(!range || range === 'all') return true;
  if(/^\d{4}-\d{2}$/.test(range)) return dateStr.slice(0,7) === range;

  const d = today ? new Date(today) : new Date();
  if(range === 'thisMonth') return dateStr >= `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  if(range === 'thisYear')  return dateStr >= `${d.getFullYear()}-01-01`;
  if(range === '90d'){
    const p = new Date(d); p.setDate(p.getDate() - 89);   // inclusive of today
    return dateStr >= isoDate(p);
  }
  return true;   // unknown range never hides anything
}

function rangeLabel(range){
  if(!range || range === 'all') return 'All time';
  if(range === 'thisMonth') return 'This month';
  if(range === 'thisYear')  return 'This year';
  if(range === '90d')       return '90 days';
  if(/^\d{4}-\d{2}$/.test(range)){
    return new Date(range + '-01T00:00:00')
      .toLocaleDateString(undefined,{month:'short', year:'numeric'});
  }
  return range;
}

// ---------- CSV ----------
// RFC 4180: quote a field only when it contains a comma, quote or newline, and
// escape embedded quotes by doubling them.
function csvCell(v){
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// A backup has to round-trip, so every stored field appears here — including
// the tournament columns that are blank on most rows. `total_cost` is derived
// rather than stored, but a CSV read by a human is worth the one extra column:
// without it a tournament row's profit looks like arithmetic that doesn't add
// up, because the fee and the re-entries are invisible.
function toCSV(list){
  const head = ['date','type','location','stakes','buy_in','fee','entries',
                'cash_out','currency','hours','place','field_size','tags',
                'notes','total_cost','profit','profit_' + ACTIVE_BASE.toLowerCase()];
  const num = v => (typeof v === 'number' && isFinite(v) ? v : '');
  const rows = chronological(list).map(s => [
    s.date,
    isTournament(s) ? 'tournament' : 'cash',
    s.location, s.stakes,
    s.buyIn,
    num(s.fee), num(s.entries),
    s.cashOut, s.currency,
    num(s.hours),
    num(s.place), num(s.fieldSize),
    sessionTags(s).join(' '),      // space-separated: commas would need quoting
    s.notes || '',
    totalCost(s),
    profitOf(s),
    Math.round(profitBase(s))
  ].map(csvCell).join(','));
  return [head.join(','), ...rows].join('\r\n');   // CRLF per spec; Excel prefers it
}

// Profit per calendar month, oldest first, in the base currency.
function monthlyTotals(list){
  const buckets = new Map();
  chronological(list).forEach(s=>{
    const key = s.date.slice(0,7);              // 'YYYY-MM'
    buckets.set(key, (buckets.get(key)||0) + profitBase(s));
  });
  return [...buckets.entries()].map(([key,total])=>({
    key,
    total,
    label: new Date(key+'-01T00:00:00')
      .toLocaleDateString(undefined,{month:'short', year:'2-digit'})
  }));
}
