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

const S = (date, stakes, pnl, currency='INR', location="Pranshu's Game") =>
  ({id:date, date, stakes, location, buyIn:0, cashOut:pnl, currency, notes:''});

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
  eq(lines[0].startsWith('date,location,stakes'), true, 'header');
  eq(lines[1].includes('2026-01-09'), true, 'first row is oldest');
  eq(lines[1].endsWith('14150,14150'), true, 'profit and base profit');
});
check('toCSV escapes a venue containing a comma or apostrophe', ()=>{
  const s = S('2026-01-01','1/2',100,'INR',"Pranshu's Game, Delhi");
  const line = toCSV([s]).split('\r\n')[1];
  eq(line.includes('"Pranshu\'s Game, Delhi"'), true, 'quoted venue');
  eq(line.split(',').length, 11, 'comma inside quotes must not add a column');
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
