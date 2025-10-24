// toast
const toast = document.getElementById('toast');
const toastDot = document.getElementById('toast-dot');
const toastText = document.getElementById('toast-text');
let hideTimer = null;

function showToast(ok, msg){
  toast.classList.add('show');
  toastDot.className = 'dot ' + (ok ? 'good' : 'bad');
  toastText.textContent = msg;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(()=>toast.classList.remove('show'), 6000);
}

function markCard(card, ok){
  card.style.outline = '2px solid ' + (ok ? '#16a34a' : '#b91c1c');
  card.style.outlineOffset = '3px';
  setTimeout(()=>{ card.style.outline='none'; }, 6000);
}

// data + state
const DATA_URL = './emails.json';
let GROUP_KEYS = null;
let GROUP_INDEX = 0;
let LIST = [];
let INDEX = 0;
let SCORE = 0;
let LOCK = false;

function escapeHtml(str){
  return String(str ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

async function loadData(){
  const res = await fetch(DATA_URL, { cache: 'no-store' });
  if(!res.ok) throw new Error('Failed to load emails.json');
  return res.json();
}

function initGroups(data){
  if (GROUP_KEYS) return;
  GROUP_KEYS = Object.keys(data).filter(k=>k.startsWith('email_group_')).sort();
}

function getList(data){
  const key = GROUP_KEYS[GROUP_INDEX] || GROUP_KEYS[0];
  return Array.isArray(data[key]) ? data[key] : [];
}

// modal
function showModal(title, text, onOk){
  const overlay = document.createElement('div');
  overlay.id = 'explain-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.45);
    display:flex; align-items:center; justify-content:center; z-index:9999;
  `;
  const modal = document.createElement('div');
  modal.style.cssText = `
    max-width:640px; width:min(92vw,640px); background:#fff; color:#111;
    border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.25);
    padding:16px 18px; font-family:inherit;
  `;
  modal.innerHTML = `
    <h3 style="margin:0 0 8px 0;">${escapeHtml(title)}</h3>
    <p style="margin:0 0 16px 0; line-height:1.5;">${escapeHtml(text||'')}</p>
    <div style="display:flex; justify-content:flex-end;">
      <button id="explain-ok" class="btn" style="min-width:88px;">OK</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const ok = modal.querySelector('#explain-ok');

  function accept(){
    cleanup();
    if (typeof onOk==='function') onOk();
  }
  function cleanup(){
    document.removeEventListener('keydown', onKey, true);
    overlay.removeEventListener('click', onAnyClick, true);
    overlay.remove();
  }
  function onKey(e){
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape'){ e.preventDefault(); accept(); }
  }
  function onAnyClick(e){
    e.preventDefault(); // any click acts as OK (inside or outside)
    accept();
  }

  ok.addEventListener('click', accept);
  overlay.addEventListener('click', onAnyClick, true);
  document.addEventListener('keydown', onKey, true);
  setTimeout(()=>ok.focus(), 0);
}

// render pair
function render(){
  const root = document.getElementById('content');
  if (!root) return;

  const left = LIST[INDEX];
  const right = LIST[INDEX+1];

  if (!left && !right){
    // next group if available
    if (GROUP_INDEX < GROUP_KEYS.length - 1){
      GROUP_INDEX += 1;
      INDEX = 0;
      SCORE = 0;
      renderLoading();
      setTimeout(loadGroup, 0);
      return;
    }
    // done
    root.innerHTML = `
      <section class="card" style="padding:16px;">
        <h3>Done!</h3>
        <p>You answered ${SCORE} of ${LIST.length} correctly.</p>
        <div class="btn-row">
          <button class="btn js-restart">Restart Group</button>
        </div>
      </section>
    `;
    return;
  }

  function cardHTML(e, side){
    if (!e) return '';
    const to = Array.isArray(e.to) ? e.to.join(', ') : (e.to || '');
    const att = e.attachment ? `
      <div class="attach">
        <span class="paperclip"></span>
        <span class="pill ${String(e.attachment).toLowerCase().endsWith('.exe') ? 'warn' : ''}">${escapeHtml(e.attachment)}</span>
      </div>
    ` : '';
    return `
      <article class="card" data-side="${side}" data-correct="${escapeHtml(String(e.correct||'').toLowerCase())}">
        <h3>${escapeHtml(e.subject || '(no subject)')}</h3>
        <div class="email-meta">
          <div><strong>From:</strong> ${escapeHtml(e.from || '')}</div>
          <div><strong>To:</strong> ${escapeHtml(to)}</div>
        </div>
        ${att}
        <p class="desc">${escapeHtml(e.desc || e.body || '')}</p>
        <div class="btn-row">
          <button class="btn js-pick">Phish</button>
        </div>
      </article>
    `;
  }

  root.innerHTML = `
    <div class="grid">
      ${cardHTML(left, 'left')}
      ${cardHTML(right, 'right')}
    </div>
    <p class="progress" style="opacity:.7;margin-top:8px;">
      Pair ${Math.floor(INDEX/2)+1} of ${Math.ceil(LIST.length/2)}
    </p>
  `;
}

function renderLoading(){
  const root = document.getElementById('content');
  if (root) root.innerHTML = `<p>Loading…</p>`;
}

async function loadGroup(){
  const data = await loadData();
  initGroups(data);
  const key = GROUP_KEYS[GROUP_INDEX] || GROUP_KEYS[0];
  LIST = Array.isArray(data[key]) ? data[key] : [];
  INDEX = 0;
  render();
}

// actions
function pick(card){
  if (!card || LOCK) return;
  LOCK = true;

  const correct = (card.getAttribute('data-correct')||'').toLowerCase();
  const isRight = correct === 'phish';

  showToast(isRight, isRight ? 'Correct' : 'Incorrect');
  markCard(card, isRight);

  const idx = card.getAttribute('data-side') === 'right' ? INDEX+1 : INDEX;
  const email = LIST[idx] || {};
  const explanation = email.explain || email.explanation || '';

  showModal(isRight ? 'Correct' : 'Incorrect', explanation, () => {
    if (isRight) SCORE += 1;
    INDEX += 2;
    LOCK = false;
    render();
  });
}

function restart(){
  GROUP_INDEX = 0;
  INDEX = 0;
  SCORE = 0;
  renderLoading();
  loadGroup();
}

// events
document.addEventListener('click', (e)=>{
  const pickBtn = e.target.closest('.js-pick');
  if (pickBtn){
    e.preventDefault();
    const card = pickBtn.closest('.card');
    pick(card);
    return;
  }
  const restartBtn = e.target.closest('.js-restart');
  if (restartBtn){
    e.preventDefault();
    restart();
    return;
  }
});

// init
document.addEventListener('DOMContentLoaded', ()=>{
  renderLoading();
  loadGroup().catch(()=> {
    const root = document.getElementById('content');
    if (root) root.innerHTML = `<p style="color:#b91c1c;">Failed to load data.</p>`;
  });
});
