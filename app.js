// ---------------------------------------------------------------------------
// app.js — DOM, data access, and rendering.
// Pure money/stats/formatting logic lives in stats.js and is tested by
// tests.html. Anything deterministic enough to unit test belongs there.
// ---------------------------------------------------------------------------

// ---------- Setup ----------
let sessions = [];
let activeFilter = 'all';       // stakes chip
let activeLocation = 'all';     // venue chip
let activeRange = 'all';        // 'all' | 'thisMonth' | '90d' | 'thisYear' | 'YYYY-MM'
let activeType = 'all';         // 'all' | 'cash' | 'tournament'
let activeTag = 'all';          // a tag string, or 'all'
let editingId = null;           // non-null while the form is editing a session
let profitChart, stakesChart, monthlyChart;
// 'login' once a password exists on the server, 'signup' before that. Decided
// by showAuth(); it only changes what the one button on the lock screen does.
let authMode = 'login';

const authView = document.getElementById('authView');
const appView = document.getElementById('app');
const authError = document.getElementById('authError');
const authTitle = document.getElementById('authTitle');
const authPassword = document.getElementById('auth-password');
const authConfirm = document.getElementById('auth-confirm');
const authConfirmField = document.getElementById('authConfirmField');
const signInBtn = document.getElementById('signInBtn');
const configWarning = document.getElementById('configWarning');
const listStatus = document.getElementById('listStatus');
const loadingNote = document.getElementById('loadingNote');

function configIsPlaceholder(){
  return typeof API_URL !== 'string' || !API_URL || API_URL.includes('PASTE_YOUR');
}

// The token is kept in localStorage (backend.js), so a returning visit goes
// straight in. Whether it is still valid is only discovered by the first pull:
// a 401 there locks the app again (see loadSessions).
async function boot(){
  if(configIsPlaceholder()){
    configWarning.style.display = 'block';
    return;
  }
  if(isSignedIn()) await enterApp();
  else await showAuth();
}

// Show the lock screen. Asks the server whether a password exists yet, which
// decides between "Unlock" and "Set password".
async function showAuth(message){
  appView.style.display = 'none';
  authView.style.display = 'flex';
  authPassword.value = '';
  authConfirm.value = '';
  authError.style.color = 'var(--loss)';
  authError.textContent = message || '';
  try {
    setAuthMode((await getSalt()) ? 'login' : 'signup');
  } catch(e){
    // Offline or the Worker is unreachable. Default to unlock; pressing the
    // button surfaces the real error.
    setAuthMode('login');
  }
}

function setAuthMode(mode){
  authMode = mode;
  const signup = mode === 'signup';
  authTitle.textContent = signup ? 'Set a password' : 'Unlock';
  signInBtn.textContent = signup ? 'Set password' : 'Unlock';
  authConfirmField.style.display = signup ? '' : 'none';
  authPassword.autocomplete = signup ? 'new-password' : 'current-password';
}

async function enterApp(){
  authView.style.display = 'none';
  appView.style.display = 'block';
  showTab(location.hash.slice(1));   // restore the tab from the URL
  // Warm the rate cache in the background. Deliberately not awaited: rates
  // only prefill the form, so the ledger must never wait on the network to
  // render — and offline it falls back to the cache, then to config.js.
  void loadRates();
  await loadSessions();
}

// Forget the token and everything loaded with it, then show the lock screen.
async function lockApp(message){
  signOut();
  sessions = [];
  activeFilter = 'all';
  activeLocation = 'all';
  activeRange = 'all';
  activeType = 'all';
  activeTag = 'all';
  closeForm();
  await showAuth(message);
}

// ---------- Auth actions ----------
async function submitAuth(){
  const password = authPassword.value;
  authError.style.color = 'var(--loss)';
  authError.textContent = '';
  if(configIsPlaceholder()){
    authError.textContent = 'The server is not configured yet — fill in config.js.';
    return;
  }
  if(authMode === 'signup'){
    if(password.length < 8){
      authError.textContent = 'Choose a password of at least 8 characters.';
      return;
    }
    if(password !== authConfirm.value){
      authError.textContent = 'The two passwords do not match.';
      return;
    }
  } else if(!password){
    authError.textContent = 'Enter your password.';
    return;
  }

  signInBtn.disabled = true;
  // Stretching the password is deliberately slow (about a second), so say so.
  authError.style.color = 'var(--ink-soft)';
  authError.textContent = authMode === 'signup' ? 'Setting up…' : 'Unlocking…';
  try {
    if(authMode === 'signup') await signup(password);
    else await login(password);
    authPassword.value = '';
    authConfirm.value = '';
    authError.textContent = '';
    await enterApp();
  } catch(e){
    console.error(e);
    authError.style.color = 'var(--loss)';
    if(e instanceof BackendError && e.status === 401){
      authError.textContent = 'Wrong password.';
    } else if(e instanceof BackendError && e.status === 409){
      // Someone (you, on another device) set the password a moment ago.
      setAuthMode('login');
      authError.textContent = 'This ledger already has a password. Unlock it instead.';
    } else if(e instanceof BackendError){
      authError.textContent = e.message;
    } else {
      authError.textContent = 'Could not reach the server. Check your connection and try again.';
    }
  } finally {
    signInBtn.disabled = false;
  }
}

signInBtn.addEventListener('click', submitAuth);
for(const el of [authPassword, authConfirm]){
  el.addEventListener('keydown', e => { if(e.key === 'Enter') submitAuth(); });
}

document.getElementById('signOutBtn').addEventListener('click', ()=>{
  void lockApp();
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
//
// The server (backend.js → the Worker) stores each session whole, as JSON, in
// the same camelCase shape the app uses — so there is no field translation
// here any more. A stored row is the app's session plus four bookkeeping keys:
// `id`, `createdAt`, `updatedAt` and `deletedAt`.
const SESSIONS_TABLE = 'sessions';

// Null stays null — it means "not recorded", which is not the same as zero and
// must not become 0. Same rule for hours and every tournament field: an
// unrecorded finish is not a finish of zero.
function numOrNull(v){
  return v == null ? null : Number(v);
}

// One stored payload → one in-memory session. Defensive on purpose: this is
// the single gate everything read from the server passes through.
function fromStored(r){
  return {
    id: r.id,
    date: r.date,
    location: r.location,
    stakes: r.stakes,
    buyIn: Number(r.buyIn),
    cashOut: Number(r.cashOut),
    currency: r.currency || baseCurrency(),
    hours: numOrNull(r.hours),
    notes: r.notes || '',
    // Frozen at save time. Null on a row from before rates were pinned, which
    // stats.js reads as "value it at the current rate".
    fxRate: numOrNull(r.fxRate),
    // 'cash' is the right reading of a row from before tournaments existed.
    sessionType: r.sessionType || 'cash',
    fee: numOrNull(r.fee),
    entries: numOrNull(r.entries),
    place: numOrNull(r.place),
    fieldSize: numOrNull(r.fieldSize),
    tags: Array.isArray(r.tags) ? r.tags : [],
    // Carried so an edit or a delete can write the row back with its original
    // creation time. Nothing on screen reads it.
    createdAt: r.createdAt || null
  };
}

async function loadSessions(){
  setLoading(true);
  let locked = false;
  try {
    const records = await pullRecords(SESSIONS_TABLE);
    showListStatus('');
    sessions = records
      // A tombstone is a deleted session; it stays on the server but never
      // reaches the screen.
      .filter(rec => !rec.deletedAt)
      .map(rec => fromStored({ ...JSON.parse(rec.payload), id: rec.id }))
      // Oldest first. Same-day sessions keep the order they were entered in.
      .sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 :
        String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  } catch(e){
    console.error(e);
    sessions = [];
    if(e instanceof BackendError && e.status === 401){
      // The saved token no longer opens the ledger (the password was changed
      // or reset). Go back to the lock screen rather than show an empty app.
      locked = true;
    } else if(e instanceof BackendError){
      showListStatus('Could not load sessions: ' + e.message);
    } else {
      showListStatus('Could not reach the server. Check your connection, then reload.');
    }
  } finally {
    setLoading(false);
  }
  if(locked){
    await lockApp('Your saved sign-in is no longer valid. Enter the password again.');
    return;
  }
  render();
}

// The app's session → the row that is stored. `meta` supplies the bookkeeping
// keys. This and fromStored() are the only places a stored row is shaped.
function toStored(s, meta){
  const tournament = s.sessionType === 'tournament';
  return {
    id: meta.id,
    date: s.date,
    location: s.location,
    stakes: s.stakes,
    buyIn: s.buyIn,
    cashOut: s.cashOut,
    currency: s.currency,
    // Always written, so the session's value is pinned the moment it is saved.
    fxRate: s.fxRate,
    hours: s.hours,          // null when left blank
    notes: s.notes,
    sessionType: s.sessionType,
    // Explicitly nulled on a cash row: editing a tournament back into a cash
    // game has to CLEAR these.
    fee:       tournament ? s.fee : null,
    entries:   tournament ? s.entries : null,
    place:     tournament ? s.place : null,
    fieldSize: tournament ? s.fieldSize : null,
    tags: s.tags,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    deletedAt: meta.deletedAt
  };
}

function saveErrorMessage(e){
  return e instanceof BackendError ? e.message : 'could not reach the server';
}

async function addSession(s){
  // The browser makes the id and the timestamps; the server only stores them.
  const now = new Date().toISOString();
  try {
    await pushRecord(SESSIONS_TABLE, toStored(s, {
      id: crypto.randomUUID(), createdAt: now, updatedAt: now, deletedAt: null
    }));
    return true;
  } catch(e){
    console.error(e);
    showFormError('Could not save session: ' + saveErrorMessage(e));
    return false;
  }
}

// The whole row is rewritten with a fresh `updatedAt`; the server keeps the
// copy with the later one.
async function updateSession(id, s){
  const existing = sessions.find(x => x.id === id);
  const now = new Date().toISOString();
  try {
    await pushRecord(SESSIONS_TABLE, toStored(s, {
      id, createdAt: (existing && existing.createdAt) || now, updatedAt: now, deletedAt: null
    }));
    return true;
  } catch(e){
    console.error(e);
    showFormError('Could not update session: ' + saveErrorMessage(e));
    return false;
  }
}

// A soft delete: the row is kept on the server with `deletedAt` set (a
// tombstone) and loadSessions() filters it out. In the app it is still gone
// for good — there is no undo button.
async function deleteSession(id){
  const existing = sessions.find(x => x.id === id);
  if(!existing){
    showListStatus('Could not delete session: it is no longer in the list. Reload and try again.');
    return false;
  }
  const now = new Date().toISOString();
  try {
    await pushRecord(SESSIONS_TABLE, toStored(existing, {
      id, createdAt: existing.createdAt || now, updatedAt: now, deletedAt: now
    }));
    return true;
  } catch(e){
    console.error(e);
    showListStatus('Could not delete session: ' + saveErrorMessage(e));
    return false;
  }
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
  // Names what the ledger actually holds. Calling it a cash game record once
  // there are tournaments in it is a small lie that the figures then have to
  // argue with.
  const kind = sessions.some(isTournament) ? 'poker record' : 'cash game record';
  if(!sessions.length){ el.textContent = kind; return; }
  const c = chronological(sessions);
  const month = d => new Date(d+'T00:00:00')
    .toLocaleDateString(undefined,{month:'short', year:'numeric'});
  const from = month(c[0].date), to = month(c[c.length-1].date);
  el.textContent = kind + ' · ' + (from === to ? from : `${from} – ${to}`);
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

// A ruled caption that separates the shared figures from the format-specific
// ones. Only drawn when the section below it actually has rows.
function sectionRow(label){
  return `<div class="row section"><span class="label">${escapeHtml(label)}</span></div>`;
}

function renderStats(st){
  const any = st.count > 0;
  const dash = '—';
  const bb = st.bb, t = st.tourney;

  // Both formats share one bankroll, so everything above the first divider
  // counts every session. Below it, the analysis splits: bb/100 and an hourly
  // rate mean nothing for a tournament, ROI and ITM mean nothing for a cash
  // game, and showing either against the wrong set is worse than not showing it.
  const shared = [
    // The headline stays unsigned — its size and colour already say which way
    // it went, and a "+" on the hero figure reads as clutter.
    summaryRow('Net profit', any ? fmt(Math.round(st.totalProfit)) : dash,
               resultClass(st.totalProfit), ' headline',
               any && t.count ? `${st.cashCount} cash and ${t.count} tournament sessions, totalled together.` : ''),
    summaryRow('Sessions', String(st.count), '', '',
               t.count ? `${st.cashCount} cash, ${t.count} tournament.` : ''),
    summaryRow('Win rate', any ? st.winRate.toFixed(0) + '%' : dash, '', '',
               any ? 'Share of sessions that finished ahead.' : ''),
    summaryRow('Average / session', any ? fmtSigned(Math.round(st.avg)) : dash,
               resultClass(st.avg)),
    summaryRow('Best session', any ? fmtSigned(st.best) : dash, resultClass(st.best)),
    summaryRow('Worst session', any ? fmtSigned(st.worst) : dash, resultClass(st.worst)),
    summaryRow('Max drawdown', any ? fmt(Math.round(st.drawdown.max)) : dash,
               st.drawdown.max > 0 ? 'neg' : '', '',
               any ? 'Largest peak-to-trough fall the bankroll has taken.' : ''),
    // The actionable one: max drawdown is history, this is where you are now.
    // Zero means the last session left you at an all-time high, which is worth
    // seeing as plainly as a loss is.
    summaryRow('Current drawdown',
               any ? (st.drawdown.current > 0 ? fmt(Math.round(st.drawdown.current)) : 'at peak') : dash,
               st.drawdown.current > 0 ? 'neg' : 'pos', '',
               any ? (st.drawdown.current > 0
                 ? `How far the bankroll sits below its all-time high right now.`
                 : 'The bankroll is at its all-time high.') : ''),
    summaryRow('Longest win streak', any ? String(st.streaks.longestWin) : dash, '', '',
               any ? `Current run: ${st.streaks.currentWin}.` : ''),
    summaryRow('Longest loss streak', any ? String(st.streaks.longestLoss) : dash, '', '',
               any ? `Current run: ${st.streaks.currentLoss}.` : '')
  ];

  // Hours are optional, so the cash rows only appear once some are recorded.
  // Until then they would be permanent em-dashes.
  const cash = [];
  if(bb){
    // ± is the 95% half-width, which is the honest headline: a win rate over a
    // few hundred hours is mostly noise, and printing "4.2" alone invites you
    // to believe a number the sample cannot support.
    const margin = bb.se == null ? null : 1.96 * bb.se;
    const value = fmtBB(bb.bbPer100) +
      (margin == null ? '' : ` <span class="pm">± ${margin.toFixed(1)}</span>`);
    const detail = [
      `${bb.sessions} session${bb.sessions === 1 ? '' : 's'}, about ${Math.round(bb.hands).toLocaleString()} hands (${bb.hours.toFixed(1)}h × ${handsPerHour()}/hr).`,
      margin == null ? 'A second session is needed before an interval means anything.'
        : `95% confident the true rate is between ${fmtBB(bb.low)} and ${fmtBB(bb.high)}.`,
      bb.sdPer100 == null ? '' : `Standard deviation ${bb.sdPer100.toFixed(0)} bb/100.`
    ].filter(Boolean).join(' ');
    cash.push(summaryRow('bb/100', value, resultClass(bb.bbPer100), '', detail));
  }
  if(st.timedCount){
    cash.push(summaryRow('Hourly rate', fmtSigned(Math.round(st.hourly)) + '/hr',
                         resultClass(st.hourly), '',
                         `Based on the ${st.timedCount} of ${st.cashCount} cash sessions with hours recorded. Tournaments are excluded — their length is set by the structure, not by you.`));
    cash.push(summaryRow('Hours played', st.totalHours.toFixed(1)));
  }

  const tourney = [];
  if(t.count){
    tourney.push(summaryRow('ROI', (t.roi >= 0 ? '+' : '−') + Math.abs(t.roi).toFixed(1) + '%',
                            resultClass(t.roi), '',
                            `${fmtSigned(Math.round(t.profit))} on ${fmt(Math.round(t.cost))} of buy-ins.`));
    tourney.push(summaryRow('In the money', t.itmRate.toFixed(0) + '%', '', '',
                            `Cashed ${t.itm} of ${t.count}.`));
    tourney.push(summaryRow('Buy-ins', fmt(Math.round(t.cost)), '', '',
                            t.entries === t.count ? '' : `${t.entries} entries across ${t.count} tournaments — you re-entered ${t.entries - t.count} time${t.entries - t.count === 1 ? '' : 's'}.`));
    tourney.push(summaryRow('Winnings', fmt(Math.round(t.winnings))));
    if(t.bestPlace !== null){
      tourney.push(summaryRow('Best finish', ordinal(t.bestPlace), '', '',
                              t.avgField ? `Average field ${Math.round(t.avgField)}.` : ''));
    }
  }

  document.getElementById('statsRow').innerHTML = [
    ...shared,
    cash.length    ? sectionRow('Cash games') : '',    ...cash,
    tourney.length ? sectionRow('Tournaments') : '',   ...tourney
  ].join('');
}

// 1st, 2nd, 3rd, 4th… 11th–13th are the exceptions that trip the naive rule.
function ordinal(n){
  const rem100 = n % 100;
  if(rem100 >= 11 && rem100 <= 13) return n + 'th';
  return n + (['th','st','nd','rd'][n % 10] || 'th');
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

// Tags you have used before, as chips that toggle into the comma-separated
// input. A datalist cannot do this job: it matches against the whole field,
// and this field holds a list, so it would only ever suggest on the first tag.
function renderTagSuggestions(){
  const box = document.getElementById('tagSuggest');
  const input = document.getElementById('f-tags');
  const known = allTags(sessions);
  if(!known.length){ box.innerHTML = ''; return; }

  const chosen = new Set(parseTags(input.value));
  box.innerHTML = known.slice(0, 12).map(t=>
    `<button type="button" class="tag-chip ${chosen.has(t)?'on':''}" aria-pressed="${chosen.has(t)}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`
  ).join('');

  box.querySelectorAll('.tag-chip').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tag = btn.dataset.tag;
      const now = parseTags(input.value);
      const next = now.includes(tag) ? now.filter(t=>t !== tag) : [...now, tag];
      input.value = next.join(', ');
      renderTagSuggestions();     // re-render so the pressed state follows
    });
  });
}

// Typing a tag by hand has to light its chip too, or the two disagree.
document.getElementById('f-tags').addEventListener('input', renderTagSuggestions);

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
  const tags = allTags(sessions);
  // Fixed order rather than order-of-appearance, so the chips don't reshuffle
  // when you add a session. renderChipRow hides the row entirely when there is
  // only one value, so an all-cash ledger never sees this filter at all.
  const types = ['cash','tournament'].filter(t => sessions.some(s => (s.sessionType || 'cash') === t));

  // A filtered-away value may have just been deleted; without this the list
  // filters down to nothing and the chip to clear it no longer exists.
  if(activeFilter !== 'all' && !stakes.includes(activeFilter)) activeFilter = 'all';
  if(activeLocation !== 'all' && !locations.includes(activeLocation)) activeLocation = 'all';
  if(activeTag !== 'all' && !tags.includes(activeTag)) activeTag = 'all';
  if(activeType !== 'all' && !types.includes(activeType)) activeType = 'all';

  // A month picked by clicking the by-month chart appears as an extra chip so
  // there is always a visible way to see it and clear it.
  const ranges = ['thisMonth', '90d', 'thisYear'];
  if(/^\d{4}-\d{2}$/.test(activeRange)) ranges.push(activeRange);

  renderChipRow('rangeRow', ranges, activeRange, 'All time',
    v=>{ activeRange = v; render(); }, rangeLabel);
  renderChipRow('typeRow', types, activeType, 'Both formats',
    v=>{ activeType = v; render(); }, v => v === 'cash' ? 'Cash' : 'Tournaments');
  renderChipRow('filterRow', stakes, activeFilter, 'All stakes',
    v=>{ activeFilter = v; render(); });
  renderChipRow('locationFilterRow', locations, activeLocation, 'All venues',
    v=>{ activeLocation = v; render(); });
  renderChipRow('tagRow', tags, activeTag, 'All tags',
    v=>{ activeTag = v; render(); }, v => '#' + v);

  const filtered = visibleSessions().length;
  const note = document.getElementById('filterNote');
  const on = activeFilter !== 'all' || activeLocation !== 'all' || activeRange !== 'all'
          || activeType !== 'all' || activeTag !== 'all';
  note.textContent = on
    ? `Showing ${filtered} of ${sessions.length} sessions — every figure and chart below reflects this.`
    : '';
  note.style.display = on ? 'block' : 'none';
}

function visibleSessions(){
  return sessions
    .filter(s=> activeType === 'all' || (s.sessionType || 'cash') === activeType)
    .filter(s=> activeFilter === 'all' || stakesLabel(s) === activeFilter)
    .filter(s=> activeLocation === 'all' || s.location === activeLocation)
    .filter(s=> activeTag === 'all' || hasTag(s, activeTag))
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
    // A tournament additionally shows its cost, because its profit is
    // cash-out minus (buy-in + fee) × entries — arithmetic you cannot do in
    // your head from the row unless the row says what it cost.
    const tourneyDetail = !isTournament(s) ? '' :
      dim('MTT')
      + ((s.entries || 1) > 1 ? dim(s.entries + ' entries') : '')
      + dim('cost ' + fmt(totalCost(s), s.currency))
      + (s.place ? dim(ordinal(s.place) + (s.fieldSize ? ' of ' + s.fieldSize : '')) : '');

    const detail = escapeHtml(stakesLabel(s))
      + tourneyDetail
      + (typeof s.hours === 'number' ? dim(s.hours + 'h') : '')
      + (multiVenue ? dim(escapeHtml(s.location)) : '')
      // The rate is shown alongside the converted figure so the arithmetic on
      // this row can be checked, and so a session valued at an old rate is
      // visibly valued at an old rate rather than mysteriously different.
      + (s.currency === baseCurrency() ? ''
         : dim('≈ ' + fmt(Math.round(profitBase(s))) + ' @' + formatRate(sessionRate(s))))
      + sessionTags(s).map(t=>` <span class="tag">#${escapeHtml(t)}</span>`).join('')
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

const typeSelect = document.getElementById('f-type');
const rateInput = document.getElementById('f-rate');

function formIsTournament(){ return typeSelect.value === 'tournament'; }

// ---------- Live rates ----------
// The most recent rates snapshot, or null before the first fetch resolves.
// Only ever used to PREFILL the rate field; it can never change what a saved
// session is worth, because that rate lives on the row.
let ratesSnapshot = null;

const RATE_SOURCE_TEXT = {
  live:    (d) => `live rate${d ? ' · ' + shortDate(d) : ''}`,
  cached:  (d) => `cached rate${d ? ' · ' + shortDate(d) : ''}`,
  config:  () => 'from config.js — could not reach the rate service',
  unknown: () => 'no rate known — enter one by hand',
  saved:   () => 'the rate this session was saved at',
  base:    () => '',
};

// Whether the number in the box is the user's own. Tracked rather than
// inferred from "is it non-empty", because a rate loaded off a saved session
// is also non-empty and must not be described as edited.
let rateTouched = false;

function shortDate(iso){
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, {day:'numeric', month:'short'});
}

// Where the number currently in the field came from, for the note beneath it.
let rateDisplay = { source: 'base', date: null };

/** Show or hide the rate row, and describe where the number came from. */
function renderRateField(source, date, edited){
  const cur = currencySelect.value;
  const foreign = cur !== baseCurrency();
  document.getElementById('rateField').style.display = foreign ? '' : 'none';
  if(!foreign) return;

  document.getElementById('lbl-rate').textContent = `Rate · 1 ${cur} = ? ${baseCurrency()}`;
  const note = document.getElementById('rateSource');
  note.textContent = edited
    ? 'edited — this session will be valued at your figure'
    : (RATE_SOURCE_TEXT[source] || RATE_SOURCE_TEXT.unknown)(date);
  note.className = source === 'config' || source === 'unknown' ? 'warn' : '';
}

/**
 * Put a rate in the field for the currently selected currency.
 *
 * Never overwrites a rate the user typed, and never overwrites the rate an
 * existing session was saved with — editing a session must not silently
 * revalue it just because the form was opened on a different day.
 */
function fillRate({ force = false } = {}){
  const cur = currencySelect.value;
  if(cur === baseCurrency()){
    rateInput.value = '';
    rateDisplay = { source: 'base', date: null };
    rateTouched = false;
    renderRateField('base', null, false);
    return;
  }
  // Leave a number that is already there alone — typed by hand, or loaded off
  // a saved session. Only a currency change forces past this.
  if(!force && rateInput.value.trim() !== ''){
    renderRateField(rateDisplay.source, rateDisplay.date, rateTouched);
    return;
  }
  const { rate, source, date } = prefillRate(cur, ratesSnapshot);
  rateInput.value = formatRate(rate);
  rateDisplay = { source, date };
  rateTouched = false;
  renderRateField(source, date, false);
}

/** Refresh the snapshot in the background, then reprice an untouched field. */
async function loadRates({ force = false } = {}){
  const snap = force ? await refreshRates() : await ensureRates();
  if(snap) ratesSnapshot = snap;
  // Only when the form is open and the user hasn't typed their own number.
  if(form.classList.contains('open')) fillRate({ force });
}

document.getElementById('refreshRate').addEventListener('click', ()=>{
  void loadRates({ force: true });
});

// Typing a rate makes it yours; the note stops claiming it came from the wire.
rateInput.addEventListener('input', ()=>{
  rateTouched = true;
  renderRateField(rateDisplay.source, rateDisplay.date, true);
});

// Buy-in/cash-out are entered in the selected currency, so say which. The
// wording changes with the format too: a tournament's buy-in is per entry and
// its "cash-out" is winnings, and calling both by the cash-game name is how
// you end up recording the total spend in a field the app reads as one entry.
function updateAmountLabels(){
  const sym = symbolFor(currencySelect.value).trim();
  const mtt = formIsTournament();
  document.getElementById('lbl-buyin').textContent =
    mtt ? `Buy-in (${sym}) per entry` : `Buy-in (${sym})`;
  document.getElementById('lbl-cashout').textContent =
    mtt ? `Winnings (${sym})` : `Cash-out (${sym})`;
  document.getElementById('lbl-fee').innerHTML =
    `Fee (${escapeHtml(sym)}) <span class="opt">per entry</span>`;
  document.getElementById('lbl-stakes').textContent = mtt ? 'Event' : 'Stakes';
  document.getElementById('f-stakes').placeholder = mtt ? 'Sunday Main' : '1/2';
  // CSS hides .tourney-only unless the form carries this class.
  form.classList.toggle('tournament', mtt);
}
currencySelect.addEventListener('change', updateAmountLabels);
typeSelect.addEventListener('change', updateAmountLabels);
updateAmountLabels();

// Switching currency invalidates whatever rate was in the box — it belonged to
// the old one — so this refill is forced past the "don't clobber typing" guard.
currencySelect.addEventListener('change', ()=> fillRate({ force: true }));

function todayLocal(){
  // valueAsDate reads back as UTC, which lands on the wrong day west of GMT.
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function clearFormFields(){
  ['f-location','f-stakes','f-buyin','f-cashout','f-hours','f-notes',
   'f-fee','f-entries','f-place','f-field','f-tags','f-rate'].forEach(id=>{
    document.getElementById(id).value = '';
  });
  currencySelect.value = baseCurrency();
  typeSelect.value = 'cash';
  updateAmountLabels();   // setting .value in code fires no 'change' event
  fillRate({ force: true });
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
    typeSelect.value = session.sessionType || 'cash';
    document.getElementById('f-hours').value = session.hours ?? '';
    document.getElementById('f-fee').value = session.fee ?? '';
    document.getElementById('f-entries').value = session.entries ?? '';
    document.getElementById('f-place').value = session.place ?? '';
    document.getElementById('f-field').value = session.fieldSize ?? '';
    document.getElementById('f-tags').value = sessionTags(session).join(', ');
    document.getElementById('f-notes').value = session.notes;
    updateAmountLabels();
    // The rate this session was SAVED at, not today's. Reopening a March
    // session in July must not quietly revalue it — that is the whole reason
    // the rate lives on the row.
    rateInput.value = formatRate(session.fxRate ?? rateFor(session.currency));
    rateDisplay = { source: session.fxRate ? 'saved' : 'config', date: null };
    rateTouched = false;
    renderRateField(rateDisplay.source, null, false);
  } else {
    clearFormFields();
    document.getElementById('f-date').value = todayLocal();
  }

  // Refresh in the background; only an untouched, unsaved field gets repriced.
  void loadRates();
  renderTagSuggestions();
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
  const sessionType = typeSelect.value;
  const mtt = sessionType === 'tournament';
  // Blank stays null: "not recorded" is not the same as zero hours.
  const rawHours = document.getElementById('f-hours').value.trim();
  const hours = rawHours === '' ? null : parseFloat(rawHours);
  const notes = document.getElementById('f-notes').value.trim();
  const tags = parseTags(document.getElementById('f-tags').value);
  // The base currency is 1 of itself by definition; never store a user's typo
  // for it. Everything else is pinned to whatever is in the field.
  const rawRate = rateInput.value.trim();
  const fxRate = currency === baseCurrency()
    ? 1
    : (rawRate === '' ? null : parseFloat(rawRate));

  // Same rule for all four: blank means not recorded, and only a tournament
  // records them at all.
  const optNum = id => {
    const raw = document.getElementById(id).value.trim();
    return raw === '' ? null : parseFloat(raw);
  };
  const fee       = mtt ? optNum('f-fee') : null;
  const entries   = mtt ? optNum('f-entries') : null;
  const place     = mtt ? optNum('f-place') : null;
  const fieldSize = mtt ? optNum('f-field') : null;

  if(!date || !location || !stakes || isNaN(buyIn) || isNaN(cashOut)){
    showFormError(mtt
      ? 'Fill in date, location, event, buy-in, and winnings (0 if you busted).'
      : 'Fill in date, location, stakes, buy-in, and cash-out.');
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
  // A foreign session with no rate cannot be totalled, and guessing one later
  // is how a ledger quietly stops adding up.
  if(currency !== baseCurrency() && (fxRate === null || isNaN(fxRate) || fxRate <= 0)){
    showFormError(`Enter the exchange rate for this session — how many ${baseCurrency()} one ${currency} was worth. Tap ↻ to fetch today's.`);
    return;
  }
  if(mtt){
    if(fee !== null && (isNaN(fee) || fee < 0)){
      showFormError('The fee is an amount, not a result — it cannot be negative. Leave it blank if the buy-in had no fee on top.');
      return;
    }
    // Entries is the one field that must not be left to interpretation: it
    // multiplies the cost, so a stray 0 would report the tournament as free.
    if(entries !== null && (isNaN(entries) || entries < 1 || entries % 1 !== 0)){
      showFormError('Entries must be a whole number of at least 1 — one for a freezeout, more if you re-entered. Leave it blank for one.');
      return;
    }
    for(const [v, name] of [[place,'Finish'], [fieldSize,'Field size']]){
      if(v !== null && (isNaN(v) || v < 1 || v % 1 !== 0)){
        showFormError(`${name} must be a whole number of at least 1, or left blank.`);
        return;
      }
    }
    if(place !== null && fieldSize !== null && place > fieldSize){
      showFormError('You cannot finish lower than the size of the field.');
      return;
    }
  }

  const saveBtn = document.getElementById('saveSessionBtn');
  saveBtn.disabled = true;
  try {
    const payload = {date, location, stakes, buyIn, cashOut, currency, hours, notes,
                     sessionType, fee, entries, place, fieldSize, tags, fxRate};
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
