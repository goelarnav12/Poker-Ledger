// ---------------------------------------------------------------------------
// app.js — DOM, data access, and rendering.
// Pure money/stats/formatting logic lives in stats.js and is tested by
// tests.html. Anything deterministic enough to unit test belongs there.
// ---------------------------------------------------------------------------

// ---------- Setup ----------
let client = null;
let currentUser = null;
let sessions = [];
let activeFilter = 'all';       // stakes chip
let activeLocation = 'all';     // venue chip
let activeRange = 'all';        // 'all' | 'thisMonth' | '90d' | 'thisYear' | 'YYYY-MM'
let editingId = null;           // non-null while the form is editing a session
let profitChart, stakesChart, monthlyChart;

const authView = document.getElementById('authView');
const appView = document.getElementById('app');
const authError = document.getElementById('authError');
const userEmailLabel = document.getElementById('userEmailLabel');
const configWarning = document.getElementById('configWarning');
const listStatus = document.getElementById('listStatus');
const loadingNote = document.getElementById('loadingNote');

function configIsPlaceholder(){
  return !SUPABASE_URL || !SUPABASE_ANON_KEY ||
    SUPABASE_URL.includes('PASTE_YOUR') || SUPABASE_ANON_KEY.includes('PASTE_YOUR');
}

async function boot(){
  if(configIsPlaceholder()){
    configWarning.style.display = 'block';
    return;
  }
  client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: { session } } = await client.auth.getSession();
  if(session){
    currentUser = session.user;
    await enterApp();
  } else {
    authView.style.display = 'flex';
  }

  client.auth.onAuthStateChange((event, session)=>{
    if(event === 'SIGNED_IN' && session){
      // SIGNED_IN also fires on token refresh and tab focus; ignore it when it
      // is the same user we already loaded, otherwise every refresh re-fetches.
      if(currentUser && currentUser.id === session.user.id) return;
      currentUser = session.user;
      enterApp();
    } else if(event === 'SIGNED_OUT'){
      currentUser = null;
      sessions = [];
      activeFilter = 'all';
      activeLocation = 'all';
      activeRange = 'all';
      closeForm();
      appView.style.display = 'none';
      authView.style.display = 'flex';
    }
  });
}

async function enterApp(){
  authView.style.display = 'none';
  appView.style.display = 'block';
  userEmailLabel.textContent = currentUser.email;
  showTab(location.hash.slice(1));   // restore the tab from the URL
  await loadSessions();
}

// ---------- Auth actions ----------
// boot() bails out before creating `client` when config.js is unedited, so the
// auth buttons have to survive being clicked with no client.
function requireClient(){
  if(client) return true;
  authError.style.color = 'var(--loss)';
  authError.textContent = 'Supabase is not configured yet — fill in config.js.';
  return false;
}

document.getElementById('signUpBtn').addEventListener('click', async ()=>{
  if(!requireClient()) return;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  authError.style.color = 'var(--ink-soft)';
  authError.textContent = '';
  if(!email || password.length < 6){
    authError.style.color = 'var(--loss)';
    authError.textContent = 'Enter an email and a password of at least 6 characters.';
    return;
  }
  const { data, error } = await client.auth.signUp({ email, password });
  if(error){
    authError.style.color = 'var(--loss)';
    authError.textContent = error.message;
    return;
  }
  if(!data.session){
    authError.textContent = 'Account created — check your email to confirm, then log in.';
  }
});

document.getElementById('signInBtn').addEventListener('click', async ()=>{
  if(!requireClient()) return;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  authError.style.color = 'var(--loss)';
  authError.textContent = '';
  const { error } = await client.auth.signInWithPassword({ email, password });
  if(error){ authError.textContent = error.message; }
});

document.getElementById('signOutBtn').addEventListener('click', async ()=>{
  await client.auth.signOut();
});

// ---------- Export ----------
// Deliberately exports every session, not the filtered view: this is a backup,
// and a backup that silently omits rows is worse than none.
document.getElementById('exportBtn').addEventListener('click', ()=>{
  if(!sessions.length){ showListStatus('Nothing to export yet.'); return; }
  const blob = new Blob(['﻿' + toCSV(sessions)], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `poker-ledger-${todayLocal()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---------- Status messages ----------
// Replaces the old alert() calls: non-blocking, and screen readers announce
// them via the role="alert" containers in index.html.
function showListStatus(msg){
  listStatus.textContent = msg || '';
  listStatus.style.display = msg ? 'block' : 'none';
}
function showFormError(msg){
  const el = document.getElementById('formError');
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}
function setLoading(on){
  loadingNote.style.display = on ? 'block' : 'none';
}

// ---------- Data layer ----------
// No local cache and no optimistic updates: every mutation is followed by a
// full reload. The data volume is a personal ledger, so this stays cheap.
async function loadSessions(){
  setLoading(true);
  try {
    // Supabase reports most failures as { error }, but a genuine network
    // failure (offline, DNS, CORS) throws instead. Without this catch that
    // rejection escapes and the user is left staring at an empty page.
    const { data, error } = await client
      .from('sessions')
      .select('*')
      .order('date', { ascending: true });

    if(error){
      console.error(error);
      sessions = [];
      showListStatus('Could not load sessions: ' + error.message);
    } else {
      showListStatus('');
      sessions = data.map(r => ({
        id: r.id,
        date: r.date,
        location: r.location,
        stakes: r.stakes,
        buyIn: Number(r.buy_in),
        cashOut: Number(r.cash_out),
        currency: r.currency || baseCurrency(),
        // Null stays null — it means "not recorded", which is not the same as
        // zero and must not become 0 here.
        hours: r.hours == null ? null : Number(r.hours),
        notes: r.notes || ''
      }));
    }
  } catch(e){
    console.error(e);
    sessions = [];
    showListStatus('Could not reach the database. Check your connection, then reload.');
  } finally {
    setLoading(false);
  }
  render();
}

// camelCase in JS, snake_case in Postgres. This function and loadSessions()
// are the only places that translation happens — keep it that way.
function toRow(s){
  return {
    date: s.date,
    location: s.location,
    stakes: s.stakes,
    buy_in: s.buyIn,
    cash_out: s.cashOut,
    currency: s.currency,
    hours: s.hours,          // null when left blank
    notes: s.notes
  };
}

async function addSession(s){
  const { error } = await client.from('sessions')
    .insert({ user_id: currentUser.id, ...toRow(s) });
  if(error){
    showFormError('Could not save session: ' + error.message);
    return false;
  }
  return true;
}

// user_id is deliberately not sent: leaving it untouched is what keeps the row
// yours, and the update policy's `with check` would reject changing it anyway.
async function updateSession(id, s){
  const { error } = await client.from('sessions').update(toRow(s)).eq('id', id);
  if(error){
    showFormError('Could not update session: ' + error.message);
    return false;
  }
  return true;
}

async function deleteSession(id){
  const { error } = await client.from('sessions').delete().eq('id', id);
  if(error){
    showListStatus('Could not delete session: ' + error.message);
    return false;
  }
  return true;
}

// ---------- Tabs ----------
// Two views: the figures and charts on Overview, the log on Sessions. The
// active tab lives in the URL hash so a refresh keeps you where you were.
const TABS = ['overview', 'sessions'];

function showTab(name){
  if(!TABS.includes(name)) name = 'overview';
  TABS.forEach(t=>{
    document.getElementById('panel-' + t).hidden = (t !== name);
    const btn = document.getElementById('tab-' + t);
    btn.setAttribute('aria-selected', String(t === name));
    btn.tabIndex = (t === name) ? 0 : -1;      // roving tabindex
  });
  if(location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);

  // Chart.js measures its container at construction time. Anything built while
  // the Overview panel was hidden comes out zero-width, so rebuild on reveal —
  // cheap at this data volume, and always correct.
  if(name === 'overview'){ renderChart(); renderMonthlyChart(); renderStakesChart(); }
}

document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=> showTab(btn.dataset.tab));
});
window.addEventListener('hashchange', ()=> showTab(location.hash.slice(1)));

// The ARIA tabs pattern: arrows move between tabs, Home/End jump to the ends,
// and only the selected tab is in the page tab order (roving tabindex) so Tab
// steps past the tablist rather than through every tab in it.
document.querySelector('.tabs').addEventListener('keydown', (e)=>{
  const keys = {ArrowRight:1, ArrowLeft:-1, Home:'first', End:'last'};
  if(!(e.key in keys)) return;
  e.preventDefault();
  const i = TABS.indexOf(document.activeElement.dataset.tab);
  const move = keys[e.key];
  const next = move === 'first' ? 0
             : move === 'last'  ? TABS.length - 1
             : (i + move + TABS.length) % TABS.length;
  showTab(TABS[next]);
  document.getElementById('tab-' + TABS[next]).focus();
});

// ---------- Shortcuts ----------
document.addEventListener('keydown', (e)=>{
  // Never hijack a key while the user is typing, and never override a browser
  // or OS shortcut.
  const t = e.target;
  if(e.metaKey || e.ctrlKey || e.altKey) return;
  if(t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if(appView.style.display === 'none') return;

  if(e.key === 'n'){ e.preventDefault(); showTab('sessions'); openForm(null); }
  else if(e.key === '1'){ e.preventDefault(); showTab('overview'); }
  else if(e.key === '2'){ e.preventDefault(); showTab('sessions'); }
});

// ---------- Render ----------
function render(){
  // Everything on the page — figures, all three charts, and the list — reflects
  // the same filtered set. Filtering to 100/200 and seeing all-time stats was
  // the single most confusing thing about the previous layout.
  renderFilters();
  const shown = visibleSessions();
  const st = computeStats(shown);

  renderStrap();
  renderStats(st);
  document.getElementById('sessionCount').textContent =
    shown.length + (shown.length === 1 ? ' session' : ' sessions');

  renderChart();
  renderMonthlyChart();
  renderStakesChart();
  renderList();
  renderDatalists();
}

// The strap under the masthead carries the period the ledger covers.
function renderStrap(){
  const el = document.getElementById('strap');
  if(!sessions.length){ el.textContent = 'cash game record'; return; }
  const c = chronological(sessions);
  const month = d => new Date(d+'T00:00:00')
    .toLocaleDateString(undefined,{month:'short', year:'numeric'});
  const from = month(c[0].date), to = month(c[c.length-1].date);
  el.textContent = 'cash game record · ' + (from === to ? from : `${from} – ${to}`);
}

// Label on the left, figure on the right, dot leaders between — a printed
// table, not a grid of cards. Median and standard deviation are deliberately
// not shown; stats.js still computes them if they're ever wanted back.
function summaryRow(label, value, cls, extra, title){
  return `<div class="row${extra || ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>
    <span class="label">${escapeHtml(label)}</span>
    <span class="leader"></span>
    <span class="value ${cls || ''}">${value}</span>
  </div>`;
}

function renderStats(st){
  const any = st.count > 0;
  const dash = '—';
  document.getElementById('statsRow').innerHTML = [
    // The headline stays unsigned — its size and colour already say which way
    // it went, and a "+" on the hero figure reads as clutter.
    summaryRow('Net profit', any ? fmt(Math.round(st.totalProfit)) : dash,
               resultClass(st.totalProfit), ' headline'),
    summaryRow('Sessions', String(st.count)),
    summaryRow('Win rate', any ? st.winRate.toFixed(0) + '%' : dash),
    // Hours are optional, so these two rows only appear once you actually
    // record some. Until then they would be permanent em-dashes.
    st.timedCount ? summaryRow('Hourly rate', fmtSigned(Math.round(st.hourly)) + '/hr',
                               resultClass(st.hourly), '',
                               `Based on the ${st.timedCount} of ${st.count} sessions with hours recorded.`) : '',
    st.timedCount ? summaryRow('Hours played', st.totalHours.toFixed(1)) : '',
    summaryRow('Average / session', any ? fmtSigned(Math.round(st.avg)) : dash,
               resultClass(st.avg)),
    summaryRow('Best session', any ? fmtSigned(st.best) : dash, resultClass(st.best)),
    summaryRow('Worst session', any ? fmtSigned(st.worst) : dash, resultClass(st.worst)),
    summaryRow('Max drawdown', any ? fmt(Math.round(st.drawdown.max)) : dash,
               st.drawdown.max > 0 ? 'neg' : '', '',
               any ? `Largest peak-to-trough fall. Currently ${fmt(Math.round(st.drawdown.current))} below the all-time peak.` : ''),
    summaryRow('Longest win streak', any ? String(st.streaks.longestWin) : dash, '', '',
               any ? `Current run: ${st.streaks.currentWin}.` : ''),
    summaryRow('Longest loss streak', any ? String(st.streaks.longestLoss) : dash, '', '',
               any ? `Current run: ${st.streaks.currentLoss}.` : '')
  ].join('');
}

// Suggestions for the location/stakes inputs, drawn from what's already in the
// ledger, most-used first.
function renderDatalists(){
  fillDatalist('locationOptions', byFrequency(sessions.map(s=>s.location)));
  // Raw s.stakes, NOT stakesLabel() — "5/10 (HKD)" is a display string and
  // must never end up back in the input as a stakes value.
  fillDatalist('stakesOptions', byFrequency(sessions.map(s=>s.stakes)));
}

function fillDatalist(id, values){
  document.getElementById(id).innerHTML =
    values.map(v=>`<option value="${escapeHtml(v)}"></option>`).join('');
}

// Clicking a bar filters to it, and clicking the active bar again clears —
// otherwise the only way back is to hunt for the chip.
function barClickHandler(getValue, apply, current){
  return (evt, elements, chart)=>{
    const hit = chart.getElementsAtEventForMode(evt, 'nearest', {intersect:true}, true);
    if(!hit.length) return;
    const value = getValue(hit[0].index, chart);
    apply(value === current() ? 'all' : value);
    render();
  };
}

// Shared Chart.js styling so the three charts stay visually consistent.
// Cream on warm charcoal. Keep in step with the custom properties in style.css.
const INK = '#EDE7D9', WIN = 'rgba(95,169,126,0.85)', LOSS = 'rgba(212,105,90,0.85)';
const AXIS_TICKS = {color:'#8A8375', font:{family:'IBM Plex Mono', size:10}};
const GRID = {color:'#2E2B22', drawTicks:false};
const MONEY_TOOLTIP = {callbacks:{label: c=>fmt(Math.round(c.parsed.y))}};

// All three chart renderers follow the same shape: hide the panel when there is
// nothing to plot, and always tear the old Chart.js instance down first — an
// undestroyed instance keeps its canvas binding and leaks.
function renderChart(){
  const shown = visibleSessions();
  const has = shown.length > 0;
  document.getElementById('profitPanel').style.display = has ? 'block' : 'none';
  if(profitChart){ profitChart.destroy(); profitChart = null; }
  if(!has) return;

  const ctx = document.getElementById('profitChart');
  let running = 0;
  const points = chronological(shown).map(s=>{
    running += profitBase(s);
    return {x: s.date, y: running};
  });

  profitChart = new Chart(ctx, {
    type:'line',
    data:{ datasets:[{
      data: points,
      borderColor: INK,
      backgroundColor:'rgba(237,231,217,0.06)',
      fill:true,
      tension:0.2,
      // No permanent dots: 36 of them turn a line into a dotted mess. They
      // appear on hover, where they actually help you read a value.
      pointRadius:0,
      pointHoverRadius:4,
      pointHoverBackgroundColor: INK,
      borderWidth:1.5
    }]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:MONEY_TOOLTIP },
      scales:{
        // No vertical rules, and let Chart.js thin the date labels rather than
        // printing one per day — on paper a tick per session is a picket fence.
        x:{type:'time', time:{unit:'month'}, grid:{display:false},
           ticks:{...AXIS_TICKS, autoSkip:true, maxRotation:0}},
        y:{grid:GRID, ticks:{...AXIS_TICKS, callback:fmtAxis}}
      }
    }
  });
}

function renderMonthlyChart(){
  const buckets = monthlyTotals(visibleSessions());
  const has = buckets.length > 0;
  document.getElementById('monthlyPanel').style.display = has ? 'block' : 'none';
  if(monthlyChart){ monthlyChart.destroy(); monthlyChart = null; }
  if(!has) return;

  const data = buckets.map(b=>b.total);
  const keys = buckets.map(b=>b.key);
  const ctx = document.getElementById('monthlyChart');
  monthlyChart = new Chart(ctx, {
    type:'bar',
    data:{ labels: buckets.map(b=>b.label), datasets:[{
      data,
      backgroundColor: data.map(v=> v>=0 ? WIN : LOSS),
      borderRadius:2
    }]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      onHover:(e,els)=>{ e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      onClick: barClickHandler(i=>keys[i], v=>{ activeRange = v; }, ()=>activeRange),
      plugins:{ legend:{display:false}, tooltip:MONEY_TOOLTIP },
      scales:{
        x:{grid:{display:false}, ticks:{...AXIS_TICKS, size:11}},
        y:{grid:GRID, ticks:{...AXIS_TICKS, callback:fmtAxis}}
      }
    }
  });
}

function renderStakesChart(){
  const shown = visibleSessions();
  const has = shown.length > 0;
  document.getElementById('stakesPanel').style.display = has ? 'block' : 'none';
  if(stakesChart){ stakesChart.destroy(); stakesChart = null; }
  if(!has) return;

  const byStakes = {};
  shown.forEach(s=>{
    const k = stakesLabel(s);
    byStakes[k] = (byStakes[k]||0) + profitBase(s);
  });
  const labels = Object.keys(byStakes);
  const data = Object.values(byStakes);

  const ctx = document.getElementById('stakesChart');
  stakesChart = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{
      data,
      backgroundColor: data.map(v=> v>=0 ? WIN : LOSS),
      borderRadius:2
    }]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      onHover:(e,els)=>{ e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      onClick: barClickHandler(i=>labels[i], v=>{ activeFilter = v; }, ()=>activeFilter),
      plugins:{ legend:{display:false}, tooltip:MONEY_TOOLTIP },
      scales:{
        x:{grid:{display:false}, ticks:{...AXIS_TICKS, size:11}},
        y:{grid:GRID, ticks:{...AXIS_TICKS, callback:fmtAxis}}
      }
    }
  });
}

// ---------- Filters ----------
function renderChipRow(rowId, values, active, allLabel, onPick, label){
  const row = document.getElementById(rowId);
  // One value means the chips can only say "all" or the same thing twice.
  if(values.length <= 1){ row.innerHTML = ''; return; }
  const text = v => v === 'all' ? allLabel : (label ? label(v) : v);
  row.innerHTML = ['all', ...values].map(v=>
    `<button class="filter-chip ${v===active?'active':''}" aria-pressed="${v===active}" data-value="${escapeHtml(v)}">${escapeHtml(text(v))}</button>`
  ).join('');
  row.querySelectorAll('.filter-chip').forEach(btn=>{
    btn.addEventListener('click', ()=> onPick(btn.dataset.value));
  });
}

// Chip options are derived from ALL sessions, never the filtered set —
// otherwise choosing one value would delete every other chip and strand you.
function renderFilters(){
  const stakes = [...new Set(sessions.map(stakesLabel))];
  const locations = [...new Set(sessions.map(s=>s.location))];

  // A filtered-away value may have just been deleted; without this the list
  // filters down to nothing and the chip to clear it no longer exists.
  if(activeFilter !== 'all' && !stakes.includes(activeFilter)) activeFilter = 'all';
  if(activeLocation !== 'all' && !locations.includes(activeLocation)) activeLocation = 'all';

  // A month picked by clicking the by-month chart appears as an extra chip so
  // there is always a visible way to see it and clear it.
  const ranges = ['thisMonth', '90d', 'thisYear'];
  if(/^\d{4}-\d{2}$/.test(activeRange)) ranges.push(activeRange);

  renderChipRow('rangeRow', ranges, activeRange, 'All time',
    v=>{ activeRange = v; render(); }, rangeLabel);
  renderChipRow('filterRow', stakes, activeFilter, 'All stakes',
    v=>{ activeFilter = v; render(); });
  renderChipRow('locationFilterRow', locations, activeLocation, 'All venues',
    v=>{ activeLocation = v; render(); });

  const filtered = visibleSessions().length;
  const note = document.getElementById('filterNote');
  const on = activeFilter !== 'all' || activeLocation !== 'all' || activeRange !== 'all';
  note.textContent = on
    ? `Showing ${filtered} of ${sessions.length} sessions — every figure and chart below reflects this.`
    : '';
  note.style.display = on ? 'block' : 'none';
}

function visibleSessions(){
  return sessions
    .filter(s=> activeFilter === 'all' || stakesLabel(s) === activeFilter)
    .filter(s=> activeLocation === 'all' || s.location === activeLocation)
    .filter(s=> matchesRange(s.date, activeRange))
    .sort((a,b)=> a.date < b.date ? 1 : a.date > b.date ? -1 : 0);   // newest first
}

// ---------- Session list ----------
function renderList(){
  const list = document.getElementById('sessionList');
  const empty = document.getElementById('emptyNote');
  const filtered = visibleSessions();

  // The tab already says "Sessions", so this heading carries the count — and
  // says so explicitly when a filter is hiding some of them.
  document.getElementById('sessionsHeading').textContent =
    filtered.length === sessions.length
      ? `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`
      : `${filtered.length} of ${sessions.length}`;

  if(filtered.length === 0){
    list.innerHTML = '';
    empty.textContent = sessions.length
      ? 'No sessions match these filters.'
      : 'No sessions yet — add your first one above.';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // Only qualify what varies. Printing the same venue on all 36 rows makes the
  // least informative column the most visually dominant one; the year is the
  // same idea. Both appear only once the ledger actually spans more than one.
  const multiVenue = new Set(sessions.map(s=>s.location)).size > 1;
  const multiYear  = new Set(sessions.map(s=>s.date.slice(0,4))).size > 1;

  list.innerHTML = filtered.map(s=>{
    const profit = profitOf(s);
    const d = new Date(s.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString(undefined,
      multiYear ? {day:'numeric',month:'short',year:'2-digit'} : {day:'numeric',month:'short'});
    const fullDate = d.toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'});

    const dim = t => `<span class="dim"> · ${t}</span>`;
    // Foreign sessions show the amount actually won alongside what it counts
    // for in the totals, so the arithmetic on this page is never a mystery.
    const detail = escapeHtml(stakesLabel(s))
      + (typeof s.hours === 'number' ? dim(s.hours + 'h') : '')
      + (multiVenue ? dim(escapeHtml(s.location)) : '')
      + (s.currency === baseCurrency() ? '' : dim('≈ ' + fmt(Math.round(profitBase(s)))))
      + (s.notes ? dim(escapeHtml(s.notes)) : '');

    const what = `${s.location} on ${fullDate}`;
    return `
      <div class="session" data-id="${escapeHtml(s.id)}">
        <span class="date">${escapeHtml(dateStr)}</span>
        <span class="detail" title="${escapeHtml(s.location)}">${detail}</span>
        <span class="amount ${resultClass(profit)}">${fmtSigned(profit, s.currency)}</span>
        <button class="edit" data-act="edit" aria-label="Edit session at ${escapeHtml(what)}">edit</button>
        <button class="del" data-act="del" aria-label="Delete session at ${escapeHtml(what)}">del</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-act="edit"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.closest('.session').dataset.id;
      const s = sessions.find(x=>x.id === id);
      if(s) openForm(s);
    });
  });

  list.querySelectorAll('[data-act="del"]').forEach(btn=>{
    // Two-step delete instead of a blocking confirm(): the first click arms the
    // button, the second commits. There is no undo, so one stray click on a
    // 14px ✕ should not be able to destroy a session.
    let armTimer = null;
    btn.addEventListener('click', async ()=>{
      if(btn.dataset.armed !== '1'){
        btn.dataset.armed = '1';
        btn.textContent = 'sure?';
        btn.classList.add('armed');
        armTimer = setTimeout(()=>{
          btn.dataset.armed = '0';
          btn.textContent = 'del';
          btn.classList.remove('armed');
        }, 4000);
        return;
      }
      clearTimeout(armTimer);
      btn.disabled = true;
      const id = btn.closest('.session').dataset.id;
      if(editingId === id) closeForm();    // don't leave the form editing a ghost
      await deleteSession(id);
      await loadSessions();
    });
  });
}

// ---------- Session form ----------
const form = document.getElementById('sessionForm');
const toggleBtn = document.getElementById('toggleForm');
const cancelBtn = document.getElementById('cancelForm');

// The currency dropdown is driven by config.js so the two can't drift apart.
const currencySelect = document.getElementById('f-currency');
currencySelect.innerHTML = Object.keys(FX_RATES)
  .map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)} · ${escapeHtml(symbolFor(c).trim())}</option>`)
  .join('');
currencySelect.value = baseCurrency();

// Buy-in/cash-out are entered in the selected currency, so say which.
function updateAmountLabels(){
  const sym = symbolFor(currencySelect.value).trim();
  document.getElementById('lbl-buyin').textContent = `Buy-in (${sym})`;
  document.getElementById('lbl-cashout').textContent = `Cash-out (${sym})`;
}
currencySelect.addEventListener('change', updateAmountLabels);
updateAmountLabels();

function todayLocal(){
  // valueAsDate reads back as UTC, which lands on the wrong day west of GMT.
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function clearFormFields(){
  ['f-location','f-stakes','f-buyin','f-cashout','f-hours','f-notes'].forEach(id=>{
    document.getElementById(id).value = '';
  });
  currencySelect.value = baseCurrency();
  updateAmountLabels();   // setting .value in code fires no 'change' event
}

// One form for both jobs; `session` null means "add", otherwise "edit".
function openForm(session){
  editingId = session ? session.id : null;
  document.getElementById('formTitle').textContent = session ? 'Edit Session' : 'New Session';
  document.getElementById('saveSessionBtn').textContent = session ? 'Update Session' : 'Save Session';

  if(session){
    document.getElementById('f-date').value = session.date;
    document.getElementById('f-location').value = session.location;
    document.getElementById('f-stakes').value = session.stakes;
    document.getElementById('f-buyin').value = session.buyIn;
    document.getElementById('f-cashout').value = session.cashOut;
    currencySelect.value = session.currency;
    document.getElementById('f-hours').value = session.hours ?? '';
    document.getElementById('f-notes').value = session.notes;
    updateAmountLabels();
  } else {
    clearFormFields();
    document.getElementById('f-date').value = todayLocal();
  }

  showFormError('');
  form.classList.add('open');
  toggleBtn.style.display = 'none';
  form.scrollIntoView({block:'nearest', behavior:'smooth'});
  document.getElementById('f-location').focus();
}

function closeForm(){
  form.classList.remove('open');
  editingId = null;
  clearFormFields();
  showFormError('');
  // Reset the labels too, so the form can never reappear still saying "Edit".
  document.getElementById('formTitle').textContent = 'New Session';
  document.getElementById('saveSessionBtn').textContent = 'Save Session';
  toggleBtn.style.display = 'inline-block';
}

toggleBtn.addEventListener('click', ()=> openForm(null));
cancelBtn.addEventListener('click', ()=> closeForm());

// Esc cancels, matching what the Cancel button does.
form.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){ e.preventDefault(); closeForm(); }
});

// submit rather than a click handler, so Enter in any field works.
form.addEventListener('submit', async (e)=>{
  e.preventDefault();

  const date = document.getElementById('f-date').value;
  const location = document.getElementById('f-location').value.trim();
  const stakes = document.getElementById('f-stakes').value.trim();
  const buyIn = parseFloat(document.getElementById('f-buyin').value);
  const cashOut = parseFloat(document.getElementById('f-cashout').value);
  const currency = currencySelect.value;
  // Blank stays null: "not recorded" is not the same as zero hours.
  const rawHours = document.getElementById('f-hours').value.trim();
  const hours = rawHours === '' ? null : parseFloat(rawHours);
  const notes = document.getElementById('f-notes').value.trim();

  if(!date || !location || !stakes || isNaN(buyIn) || isNaN(cashOut)){
    showFormError('Fill in date, location, stakes, buy-in, and cash-out.');
    return;
  }
  if(hours !== null && (isNaN(hours) || hours <= 0)){
    showFormError('Hours must be a positive number, or left blank if you did not record it.');
    return;
  }
  if(buyIn < 0 || cashOut < 0){
    showFormError('Buy-in and cash-out are amounts, not results — neither can be negative. A losing session is a cash-out lower than the buy-in.');
    return;
  }

  const saveBtn = document.getElementById('saveSessionBtn');
  saveBtn.disabled = true;
  try {
    const payload = {date, location, stakes, buyIn, cashOut, currency, hours, notes};
    const ok = editingId
      ? await updateSession(editingId, payload)
      : await addSession(payload);
    if(ok){
      closeForm();
      await loadSessions();
    }
  } finally {
    saveBtn.disabled = false;
  }
});

boot();
