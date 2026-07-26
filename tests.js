// Tests for stats.js. Open tests.html in a browser to run them.
// No framework, no build step — same constraints as the rest of the app.

const results = [];
function check(name, fn){
  try {
    const detail = fn();
    results.push({name, pass:true, detail: detail || ''});
  } catch(e){
    results.push({name, pass:false, detail: e.message});
  }
}
function eq(actual, expected, what){
  if(actual !== expected){
    throw new Error(`${what||''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
// Money is floating point; compare within a tolerance rather than exactly.
function near(actual, expected, what, tol=0.001){
  if(!(Math.abs(actual-expected) <= tol)){
    throw new Error(`${what||''} expected ~${expected}, got ${actual}`);
  }
}

// Pin the rates so these tests don't break when config.js is retuned.
setCurrencyConfig({INR:1, HKD:11.15}, 'INR');
// Same reason: bb/100 is derived from hands, and hands from this.
setHandsPerHour(30);

const S = (date, stakes, pnl, currency='INR', location="Pranshu's Game") =>
  ({id:date, date, stakes, location, buyIn:0, cashOut:pnl, currency, notes:''});

// A tournament row. `stakes` carries the event name, and cost is
// (buyIn + fee) × entries rather than just the buy-in.
const T = (date, event, buyIn, fee, entries, cashOut, extra={}) =>
  ({id:date, date, stakes:event, location:'Casino', sessionType:'tournament',
    buyIn, fee, entries, cashOut, currency:'INR', notes:'', ...extra});

// The real ledger: 35 INR sessions plus one HKD session at Venetian Macau.
const LEDGER = [
  S('2026-01-09','50/100',14150),  S('2026-01-16','50/100',-30000), S('2026-01-23','50/100',7750),
  S('2026-01-25','50/100',76150),  S('2026-01-31','50/100',74150),  S('2026-02-01','50/100',-100000),
  S('2026-02-06','50/100',10000),  S('2026-02-13','50/100',-50000), S('2026-02-15','50/100',-40000),
  S('2026-02-21','50/100',-50000), S('2026-02-22','50/100',-20000), S('2026-02-27','50/100',-20000),
  S('2026-03-01','50/100',88700),  S('2026-03-06','50/100',-40000), S('2026-03-08','50/100',-20000),
  S('2026-03-13','50/100',-30000), S('2026-03-15','50/100',-10000), S('2026-03-20','50/100',51400),
  S('2026-03-28','5/10',7000,'HKD','Venetian Macau'),
  S('2026-04-10','50/100',50000),  S('2026-04-12','50/100',-30000), S('2026-04-13','50/100',-40000),
  S('2026-04-17','50/100',8100),   S('2026-04-26','50/100',63700),  S('2026-05-03','50/100',-20000),
  S('2026-05-15','50/100',20000),  S('2026-05-22','50/100',35000),  S('2026-05-31','50/100',5000),
  S('2026-06-05','50/100',60000),  S('2026-06-07','50/100',-50000), S('2026-06-12','100/200',79300),
  S('2026-06-19','100/200',-55000),S('2026-06-21','100/200',-20000),S('2026-07-03','100/200',-10000),
  S('2026-07-10','100/200',29400), S('2026-07-18','100/200',47500)
];

// ---------- formatting ----------
check('fmt renders base currency', ()=>{
  eq(fmt(14150), '₹14,150');
  eq(fmt(-100000), '-₹100,000');
  eq(fmt(0), '₹0');
});
check('fmt renders a foreign currency', ()=> eq(fmt(7000,'HKD'), 'HK$7,000'));
check('fmt falls back to the code for an unknown symbol', ()=> eq(fmt(5,'XYZ'), 'XYZ 5'));
check('fmtSigned always carries a sign', ()=>{
  eq(fmtSigned(47500), '+₹47,500');
  eq(fmtSigned(-10000), '−₹10,000');   // true minus, not hyphen
  eq(fmtSigned(0), '₹0');                  // zero is unsigned
  eq(fmtSigned(7000,'HKD'), '+HK$7,000');
});
check('fmtSigned uses U+2212 so columns align', ()=>{
  if(fmtSigned(-1).includes('-')) throw new Error('used ASCII hyphen, not U+2212');
});
check('fmtAxis compacts thousands', ()=>{
  eq(fmtAxis(163350), '₹163.4k');
  eq(fmtAxis(-30000), '-₹30k');
  eq(fmtAxis(500), '₹500');
});
check('escapeHtml escapes quotes as well as angle brackets', ()=>{
  eq(escapeHtml(`<script>"x"&'y'`), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
  eq(escapeHtml(null), '');
  eq(escapeHtml("Pranshu's Game"), 'Pranshu&#39;s Game');
});
check('resultClass maps sign to class', ()=>{
  eq(resultClass(1),'pos'); eq(resultClass(-1),'neg'); eq(resultClass(0),'zero');
});

// ---------- currency ----------
check('toBase converts using the configured rate', ()=>{
  near(toBase(7000,'HKD'), 78050);
  eq(toBase(100,'INR'), 100);
});
check('unknown currency degrades to 1:1 rather than NaN', ()=> eq(rateFor('XYZ'), 1));
check('stakesLabel qualifies only non-base currencies', ()=>{
  eq(stakesLabel(S('2026-01-01','50/100',1)), '50/100');
  eq(stakesLabel(S('2026-01-01','5/10',1,'HKD')), '5/10 (HKD)');
});

// ---------- helpers ----------
check('byFrequency orders by count then alphabetically', ()=>{
  eq(byFrequency(['b','a','b','c','b','a']).join(','), 'b,a,c');
  eq(byFrequency([]).length, 0);
});
check('byFrequency drops empty values', ()=> eq(byFrequency(['a','',null,'a']).join(','), 'a'));
check('median handles odd and even lengths', ()=>{
  eq(median([3,1,2]), 2);
  eq(median([4,1,3,2]), 2.5);
  eq(median([]), 0);
});
check('stdDev is 0 for fewer than two values', ()=>{
  eq(stdDev([]), 0); eq(stdDev([5]), 0);
});
check('stdDev matches a hand-checked sample', ()=> near(stdDev([2,4,4,4,5,5,7,9]), 2.13809, '', 0.0001));

// ---------- drawdown & streaks ----------
check('drawdown measures from the running peak, starting at zero', ()=>{
  const d = drawdown([100,-30,-20,60]);
  near(d.max, 50, 'max');       // peak 100 -> trough 50
  near(d.current, 0, 'current'); // ends at a new peak of 110
});
check('a losing first session is already a drawdown', ()=>{
  const d = drawdown([-40,10]);
  near(d.max, 40); near(d.current, 30);
});
check('drawdown of nothing is zero', ()=>{
  const d = drawdown([]); near(d.max,0); near(d.current,0);
});
check('streaks count consecutive runs', ()=>{
  const s = streaks([1,1,1,-1,-1,1]);
  eq(s.longestWin,3,'longestWin'); eq(s.longestLoss,2,'longestLoss');
  eq(s.currentWin,1,'currentWin'); eq(s.currentLoss,0,'currentLoss');
});
check('a break-even session ends both streaks', ()=>{
  const s = streaks([1,1,0,1]);
  eq(s.longestWin,2,'longestWin'); eq(s.currentWin,1,'currentWin');
});

// ---------- computeStats ----------
check('computeStats on an empty ledger yields no NaN or Infinity', ()=>{
  const st = computeStats([]);
  Object.entries(st).forEach(([k,v])=>{
    if(typeof v === 'number' && !Number.isFinite(v)) throw new Error(`${k} is ${v}`);
  });
  eq(st.count,0); eq(st.best,0); eq(st.worst,0); eq(st.winRate,0); eq(st.median,0);
});
check('computeStats on a single session', ()=>{
  const st = computeStats([S('2026-01-01','1/2',500)]);
  eq(st.count,1); near(st.totalProfit,500); near(st.median,500);
  eq(st.winRate,100); eq(st.stdDev,0);
  eq(st.streaks.longestWin,1);
});

check('computeStats matches the real 36-session ledger', ()=>{
  const st = computeStats(LEDGER);
  eq(st.count, 36, 'count');
  near(st.totalProfit, 163350, 'totalProfit');
  near(st.winRate, 50, 'winRate');
  near(st.avg, 4537.5, 'avg');
  near(st.median, -2500, 'median');
  near(st.stdDev, 47516.9088, 'stdDev', 0.001);
  near(st.best, 88700, 'best');
  near(st.worst, -100000, 'worst');
  near(st.drawdown.max, 281300, 'drawdown.max');
  near(st.drawdown.current, 8100, 'drawdown.current');
  eq(st.streaks.longestWin, 4, 'longestWin');
  eq(st.streaks.longestLoss, 5, 'longestLoss');
  return 'net ₹163,350 · median -₹2,500 · max DD ₹281,300';
});

check('computeStats does not depend on input order', ()=>{
  const shuffled = [...LEDGER].sort(()=>Math.random()-0.5);
  const a = computeStats(LEDGER), b = computeStats(shuffled);
  near(b.drawdown.max, a.drawdown.max, 'drawdown.max');
  eq(b.streaks.longestLoss, a.streaks.longestLoss, 'longestLoss');
  near(b.totalProfit, a.totalProfit, 'totalProfit');
});

check('the HKD session is converted, not counted at face value', ()=>{
  const withHkd = computeStats(LEDGER).totalProfit;
  const withoutHkd = computeStats(LEDGER.filter(s=>s.currency==='INR')).totalProfit;
  near(withoutHkd, 85300, 'INR-only total');
  near(withHkd - withoutHkd, 78050, 'HKD contribution');
});

// ---------- hours ----------
check('hourly rate uses only sessions that have hours', ()=>{
  const list = [
    {...S('2026-01-01','1/2',600), hours:3},   // +200/hr
    {...S('2026-01-02','1/2',400), hours:2},   // +200/hr
    S('2026-01-03','1/2',99999)                // no hours: must be excluded
  ];
  const st = computeStats(list);
  eq(st.timedCount, 2, 'timedCount');
  near(st.totalHours, 5, 'totalHours');
  near(st.hourly, 200, 'hourly');   // 1000/5, NOT (1000+99999)/5
});
check('hourly is 0 when no session has hours, never NaN', ()=>{
  const st = computeStats([S('2026-01-01','1/2',500)]);
  eq(st.timedCount, 0); eq(st.totalHours, 0); eq(st.hourly, 0);
});
check('zero and negative hours are treated as not recorded', ()=>{
  const st = computeStats([
    {...S('2026-01-01','1/2',500), hours:0},
    {...S('2026-01-02','1/2',500), hours:-2}
  ]);
  eq(st.timedCount, 0); eq(st.hourly, 0);
});
check('hourly converts foreign currency before dividing', ()=>{
  const st = computeStats([{...S('2026-01-01','5/10',1000,'HKD'), hours:10}]);
  near(st.hourly, 1115, 'hourly');   // 1000 * 11.15 / 10
});

// ---------- date ranges ----------
const TODAY = '2026-07-20T12:00:00';
check('all-time matches everything', ()=>{
  eq(matchesRange('2020-01-01','all',TODAY), true);
  eq(matchesRange('2020-01-01',null,TODAY), true);
});
check('thisMonth is the calendar month, not a rolling 30 days', ()=>{
  eq(matchesRange('2026-07-01','thisMonth',TODAY), true);
  eq(matchesRange('2026-06-30','thisMonth',TODAY), false);
});
check('thisYear is the calendar year', ()=>{
  eq(matchesRange('2026-01-01','thisYear',TODAY), true);
  eq(matchesRange('2025-12-31','thisYear',TODAY), false);
});
check('90d is inclusive of today and of the 90th day back', ()=>{
  eq(matchesRange('2026-07-20','90d',TODAY), true, 'today');
  eq(matchesRange('2026-04-22','90d',TODAY), true, '90th day back');
  eq(matchesRange('2026-04-21','90d',TODAY), false, 'one day too early');
});
check('a YYYY-MM range selects exactly that month', ()=>{
  eq(matchesRange('2026-02-15','2026-02',TODAY), true);
  eq(matchesRange('2026-03-01','2026-02',TODAY), false);
  eq(matchesRange('2025-02-15','2026-02',TODAY), false);
});
check('an unrecognised range hides nothing', ()=> eq(matchesRange('2026-01-01','nonsense',TODAY), true));
check('rangeLabel names each range', ()=>{
  eq(rangeLabel('all'), 'All time');
  eq(rangeLabel('90d'), '90 days');
  eq(rangeLabel('thisMonth'), 'This month');
  return rangeLabel('2026-02');
});

// ---------- exchange rates ----------
check('a session with no rate recorded falls back to the current one', ()=>{
  // Every row predating migration_006 is this case.
  near(sessionRate(S('2026-01-01','1/2',100,'HKD')), 11.15);
  near(sessionRate(S('2026-01-01','1/2',100)), 1, 'base currency');
});
check('a frozen rate beats the current one', ()=>{
  const s = {...S('2026-03-28','5/10',7000,'HKD'), fxRate: 12.30};
  near(sessionRate(s), 12.30);
  near(profitBase(s), 86100, 'valued at its own rate, not config');
});
check('freezing is what stops history moving when rates change', ()=>{
  const frozen = {...S('2026-03-28','5/10',7000,'HKD'), fxRate: 11.15};
  const floating = S('2026-03-28','5/10',7000,'HKD');
  near(profitBase(frozen), 78050, 'before');
  near(profitBase(floating), 78050, 'before');
  setCurrencyConfig({INR:1, HKD:12.30}, 'INR');       // the world moves on
  near(profitBase(frozen), 78050, 'frozen session is unchanged');
  near(profitBase(floating), 86100, 'unpinned session is revalued');
  setCurrencyConfig({INR:1, HKD:11.15}, 'INR');       // restore for what follows
});
check('a nonsense frozen rate is ignored rather than trusted', ()=>{
  for(const bad of [0, -1, NaN, Infinity, null, undefined, '12.3']){
    near(sessionRate({...S('2026-01-01','1/2',100,'HKD'), fxRate: bad}), 11.15, String(bad));
  }
});
check('a tournament converts at its own frozen rate', ()=>{
  const st = tournamentStats([
    {...T('2026-01-01','Macau Main',100,0,1,300), currency:'HKD', fxRate:12.30}
  ]);
  near(st.cost, 1230, 'cost');
  near(st.winnings, 3690, 'winnings');
  near(st.profit, 2460);
});
check('invertQuotes flips the API into base-per-unit', ()=>{
  // Frankfurter quotes base->X. One rupee buys 0.01036 dollars, so one dollar
  // is ~96.5 rupees. Flipping this the wrong way is a 10,000x error.
  const r = invertQuotes({USD:0.01036, HKD:0.08122}, 'INR');
  near(r.USD, 96.525, 'USD', 0.01);
  near(r.HKD, 12.312, 'HKD', 0.01);
  eq(r.INR, 1, 'the base is always 1 of itself');
});
check('invertQuotes drops quotes it cannot use', ()=>{
  const r = invertQuotes({USD:0, HKD:-1, EUR:'x', GBP:null, SGD:0.0133}, 'INR');
  eq('USD' in r, false); eq('HKD' in r, false);
  eq('EUR' in r, false); eq('GBP' in r, false);
  near(r.SGD, 75.19, 'the good one survives', 0.01);
});
check('invertQuotes survives an empty or absent payload', ()=>{
  eq(Object.keys(invertQuotes({}, 'INR')).join(''), 'INR');
  eq(Object.keys(invertQuotes(null, 'INR')).join(''), 'INR');
});
check('ratesFromPayload rejects a response with no usable quote', ()=>{
  eq(ratesFromPayload(null, 'INR'), null);
  eq(ratesFromPayload({rates:{}}, 'INR'), null, 'base alone is not rates');
  eq(ratesFromPayload({rates:{USD:0}}, 'INR'), null, 'all quotes unusable');
});
check('ratesFromPayload keeps the date the rates are from', ()=>{
  const r = ratesFromPayload({rates:{USD:0.01036}, date:'2026-07-24'}, 'INR');
  eq(r.date, '2026-07-24');
  eq(r.base, 'INR');
  near(r.rates.USD, 96.525, 'USD', 0.01);
  eq(typeof r.fetchedAt, 'number');
});
check('formatRate trims to four places and rejects nonsense', ()=>{
  eq(formatRate(12.3), '12.3');
  eq(formatRate(96.52509), '96.5251');
  eq(formatRate(1), '1');
  eq(formatRate(0), '');
  eq(formatRate(-2), '');
  eq(formatRate(NaN), '');
  eq(formatRate(undefined), '');
});

// ---------- tournaments ----------
check('a row with no session_type is a cash game', ()=>{
  const s = S('2026-01-01','1/2',500);
  eq(isTournament(s), false);
  eq(totalCost({...s, buyIn:300}), 300, 'cost is just the buy-in');
});
check('tournament cost includes the fee and every entry', ()=>{
  eq(totalCost(T('2026-01-01','Main',1000,100,1,0)), 1100, 'freezeout');
  eq(totalCost(T('2026-01-01','Main',1000,100,3,0)), 3300, 'two re-entries');
  eq(totalCost(T('2026-01-01','Main',1000,0,1,0)), 1000, 'no fee');
});
check('a missing entries or fee is treated as one entry and no fee', ()=>{
  eq(totalCost({...T('2026-01-01','Main',1000,null,null,0)}), 1000);
});
check('tournament profit subtracts the whole cost, not the buy-in', ()=>{
  // Busting a 1000+100 you re-entered twice loses 3300, not 1000.
  eq(profitOf(T('2026-01-01','Main',1000,100,3,0)), -3300);
  eq(profitOf(T('2026-01-01','Main',1000,100,3,5000)), 1700);
});
check('in the money is decided by the payout, not the recorded place', ()=>{
  eq(inTheMoney(T('2026-01-01','Main',1000,100,1,5000)), true);
  eq(inTheMoney(T('2026-01-01','Main',1000,100,1,0)), false);
  // place unrecorded but paid: still a cash
  eq(inTheMoney(T('2026-01-01','Main',1000,100,1,5000,{place:null})), true);
  eq(inTheMoney(S('2026-01-01','1/2',5000)), false, 'a cash game is never ITM');
});
check('tournamentStats reports ROI over what was actually spent', ()=>{
  const st = tournamentStats([
    T('2026-01-01','Main',1000,100,1,0),        // cost 1100, bust
    T('2026-01-08','Main',1000,100,2,5000)      // cost 2200, cashed
  ]);
  eq(st.count, 2);
  eq(st.entries, 3, 'entries counts re-entries');
  near(st.cost, 3300, 'cost');
  near(st.winnings, 5000, 'winnings');
  near(st.profit, 1700, 'profit');
  near(st.roi, 1700/3300*100, 'roi');
  eq(st.itm, 1);
  near(st.itmRate, 50, 'itm rate');
});
check('tournamentStats records the best finish and average field', ()=>{
  const st = tournamentStats([
    T('2026-01-01','Main',1000,0,1,5000,{place:12, fieldSize:200}),
    T('2026-01-08','Main',1000,0,1,0,     {place:80, fieldSize:100}),
    T('2026-01-15','Main',1000,0,1,0)     // no place recorded at all
  ]);
  eq(st.bestPlace, 12, 'best finish');
  near(st.avgField, 150, 'average field over the two that recorded one');
});
check('tournamentStats on no tournaments is zeroed, never NaN', ()=>{
  const st = tournamentStats(LEDGER);
  eq(st.count, 0); eq(st.roi, 0); eq(st.itmRate, 0); eq(st.bestPlace, null);
  eq(Number.isFinite(st.profit), true);
});
check('a freeroll cannot divide by zero', ()=>{
  const st = tournamentStats([T('2026-01-01','Freeroll',0,0,1,500)]);
  eq(st.roi, 0, 'no cost means no return on it');
  near(st.profit, 500);
});
check('tournaments convert to the base currency before pooling', ()=>{
  const st = tournamentStats([
    {...T('2026-01-01','Macau Main',100,0,1,300), currency:'HKD'}
  ]);
  near(st.cost, 1115, 'cost');        // 100 * 11.15
  near(st.winnings, 3345, 'winnings');
  near(st.profit, 2230);
});

// ---------- bb/100 ----------
check('parseBigBlind takes the second number in the stakes', ()=>{
  eq(parseBigBlind('1/2'), 2);
  eq(parseBigBlind('50/100'), 100);
  eq(parseBigBlind('2/5/10'), 5, 'a straddled game still has a bb of 5');
  eq(parseBigBlind('5/10 (HKD)'), 10);
  eq(parseBigBlind('0.5/1'), 1);
});
check('parseBigBlind returns null rather than guessing', ()=>{
  eq(parseBigBlind('Sunday Million'), null, 'an event name has no big blind');
  eq(parseBigBlind('100'), null, 'one number is not a blind level');
  eq(parseBigBlind(''), null);
  eq(parseBigBlind(null), null);
  eq(parseBigBlind('0/0'), null, 'a zero big blind would divide by zero');
});
check('fmtBB signs to one decimal and never prints a negative zero', ()=>{
  eq(fmtBB(4.25), '+4.3');
  eq(fmtBB(-1.84), '−1.8');      // true minus, matching fmtSigned
  eq(fmtBB(0), '0.0');
  eq(fmtBB(-0.04), '0.0', 'rounds to zero, so carries no sign');
  eq(fmtBB(Infinity), '—');
});
check('winRateCI needs hours, so a ledger without them yields null', ()=>{
  eq(winRateCI(LEDGER), null);
});
check('bb/100 is profit in big blinds over hands, hands being hours x 30', ()=>{
  // 1/2 game: +200 is 100bb. 10 hours is 300 hands. 100/300 * 100 = 33.33
  const r = winRateCI([{...S('2026-01-01','1/2',200), hours:10}]);
  near(r.bbPer100, 100/3, 'bb/100');
  eq(r.hands, 300, 'hands');
  eq(r.sessions, 1);
  eq(r.low, null, 'one session gives no interval');
});
check('the confidence interval widens with the spread of results', ()=>{
  const r = winRateCI([
    {...S('2026-01-01','1/2', 200), hours:10},   // +100bb over 300 hands
    {...S('2026-01-02','1/2',-100), hours:10}    //  -50bb over 300 hands
  ]);
  near(r.bbPer100, 50/600*100, 'bb/100');        // 8.333
  near(r.sdPer100, Math.sqrt(3750), 'sd per 100');
  near(r.se, 25, 'standard error');
  near(r.low, 50/600*100 - 1.96*25, 'lower bound');
  near(r.high, 50/600*100 + 1.96*25, 'upper bound');
});
check('bb/100 needs no currency conversion', ()=>{
  // A 5/10 HKD session won 100 HKD = 10bb. A 50/100 INR session won 1000 = 10bb.
  // Pooled they are 20bb over 600 hands regardless of the exchange rate.
  const r = winRateCI([
    {...S('2026-01-01','5/10',100,'HKD'), hours:10},
    {...S('2026-01-02','50/100',1000),    hours:10}
  ]);
  near(r.bb, 20, 'big blinds won');
  near(r.bbPer100, 20/600*100, 'bb/100');
});
check('bb/100 excludes tournaments and unparseable stakes', ()=>{
  const r = winRateCI([
    {...S('2026-01-01','1/2',200), hours:10},
    {...T('2026-01-02','Sunday Million',1000,100,1,9999), hours:10},
    {...S('2026-01-03','Home game',5000), hours:10}   // no blind level to read
  ]);
  eq(r.sessions, 1, 'only the cash game with a readable big blind counts');
  near(r.bbPer100, 100/3);
});
check('changing hands per hour rescales bb/100 but not the money', ()=>{
  const list = [{...S('2026-01-01','1/2',200), hours:10}];
  const at30 = winRateCI(list).bbPer100;
  setHandsPerHour(60);
  const at60 = winRateCI(list).bbPer100;
  setHandsPerHour(30);                       // restore for everything after
  near(at60, at30/2, 'twice the hands, half the rate per hundred');
  near(computeStats(list).totalProfit, 200, 'money is measured, not estimated');
});

// ---------- one bankroll, separate analysis ----------
check('computeStats totals cash and tournaments into one net profit', ()=>{
  const st = computeStats([
    S('2026-01-01','1/2',500),
    T('2026-01-08','Main',1000,100,1,3000)     // profit 1900
  ]);
  eq(st.count, 2, 'both formats are sessions');
  near(st.totalProfit, 2400, 'one bankroll');
  eq(st.cashCount, 1);
  eq(st.tourney.count, 1);
});
check('the hourly rate ignores tournament hours', ()=>{
  const st = computeStats([
    {...S('2026-01-01','1/2',1000), hours:5},
    {...T('2026-01-08','Main',1000,0,1,9000), hours:10}   // +8000 over 10h
  ]);
  eq(st.timedCount, 1, 'only the cash session');
  near(st.totalHours, 5, 'hours');
  near(st.hourly, 200, 'the tournament must not drag the cash rate up');
});
check('an all-cash ledger is unchanged by the tournament code', ()=>{
  const st = computeStats(LEDGER);
  eq(st.count, 36);
  near(st.totalProfit, 163350, 'total');   // same figure as before migration_004
  eq(st.tourney.count, 0);
});

// ---------- tags ----------
check('parseTags lowercases, trims, dedupes and drops blanks', ()=>{
  eq(parseTags('Tilted, tilted , SHORT-HANDED,,  ').join('|'), 'tilted|short-handed');
  eq(parseTags('').length, 0);
  eq(parseTags(null).length, 0);
  eq(parseTags('one').join('|'), 'one');
});
check('sessionTags is empty rather than undefined for an untagged session', ()=>{
  eq(sessionTags(S('2026-01-01','1/2',100)).length, 0);
  eq(hasTag(S('2026-01-01','1/2',100), 'tilted'), false);
});
check('hasTag matches an exact tag', ()=>{
  const s = {...S('2026-01-01','1/2',100), tags:['tilted','late']};
  eq(hasTag(s,'tilted'), true);
  eq(hasTag(s,'late'), true);
  eq(hasTag(s,'til'), false, 'not a substring match');
});
check('allTags lists every tag once, most used first', ()=>{
  const list = [
    {...S('2026-01-01','1/2',1), tags:['late','tilted']},
    {...S('2026-01-02','1/2',1), tags:['late']},
    {...S('2026-01-03','1/2',1), tags:['late','drunk']},
    {...S('2026-01-04','1/2',1)}
  ];
  eq(allTags(list).join('|'), 'late|drunk|tilted');   // 3, then 1s alphabetically
});

// ---------- CSV ----------
check('csvCell quotes only when it must', ()=>{
  eq(csvCell('plain'), 'plain');
  eq(csvCell('has,comma'), '"has,comma"');
  eq(csvCell('has"quote'), '"has""quote"');
  eq(csvCell('has\nnewline'), '"has\nnewline"');
  eq(csvCell(null), '');
});
check('toCSV emits a header and one row per session', ()=>{
  const csv = toCSV([S('2026-01-09','50/100',14150), S('2026-01-16','50/100',-30000)]);
  const lines = csv.split('\r\n');
  eq(lines.length, 3, 'line count');
  eq(lines[0].startsWith('date,type,location,stakes'), true, 'header');
  eq(lines[1].includes('2026-01-09'), true, 'first row is oldest');
  eq(lines[1].endsWith('14150,14150'), true, 'profit and base profit');
});
check('toCSV escapes a venue containing a comma or apostrophe', ()=>{
  const s = S('2026-01-01','1/2',100,'INR',"Pranshu's Game, Delhi");
  const line = toCSV([s]).split('\r\n')[1];
  eq(line.includes('"Pranshu\'s Game, Delhi"'), true, 'quoted venue');
  // 18 columns, and the naive split finds 19 because it does not respect the
  // quotes — which is the point: the comma survived instead of being stripped,
  // so a real CSV parser will put it back together as one field.
  eq(line.split(',').length, 19, 'the embedded comma is still there, quoted');
});
check('toCSV carries the tournament fields and the derived cost', ()=>{
  const t = T('2026-01-01','Sunday Main',1000,100,3,5000,{place:7, fieldSize:400});
  const line = toCSV([{...t, tags:['deep','tired']}]).split('\r\n')[1];
  const cells = line.split(',');
  eq(cells[1], 'tournament', 'type');
  eq(cells[3], 'Sunday Main', 'event name sits in the stakes column');
  eq(cells[5], '100', 'fee');
  eq(cells[6], '3', 'entries');
  eq(cells[11], '7', 'place');
  eq(cells[12], '400', 'field size');
  eq(cells[13], 'deep tired', 'tags are space separated so they need no quoting');
  eq(line.endsWith('3300,1700,1700'), true, 'total cost, profit, base profit');
});
check('toCSV leaves the tournament columns blank on a cash row', ()=>{
  const cells = toCSV([S('2026-01-01','1/2',100)]).split('\r\n')[1].split(',');
  eq(cells[1], 'cash', 'type');
  eq(cells[5], '', 'fee');
  eq(cells[6], '', 'entries');
  eq(cells[11], '', 'place');
  eq(cells[13], '', 'tags');
});
check('toCSV records the rate each row was valued at', ()=>{
  const rows = toCSV([
    {...S('2026-03-28','5/10',7000,'HKD'), fxRate:12.30},
    S('2026-01-01','1/2',100),                    // no rate recorded
  ]).split('\r\n');
  eq(rows[0].split(',')[9], 'fx_rate', 'header');
  // Oldest first, so the INR row comes before the March HKD one.
  eq(rows[1].split(',')[9], '', 'blank means the row predates the column');
  eq(rows[2].split(',')[9], '12.3', 'the frozen rate');
  eq(rows[2].endsWith('7000,86100'), true, 'base column uses the frozen rate');
});
check('toCSV converts foreign currency in the base column', ()=>{
  const line = toCSV([S('2026-03-28','5/10',7000,'HKD','Venetian Macau')]).split('\r\n')[1];
  eq(line.endsWith('7000,78050'), true);
});
check('toCSV of an empty ledger is just the header', ()=> eq(toCSV([]).split('\r\n').length, 1));

// ---------- monthly ----------
check('monthlyTotals buckets by calendar month, oldest first', ()=>{
  const m = monthlyTotals(LEDGER);
  eq(m.length, 7, 'bucket count');
  eq(m.map(x=>x.key).join(','), '2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07');
  near(m[0].total, 142200, 'Jan');
  near(m[1].total, -270000, 'Feb');
  near(m[2].total, 118150, 'Mar');   // includes the converted HKD session
  near(m[6].total, 66900, 'Jul');
  return m.map(x=>x.label).join(' ');
});
check('monthlyTotals of nothing is empty', ()=> eq(monthlyTotals([]).length, 0));

// ---------- report ----------
(function report(){
  const passed = results.filter(r=>r.pass).length;
  const failed = results.length - passed;
  document.getElementById('summary').innerHTML =
    `<span class="${failed ? 'bad':'good'}">${passed}/${results.length} passed</span>` +
    (failed ? ` · <span class="bad">${failed} failed</span>` : '');
  document.getElementById('results').innerHTML = results.map(r=>`
    <li class="${r.pass?'good':'bad'}">
      <span class="mark">${r.pass?'PASS':'FAIL'}</span>
      <span class="name">${escapeHtml(r.name)}</span>
      ${r.detail ? `<span class="detail">${escapeHtml(r.detail)}</span>` : ''}
    </li>`).join('');
  console.log(`${passed}/${results.length} passed, ${failed} failed`);
})();
