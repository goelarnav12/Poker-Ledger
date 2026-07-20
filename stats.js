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
function profitOf(s){ return s.cashOut - s.buyIn; }        // native currency
function profitBase(s){ return toBase(profitOf(s), s.currency); }

// Stakes only mean something next to their currency: a 5/10 HKD game is not the
// 5/10 you'd read in rupees. Used for chart labels and filter chips alike.
function stakesLabel(s){
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

// Every figure returned is in the base currency.
function computeStats(list){
  const chrono = chronological(list);
  const profits = chrono.map(profitBase);
  const n = profits.length;

  const totalProfit = profits.reduce((a,b)=>a+b, 0);
  const wins = profits.filter(p=>p>0).length;

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
    streaks:     streaks(profits)
  };
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
