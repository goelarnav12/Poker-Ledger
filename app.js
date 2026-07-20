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
let editingId = null;           // non-null while the form is editing a session
let profitChart, stakesChart, monthlyChart;

const authView = document.getElementById('authView');
const appView = document.getElementById('app');
const bankrollBlock = document.getElementById('bankrollBlock');
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
      closeForm();
      appView.style.display = 'none';
      bankrollBlock.style.display = 'none';
      authView.style.display = 'flex';
    }
  });
}

async function enterApp(){
  authView.style.display = 'none';
  appView.style.display = 'block';
  bankrollBlock.style.display = 'block';
  userEmailLabel.textContent = currentUser.email;
  await loadSessions();
}

// ---------- Auth actions ----------
// boot() bails out before creating `client` when config.js is unedited, so the
// auth buttons have to survive being clicked with no client.
function requireClient(){
  if(client) return true;
  authError.style.color = 'var(--crimson)';
  authError.textContent = 'Supabase is not configured yet — fill in config.js.';
  return false;
}

document.getElementById('signUpBtn').addEventListener('click', async ()=>{
  if(!requireClient()) return;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  authError.style.color = 'var(--gold-bright)';
  authError.textContent = '';
  if(!email || password.length < 6){
    authError.style.color = 'var(--crimson)';
    authError.textContent = 'Enter an email and a password of at least 6 characters.';
    return;
  }
  const { data, error } = await client.auth.signUp({ email, password });
  if(error){
    authError.style.color = 'var(--crimson)';
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
  authError.style.color = 'var(--crimson)';
  authError.textContent = '';
  const { error } = await client.auth.signInWithPassword({ email, password });
  if(error){ authError.textContent = error.message; }
});

document.getElementById('signOutBtn').addEventListener('click', async ()=>{
  await client.auth.signOut();
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
        notes: r.notes || ''
      }));
    }
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

// ---------- Render ----------
function render(){
  const st = computeStats(sessions);

  const bkEl = document.getElementById('bankrollNum');
  bkEl.textContent = fmt(st.totalProfit);
  bkEl.className = 'num ' + resultClass(st.totalProfit);

  renderStats(st);
  document.getElementById('sessionCount').textContent =
    sessions.length + (sessions.length === 1 ? ' session' : ' sessions');

  renderChart();
  renderMonthlyChart();
  renderStakesChart();
  renderFilters();
  renderList();
  renderDatalists();
}

function statTile(k, v, cls, title){
  return `<div class="stat"${title ? ` title="${escapeHtml(title)}"` : ''}>
    <div class="k">${escapeHtml(k)}</div><div class="v ${cls||''}">${v}</div></div>`;
}

function renderStats(st){
  const any = st.count > 0;
  const dash = '—';
  document.getElementById('statsRow').innerHTML = [
    statTile('Win Rate', any ? st.winRate.toFixed(0)+'%' : dash),
    statTile('Sessions', String(st.count)),
    statTile('Avg / Session', any ? fmt(Math.round(st.avg)) : dash, resultClass(st.avg),
             'Mean profit per session'),
    statTile('Median', any ? fmt(Math.round(st.median)) : dash, resultClass(st.median),
             'The middle session. A median well below the mean means a few big wins are carrying the average.'),
    statTile('Std Deviation', any ? fmt(Math.round(st.stdDev)) : dash, '',
             'How spread out your results are, session to session.'),
    statTile('Best Session', any ? fmt(st.best) : dash, resultClass(st.best)),
    statTile('Worst Session', any ? fmt(st.worst) : dash, resultClass(st.worst)),
    statTile('Max Drawdown', any ? fmt(Math.round(st.drawdown.max)) : dash,
             st.drawdown.max > 0 ? 'neg' : '',
             `Largest peak-to-trough fall in the running bankroll. Currently ${fmt(Math.round(st.drawdown.current))} below the all-time peak.`),
    statTile('Longest Win Streak', any ? String(st.streaks.longestWin) : dash, '',
             `Current run: ${st.streaks.currentWin} winning session(s).`),
    statTile('Longest Loss Streak', any ? String(st.streaks.longestLoss) : dash, '',
             `Current run: ${st.streaks.currentLoss} losing session(s).`)
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

// Shared Chart.js styling so the three charts stay visually consistent.
const AXIS_TICKS = {color:'#C9BFA9', font:{family:'IBM Plex Mono', size:10}};
const GRID = {color:'rgba(243,234,216,0.06)'};
const MONEY_TOOLTIP = {callbacks:{label: c=>fmt(Math.round(c.parsed.y))}};

function renderChart(){
  const ctx = document.getElementById('profitChart');
  let running = 0;
  const points = chronological(sessions).map(s=>{
    running += profitBase(s);
    return {x: s.date, y: running};
  });

  if(profitChart) profitChart.destroy();
  profitChart = new Chart(ctx, {
    type:'line',
    data:{ datasets:[{
      data: points,
      borderColor:'#E0BC3E',
      backgroundColor:'rgba(201,162,39,0.12)',
      fill:true,
      tension:0.25,
      pointRadius:3,
      pointBackgroundColor:'#E0BC3E',
      borderWidth:2
    }]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:MONEY_TOOLTIP },
      scales:{
        x:{type:'time', time:{unit:'day'}, grid:GRID, ticks:AXIS_TICKS},
        y:{grid:GRID, ticks:{...AXIS_TICKS, callback:fmtAxis}}
      }
    }
  });
}

function renderMonthlyChart(){
  const panel = document.getElementById('monthlyPanel');
  const buckets = monthlyTotals(sessions);
  if(buckets.length === 0){ panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  const data = buckets.map(b=>b.total);
  const ctx = document.getElementById('monthlyChart');
  if(monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(ctx, {
    type:'bar',
    data:{ labels: buckets.map(b=>b.label), datasets:[{
      data,
      backgroundColor: data.map(v=> v>=0 ? 'rgba(224,188,62,0.75)' : 'rgba(168,50,74,0.75)'),
      borderRadius:5
    }]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:MONEY_TOOLTIP },
      scales:{
        x:{grid:{display:false}, ticks:{...AXIS_TICKS, size:11}},
        y:{grid:GRID, ticks:{...AXIS_TICKS, callback:fmtAxis}}
      }
    }
  });
}

function renderStakesChart(){
  const panel = document.getElementById('stakesPanel');
  if(sessions.length === 0){ panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  const byStakes = {};
  sessions.forEach(s=>{
    const k = stakesLabel(s);
    byStakes[k] = (byStakes[k]||0) + profitBase(s);
  });
  const labels = Object.keys(byStakes);
  const data = Object.values(byStakes);

  const ctx = document.getElementById('stakesChart');
  if(stakesChart) stakesChart.destroy();
  stakesChart = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{
      data,
      backgroundColor: data.map(v=> v>=0 ? 'rgba(224,188,62,0.75)' : 'rgba(168,50,74,0.75)'),
      borderRadius:5
    }]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:MONEY_TOOLTIP },
      scales:{
        x:{grid:{display:false}, ticks:{...AXIS_TICKS, size:11}},
        y:{grid:GRID, ticks:{...AXIS_TICKS, callback:fmtAxis}}
      }
    }
  });
}

// ---------- Filters ----------
function renderChipRow(rowId, values, active, allLabel, onPick){
  const row = document.getElementById(rowId);
  // One value means the chips can only say "all" or the same thing twice.
  if(values.length <= 1){ row.innerHTML = ''; return; }
  row.innerHTML = ['all', ...values].map(v=>
    `<button class="filter-chip ${v===active?'active':''}" aria-pressed="${v===active}" data-value="${escapeHtml(v)}">${v==='all'?escapeHtml(allLabel):escapeHtml(v)}</button>`
  ).join('');
  row.querySelectorAll('.filter-chip').forEach(btn=>{
    btn.addEventListener('click', ()=> onPick(btn.dataset.value));
  });
}

function renderFilters(){
  const stakes = [...new Set(sessions.map(stakesLabel))];
  const locations = [...new Set(sessions.map(s=>s.location))];

  // A filtered-away value may have just been deleted; without this the list
  // filters down to nothing and the chip to clear it no longer exists.
  if(activeFilter !== 'all' && !stakes.includes(activeFilter)) activeFilter = 'all';
  if(activeLocation !== 'all' && !locations.includes(activeLocation)) activeLocation = 'all';

  renderChipRow('filterRow', stakes, activeFilter, 'All Stakes',
    v=>{ activeFilter = v; renderFilters(); renderList(); });
  renderChipRow('locationFilterRow', locations, activeLocation, 'All Venues',
    v=>{ activeLocation = v; renderFilters(); renderList(); });
}

function visibleSessions(){
  return sessions
    .filter(s=> activeFilter === 'all' || stakesLabel(s) === activeFilter)
    .filter(s=> activeLocation === 'all' || s.location === activeLocation)
    .sort((a,b)=> a.date < b.date ? 1 : a.date > b.date ? -1 : 0);   // newest first
}

// ---------- Session list ----------
function renderList(){
  const list = document.getElementById('sessionList');
  const empty = document.getElementById('emptyNote');
  const filtered = visibleSessions();

  if(filtered.length === 0){
    list.innerHTML = '';
    empty.textContent = sessions.length
      ? 'No sessions match these filters.'
      : 'No sessions yet — add your first one above.';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = filtered.map(s=>{
    const profit = profitOf(s);
    const cls = profit>0?'win':profit<0?'loss':'';
    const dateStr = new Date(s.date+'T00:00:00')
      .toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    // Foreign sessions show the amount actually won alongside what it counts
    // for in the totals, so the arithmetic on this page is never a mystery.
    const converted = s.currency === baseCurrency()
      ? '' : ' · ≈ ' + fmt(Math.round(profitBase(s)));
    const what = `${s.location} on ${dateStr}`;
    return `
      <div class="session ${cls}" data-id="${escapeHtml(s.id)}">
        <div class="date">${dateStr}</div>
        <div class="meta">
          <div class="loc">${escapeHtml(s.location)}</div>
          <div class="sub">${escapeHtml(stakesLabel(s))}${converted}${s.notes ? ' · '+escapeHtml(s.notes) : ''}</div>
        </div>
        <div class="result ${resultClass(profit)}">${fmt(profit, s.currency)}</div>
        <button class="edit" data-act="edit" title="Edit session" aria-label="Edit session at ${escapeHtml(what)}">✎</button>
        <button class="del" data-act="del" title="Delete session" aria-label="Delete session at ${escapeHtml(what)}">✕</button>
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
        btn.textContent = 'Sure?';
        btn.classList.add('armed');
        armTimer = setTimeout(()=>{
          btn.dataset.armed = '0';
          btn.textContent = '✕';
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
  ['f-location','f-stakes','f-buyin','f-cashout','f-notes'].forEach(id=>{
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
  const notes = document.getElementById('f-notes').value.trim();

  if(!date || !location || !stakes || isNaN(buyIn) || isNaN(cashOut)){
    showFormError('Fill in date, location, stakes, buy-in, and cash-out.');
    return;
  }
  if(buyIn < 0 || cashOut < 0){
    showFormError('Buy-in and cash-out are amounts, not results — neither can be negative. A losing session is a cash-out lower than the buy-in.');
    return;
  }

  const saveBtn = document.getElementById('saveSessionBtn');
  saveBtn.disabled = true;
  try {
    const payload = {date, location, stakes, buyIn, cashOut, currency, notes};
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
