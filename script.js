// Simple quiz logic
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

document.querySelectorAll('.card').forEach(card=>{
  card.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-guess]');
    if(!btn) return;
    const guess = btn.getAttribute('data-guess');       // 'phish' | 'safe'
    const correct = card.getAttribute('data-correct');  // 'phish' | 'safe'
    const isCorrect = guess === correct;

    // Feedback messages
    let message = '';
    if(isCorrect){
      message = (guess === 'phish')
        ? 'Correct: Suspicious file type (double extension .pdf.exe).'
        : 'Correct: No immediate red flags in this message.';
    } else {
      message = (guess === 'phish')
        ? 'Not quite. This one looks routine; no obvious red flags.'
        : 'Careful! Double extension (.pdf.exe) is a classic malware trick.';
    }

    showToast(isCorrect, message);
    markCard(card, isCorrect);
  });
});

//........................
/* NEW: JSON-driven quiz flow (added at end; existing code unchanged) */
(() => {
  const DATA_URL = './emails.json';
  const DEFAULT_GROUP = 'email_group_1';

  let QZ_EMAILS_CACHE = null;
  let QZ_CURRENT_GROUP = null;
  let QZ_CURRENT_LIST = [];
  let QZ_INDEX = 0;
  let QZ_SCORE = 0;
  let QZ_ADVANCING = false;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function toastShow(ok, msg) {
    const toast = document.getElementById('toast');
    const dot = document.getElementById('toast-dot');
    const text = document.getElementById('toast-text');
    if (!toast) return;
    toast.classList.add('show');
    if (dot) dot.className = 'dot ' + (ok ? 'good' : 'bad');
    if (text) text.textContent = msg;
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 800);
  }

  function setActiveGroup(key) {
    $$('.js-group[aria-current]').forEach(a => a.removeAttribute('aria-current'));
    const el = $(`.js-group[data-group="${CSS.escape(key)}"]`);
    if (el) el.setAttribute('aria-current', 'page');
  }

  function disableAnswers(disabled) {
    $$('.js-answer').forEach(btn => {
      btn.disabled = !!disabled;
      btn.style.opacity = disabled ? '0.7' : '1';
      btn.style.pointerEvents = disabled ? 'none' : 'auto';
    });
  }

  function normalizeCorrect(v) {
    return String(v || '').toLowerCase().replace('phishing', 'phish');
  }

  async function loadEmails() {
    if (QZ_EMAILS_CACHE) return QZ_EMAILS_CACHE;
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load emails.json (${res.status})`);
    QZ_EMAILS_CACHE = await res.json();
    return QZ_EMAILS_CACHE;
  }

  function getGroup(data, key) {
    const list = data?.[key];
    return Array.isArray(list) ? list : [];
  }

  function renderCurrent() {
    const root = document.getElementById('content');
    if (!root) return;

    if (!QZ_CURRENT_LIST.length) {
      root.innerHTML = `<p>No emails in this group.</p>`;
      return;
    }

    if (QZ_INDEX >= QZ_CURRENT_LIST.length) {
      root.innerHTML = `
        <section class="card" style="padding:16px;">
          <h3>Done!</h3>
          <p>You answered ${QZ_SCORE} of ${QZ_CURRENT_LIST.length} correctly.</p>
          <div class="btn-row">
            <button class="btn js-restart">Restart Group</button>
          </div>
        </section>
      `;
      return;
    }

    const e = QZ_CURRENT_LIST[QZ_INDEX];
    const to = Array.isArray(e.to) ? e.to.join(', ') : (e.to || '');
    const attachment = e.attachment ? `
      <div class="attach">
        <span class="paperclip"></span>
        <span class="pill ${String(e.attachment).toLowerCase().endsWith('.exe') ? 'warn' : ''}">${escapeHtml(e.attachment)}</span>
      </div>
    ` : '';

    root.innerHTML = `
      <article class="card" data-correct="${escapeHtml(normalizeCorrect(e.correct))}">
        <h3>${escapeHtml(e.subject || '(no subject)')}</h3>
        <div class="email-meta">
          <div><strong>From:</strong> ${escapeHtml(e.from || '')}</div>
          <div><strong>To:</strong> ${escapeHtml(to)}</div>
        </div>
        ${attachment}
        <p class="desc">${escapeHtml(e.desc || e.body || '')}</p>

        <div class="btn-row">
          <button class="btn phish js-answer" data-choice="phish">Phish</button>
          <button class="btn safe js-answer" data-choice="safe">Safe</button>
        </div>

        <p class="progress" style="opacity:.7;margin-top:8px;">
          Question ${QZ_INDEX + 1} of ${QZ_CURRENT_LIST.length}
        </p>
      </article>
    `;

    disableAnswers(false);
  }

  function handleAnswer(choice) {
    if (QZ_ADVANCING) return;
    if (!QZ_CURRENT_LIST.length || QZ_INDEX >= QZ_CURRENT_LIST.length) return;

    const item = QZ_CURRENT_LIST[QZ_INDEX];
    const correct = normalizeCorrect(item?.correct);
    const isRight = choice === correct;

    if (isRight) QZ_SCORE += 1;
    toastShow(isRight, isRight ? 'Correct' : `Incorrect — it was ${correct.toUpperCase()}`);

    disableAnswers(true);
    QZ_ADVANCING = true;
    setTimeout(() => {
      QZ_INDEX += 1;
      QZ_ADVANCING = false;
      renderCurrent();
    }, 450);
  }

  function handleRestart() {
    QZ_SCORE = 0;
    QZ_INDEX = 0;
    renderCurrent();
  }

  async function go(groupKey) {
    setActiveGroup(groupKey);
    const root = document.getElementById('content');
    if (root) root.innerHTML = `<p>Loading…</p>`;

    try {
      const data = await loadEmails();
      QZ_CURRENT_GROUP = groupKey;
      QZ_CURRENT_LIST = getGroup(data, groupKey);
      QZ_INDEX = 0;
      QZ_SCORE = 0;

      renderCurrent();

      if (location.hash.replace('#', '') !== groupKey) {
        history.replaceState(null, '', `#${groupKey}`);
      }
    } catch (e) {
      if (root) root.innerHTML = `<p style="color:#b91c1c;">${escapeHtml(e.message || 'Failed to load data.')}</p>`;
    }
  }

  document.addEventListener('click', (e) => {
    const g = e.target.closest('.js-group');
    if (g) {
      e.preventDefault();
      go(g.dataset.group);
      return;
    }

    const a = e.target.closest('.js-answer');
    if (a) {
      e.preventDefault();
      handleAnswer((a.dataset.choice || '').toLowerCase());
      return;
    }

    const r = e.target.closest('.js-restart');
    if (r) {
      e.preventDefault();
      handleRestart();
      return;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const key = (location.hash || '').replace('#', '') || DEFAULT_GROUP;
    go(key);
  });
})();
//........................
