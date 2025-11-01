if (!window.__APTT_INIT__) {
  window.__APTT_INIT__ = true;

  const $ = (id) => document.getElementById(id);
  const toast = $('toast'), toastDot = $('toast-dot'), toastText = $('toast-text');
  const DATA_URL = './emails.json', ROUND_SIZE = 10;
  let ALL_PAIRS = [], ORDER = [], INDEX = 0, SCORE = 0, LOCK = false, hideTimer = null;

  const showToast = (ok, msg) => {
    toast.classList.add('show');
    toastDot.className = 'dot ' + (ok ? 'good' : 'bad');
    toastText.textContent = msg;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => toast.classList.remove('show'), 6000);
  };

  const markCard = (el, ok) => {
    el.style.outline = '2px solid ' + (ok ? '#16a34a' : '#b91c1c');
    el.style.outlineOffset = '3px';
    setTimeout(() => { el.style.outline = 'none'; }, 6000);
  };

  const escapeHtml = (s) => String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'","&#039;");

  const shuffle = (a) => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };

  const preparePairs = (data) => {
    const pairs = [];
    for (const k of Object.keys(data).filter(x => x.startsWith('email_group_')).sort()){
      const g = data[k]; if (!Array.isArray(g)) continue;
      for (let i=0; i+1<g.length; i+=2) pairs.push([g[i], g[i+1]]);
    }
    return pairs;
  };

  // Modal advances ONLY on OK (or Enter/Space on OK). No background dismissal. Guarded against double-fire.
  function showModal(title, text, onOk){
    const overlay = document.createElement('div');
    overlay.id = 'explain-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const modal = document.createElement('div');
    modal.style.cssText = 'max-width:640px;width:min(92vw,640px);background:#fff;color:#111;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:16px 18px;font-family:inherit;';
    modal.innerHTML = `
      <h3 style="margin:0 0 8px 0;">${escapeHtml(title)}</h3>
      <p style="margin:0 0 16px 0;line-height:1.5;">${escapeHtml(text||'')}</p>
      <div style="display:flex;justify-content:flex-end;">
        <button id="explain-ok" class="btn" style="min-width:88px;">OK</button>
      </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const ok = modal.querySelector('#explain-ok');
    let done = false;
    const accept = () => {
      if (done) return; done = true;
      document.removeEventListener('keydown', onKey, true);
      ok.removeEventListener('click', accept);
      overlay.remove();
      if (typeof onOk === 'function') onOk();
    };
    const onKey = (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === ok){ e.preventDefault(); accept(); }
    };

    ok.addEventListener('click', accept);
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => ok.focus(), 0);
  }

  const cardHTML = (e, side) => {
    const to = Array.isArray(e.to) ? e.to.join(', ') : (e.to || '');
    const att = e.attachment ? `
      <div class="attach">
        <span class="paperclip"></span>
        <span class="pill ${String(e.attachment).toLowerCase().endsWith('.exe') ? 'warn' : ''}">${escapeHtml(e.attachment)}</span>
      </div>` : '';
    return `
      <article class="card" data-side="${side}" data-correct="${escapeHtml(String(e.correct||'').toLowerCase())}">
        <h3>${escapeHtml(e.subject || '(no subject)')}</h3>
        <div class="email-meta">
          <div><strong>From:</strong> ${escapeHtml(e.from || '')}</div>
          <div><strong>To:</strong> ${escapeHtml(to)}</div>
        </div>
        ${att}
        <p class="desc">${escapeHtml(e.desc || e.body || '')}</p>
        <div class="btn-row"><button class="btn js-pick">Phish</button></div>
      </article>`;
  };

  const render = () => {
    const root = $('content'); if (!root) return;
    const TOTAL = ORDER.length;
    if (INDEX >= TOTAL){
      root.innerHTML = `
        <section class="card" style="padding:16px;">
          <h3>Score</h3>
          <p>You scored ${SCORE} / ${TOTAL}</p>
          <div class="btn-row"><button class="btn js-restart">Restart</button></div>
        </section>`;
      return;
    }
    const [left, right] = ORDER[INDEX];
    root.innerHTML = `
      <div class="grid">
        ${cardHTML(left, 'left')}
        ${cardHTML(right, 'right')}
      </div>
      <p class="progress" style="opacity:.7;margin-top:8px;">Pair ${INDEX + 1} of ${TOTAL}</p>`;
  };

  const renderLoading = () => { const root = $('content'); if (root) root.innerHTML = '<p>Loading…</p>'; };

  const pick = (card) => {
    if (!card || LOCK) return; LOCK = true;
    const isRight = (card.getAttribute('data-correct')||'').toLowerCase() === 'phish';
    showToast(isRight, isRight ? 'Correct' : 'Incorrect');
    markCard(card, isRight);
    const side = card.getAttribute('data-side') === 'right' ? 1 : 0;
    const email = ORDER[INDEX][side];
    const explanation = email.explain || email.explanation || '';
    showModal(isRight ? 'Correct' : 'Incorrect', explanation, () => {
      if (isRight) SCORE++;
      INDEX++; LOCK = false; render();
    });
  };

  const restart = () => { SCORE = 0; INDEX = 0; LOCK = false; ORDER = shuffle([...ALL_PAIRS]).slice(0, ROUND_SIZE); render(); };

  document.addEventListener('click', (e) => {
    const pickBtn = e.target.closest('.js-pick');
    if (pickBtn){ e.preventDefault(); e.stopPropagation(); pick(pickBtn.closest('.card')); return; }
    const restartBtn = e.target.closest('.js-restart');
    if (restartBtn){ e.preventDefault(); e.stopPropagation(); restart(); }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    renderLoading();
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw 0;
      const data = await res.json();
      ALL_PAIRS = preparePairs(data);
      ORDER = shuffle([...ALL_PAIRS]).slice(0, ROUND_SIZE);
      render();
    } catch {
      const root = $('content');
      if (root) root.innerHTML = '<p style="color:#b91c1c;">Failed to load data.</p>';
    }
  });
}
