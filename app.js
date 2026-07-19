// ---------- Setup ----------
let client = null;
let currentUser = null;
let sessions = [];
let activeFilter = 'all';
let profitChart, stakesChart;

const authView = document.getElementById('authView');
const appView = document.getElementById('app');
const bankrollBlock = document.getElementById('bankrollBlock');
const authError = document.getElementById('authError');
const userEmailLabel = document.getElementById('userEmailLabel');
const configWarning = document.getElementById('configWarning');

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
      currentUser = session.user;
      enterApp();
    } else if(event === 'SIGNED_OUT'){
      currentUser = null;
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
document.getElementById('signUpBtn').addEventListener('click', async ()=>{
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

// ---------- Data layer ----------
async function loadSessions(){
  const { data, error } = await client
    .from('sessions')
    .select('*')
    .order('date', { ascending: true });

  if(error){
    console.error(error);
    sessions = [];
  } else {
    sessions = data.map(r => ({
      id: r.id,
      date: r.date,
      location: r.location,
      stakes: r.stakes,
      buyIn: Number(r.buy_in),
      cashOut: Number(r.cash_out),
      hours: Number(r.hours),
      notes: r.notes || ''
    }));
  }
  render();
}

async function addSession(s){
  const { error } = await client.from('sessions').insert({
    user_id: currentUser.id,
    date: s.date,
    location: s.location,
    stakes: s.stakes,
    buy_in: s.buyIn,
    cash_out: s.cashOut,
    hours: s.hours,
    notes: s.notes
  });
  if(error){
    alert('Could not save session: ' + error.message);
    return false;
  }
  return true;
}

async function deleteSession(id){
  const { error } = await client.from('sessions').delete().eq('id', id);
  if(error){ alert('Could not delete session: ' + error.message); }
}

// ---------- Formatting helpers ----------
function fmt(n){
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0});
}
function resultClass(n){ return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'; }
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function computeStats(list){
  const totalProfit = list.reduce((s,x)=>s+(x.cashOut-x.buyIn),0);
  const totalHours = list.reduce((s,x)=>s+x.hours,0);
  const hourly = totalHours > 0 ? totalProfit/totalHours : 0;
  const wins = list.filter(x=>x.cashOut-x.buyIn>0).length;
  const winRate = list.length ? (wins/list.length*100) : 0;
  const best = list.length ? list.reduce((m,x)=>Math.max(m,x.cashOut-x.buyIn), -Infinity) : 0;
  const worst = list.length ? list.reduce((m,x)=>Math.min(m,x.cashOut-x.buyIn), Infinity) : 0;
  return {totalProfit, totalHours, hourly, winRate, best, worst};
}

// ---------- Render ----------
function render(){
  const stats = computeStats(sessions);
  const bkEl = document.getElementById('bankrollNum');
  bkEl.textContent = fmt(stats.totalProfit);
  bkEl.className = 'num ' + resultClass(stats.totalProfit);

  document.getElementById('statsRow').innerHTML = `
    <div class="stat"><div class="k">Hourly Rate</div><div class="v ${resultClass(stats.hourly)}">${fmt(Math.round(stats.hourly))}/hr</div></div>
    <div class="stat"><div class="k">Win Rate</div><div class="v">${stats.winRate.toFixed(0)}%</div></div>
    <div class="stat"><div class="k">Total Hours</div><div class="v">${stats.totalHours.toFixed(1)}</div></div>
    <div class="stat"><div class="k">Sessions</div><div class="v">${sessions.length}</div></div>
    <div class="stat"><div class="k">Best Session</div><div class="v pos">${sessions.length?fmt(stats.best):'—'}</div></div>
    <div class="stat"><div class="k">Worst Session</div><div class="v neg">${sessions.length?fmt(stats.worst):'—'}</div></div>
  `;

  document.getElementById('sessionCount').textContent = sessions.length + (sessions.length===1?' session':' sessions');

  renderChart();
  renderStakesChart();
  renderFilters();
  renderList();
}

function renderChart(){
  const ctx = document.getElementById('profitChart');
  const sorted = [...sessions].sort((a,b)=>new Date(a.date)-new Date(b.date));
  let running = 0;
  const points = sorted.map(s=>{
    running += (s.cashOut - s.buyIn);
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
      plugins:{legend:{display:false}},
      scales:{
        x:{type:'time', time:{unit:'day'}, grid:{color:'rgba(243,234,216,0.06)'}, ticks:{color:'#C9BFA9', font:{family:'IBM Plex Mono', size:10}}},
        y:{grid:{color:'rgba(243,234,216,0.06)'}, ticks:{color:'#C9BFA9', font:{family:'IBM Plex Mono', size:10}, callback:v=>'$'+v}}
      }
    }
  });
}

function renderStakesChart(){
  const panel = document.getElementById('stakesPanel');
  if(sessions.length === 0){ panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  const byStakes = {};
  sessions.forEach(s=>{ byStakes[s.stakes] = (byStakes[s.stakes]||0) + (s.cashOut - s.buyIn); });
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
      plugins:{legend:{display:false}},
      scales:{
        x:{grid:{display:false}, ticks:{color:'#C9BFA9', font:{family:'IBM Plex Mono', size:11}}},
        y:{grid:{color:'rgba(243,234,216,0.06)'}, ticks:{color:'#C9BFA9', font:{family:'IBM Plex Mono', size:10}, callback:v=>'$'+v}}
      }
    }
  });
}

function renderFilters(){
  const stakesSet = ['all', ...new Set(sessions.map(s=>s.stakes))];
  const row = document.getElementById('filterRow');
  if(sessions.length <= 1){ row.innerHTML=''; return; }
  row.innerHTML = stakesSet.map(s=>`<button class="filter-chip ${s===activeFilter?'active':''}" data-stakes="${escapeHtml(s)}">${s==='all'?'All Stakes':escapeHtml(s)}</button>`).join('');
  row.querySelectorAll('.filter-chip').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      activeFilter = btn.dataset.stakes;
      renderFilters();
      renderList();
    });
  });
}

function renderList(){
  const list = document.getElementById('sessionList');
  const empty = document.getElementById('emptyNote');
  const filtered = sessions
    .filter(s=> activeFilter==='all' || s.stakes===activeFilter)
    .sort((a,b)=> new Date(b.date)-new Date(a.date));

  if(filtered.length === 0){
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = filtered.map(s=>{
    const profit = s.cashOut - s.buyIn;
    const cls = profit>0?'win':profit<0?'loss':'';
    const dateStr = new Date(s.date+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    return `
      <div class="session ${cls}" data-id="${s.id}">
        <div class="date">${dateStr}</div>
        <div class="meta">
          <div class="loc">${escapeHtml(s.location)}</div>
          <div class="sub">${escapeHtml(s.stakes)} · ${s.hours}h${s.notes ? ' · '+escapeHtml(s.notes) : ''}</div>
        </div>
        <div class="result ${resultClass(profit)}">${fmt(profit)}</div>
        <button class="del" title="Delete session" aria-label="Delete session">✕</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.del').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.target.closest('.session').dataset.id;
      await deleteSession(id);
      await loadSessions();
    });
  });
}

// ---------- Add-session form ----------
const form = document.getElementById('sessionForm');
const toggleBtn = document.getElementById('toggleForm');
const cancelBtn = document.getElementById('cancelForm');

toggleBtn.addEventListener('click', ()=>{
  form.classList.add('open');
  document.getElementById('f-date').valueAsDate = new Date();
  toggleBtn.style.display = 'none';
});
cancelBtn.addEventListener('click', ()=>{
  form.classList.remove('open');
  clearForm();
  toggleBtn.style.display = 'inline-block';
});

function clearForm(){
  ['f-location','f-stakes','f-buyin','f-cashout','f-hours','f-notes'].forEach(id=>{
    document.getElementById(id).value = '';
  });
}

document.getElementById('saveSessionBtn').addEventListener('click', async ()=>{
  const date = document.getElementById('f-date').value;
  const location = document.getElementById('f-location').value.trim();
  const stakes = document.getElementById('f-stakes').value.trim();
  const buyIn = parseFloat(document.getElementById('f-buyin').value);
  const cashOut = parseFloat(document.getElementById('f-cashout').value);
  const hours = parseFloat(document.getElementById('f-hours').value);
  const notes = document.getElementById('f-notes').value.trim();

  if(!date || !location || !stakes || isNaN(buyIn) || isNaN(cashOut) || isNaN(hours)){
    alert('Please fill in date, location, stakes, buy-in, cash-out, and hours.');
    return;
  }

  const ok = await addSession({date, location, stakes, buyIn, cashOut, hours, notes});
  if(ok){
    clearForm();
    form.classList.remove('open');
    toggleBtn.style.display = 'inline-block';
    await loadSessions();
  }
});

boot();
