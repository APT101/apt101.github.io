
(() => {
  if (window.__APTT_INIT__) return;
  window.__APTT_INIT__ = true;

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) => String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");

  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // subtle visual feedback on chosen card (no toast)
  const markCard = (el, ok) => {
    try {
      el.style.outline = `2px solid ${ok ? "#16a34a" : "#b91c1c"}`;
      el.style.outlineOffset = "3px";
      setTimeout(() => { el.style.outline = "none"; }, 2000);
    } catch {}
  };

  // modal: advances ONLY on OK
  function showModal(title, text, onOk){
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;";
    const modal = document.createElement("div");
    modal.style.cssText = "max-width:640px;width:min(92vw,640px);background:#fff;border-radius:14px;box-shadow:0 20px 30px rgba(0,0,0,.25);padding:16px 18px;font:inherit;color:#111;";
    modal.innerHTML = `
      <h3 style="margin:0 0 8px 0;">${escapeHtml(title)}</h3>
      <p style="margin:0 0 16px 0;line-height:1.5;white-space:pre-wrap;">${escapeHtml(text || "")}</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button id="aptt-ok" class="btn" style="min-width:88px">OK</button>
      </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const ok = modal.querySelector("#aptt-ok");
    let done = false;
    const accept = () => {
      if (done) return; done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (typeof onOk === "function") onOk();
    };
    const onKey = (e) => {
      if ((e.key === "Enter" || e.key === " ") && document.activeElement === ok) {
        e.preventDefault(); accept();
      }
    };
    ok.addEventListener("click", accept);
    document.addEventListener("keydown", onKey, true);
    setTimeout(() => ok.focus(), 0);
  }

  // data / game state
  const DATA_URL = "./emails.json";
  const ROUND_SIZE = 10;
  let ALL_PAIRS = [];
  let REMAINING = [];
  let ORDER = [];
  let INDEX = 0;
  let SCORE = 0;
  let LOCK = false;

  const preparePairs = (data) => {
    const keys = Object.keys(data)
      .filter(k => /^email_group_\d+$/.test(k))
      .sort((a, b) => Number(a.split("_").pop()) - Number(b.split("_").pop()));
    const out = [];
    for (const k of keys){
      const pair = data[k];
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [a, b] = pair;

      const okShape = (e) =>
        e && typeof e.subject === "string" &&
        typeof e.from === "string" &&
        (
          (Array.isArray(e.to) && e.to.length) ||
          (typeof e.to === "string" && e.to)
        ) &&
        (typeof e.desc === "string" || typeof e.body === "string") &&
        (e.correct === "phish" || e.correct === "safe");

      if (!okShape(a) || !okShape(b)) continue;

      const labels = [a.correct, b.correct].sort().join(",");
      if (labels !== "phish,safe") continue;

      out.push([a, b]);
    }
    return out;
  };

  const dealNextRound = () => {
    if (REMAINING.length === 0) REMAINING = shuffle([...ALL_PAIRS]);
    ORDER = REMAINING.splice(0, Math.min(ROUND_SIZE, REMAINING.length));
    INDEX = 0;
  };

  const attachmentHTML = (filename) => {
    if (!filename) return "";
    const warn = String(filename).toLowerCase().endsWith(".exe");
    return `
      <div class="attach">
        <span class="paperclip" aria-hidden="true">📎</span>
        <span class="pill ${warn ? "warn" : ""}">${escapeHtml(filename)}</span>
      </div>`;
  };

  const cardHTML = (email, side) => {
    const toText = Array.isArray(email.to) ? email.to.join(", ") : (email.to || "");
    const desc = email.desc || email.body || "";
    return `
      <article class="card" data-side="${side}" data-correct="${escapeHtml(String(email.correct || "").toLowerCase())}">
        <h3>${escapeHtml(email.subject || "(no subject)")}</h3>
        <div class="email-meta">
          <div><strong>From:</strong> ${escapeHtml(email.from || "")}</div>
          <div><strong>To:</strong> ${escapeHtml(toText)}</div>
        </div>
        ${attachmentHTML(email.attachment)}
        <p class="desc">${escapeHtml(desc)}</p>
        <div class="btn-row">
          <button class="btn js-pick">Phish</button>
        </div>
      </article>`;
  };

  const render = () => {
    const root = $("content");
    if (!root) return;

    if (INDEX >= ORDER.length) {
      root.innerHTML = `
        <section class="card" style="padding:16px;">
          <h3>Score</h3>
          <p>You scored ${SCORE} / ${ORDER.length}</p>
          <div class="btn-row"><button class="btn js-restart">Restart</button></div>
        </section>`;
      return;
    }

    const [left, right] = ORDER[INDEX];
    root.innerHTML = `
      <div class="grid">
        ${cardHTML(left, "left")}
        ${cardHTML(right, "right")}
      </div>
      <p class="progress" style="opacity:.7;margin-top:8px;">Pair ${INDEX + 1} of ${ORDER.length}</p>`;
  };

  const renderLoading = () => {
    const root = $("content");
    if (root) root.innerHTML = "<p>Loading…</p>";
  };

  const pick = (card) => {
    if (!card || LOCK) return;
    LOCK = true;

    const isPhish = (card.getAttribute("data-correct") || "").toLowerCase() === "phish";
    markCard(card, isPhish);

    let explainText = "";
    try {
      const descNode = card.querySelector(".desc");
      explainText = descNode ? descNode.textContent : "";
    } catch {}

    showModal(isPhish ? "Correct" : "Incorrect", explainText, () => {
      if (isPhish) SCORE += 1;
      INDEX += 1;
      LOCK = false;
      render();
    });
  };

  const restart = () => {
    SCORE = 0;
    LOCK = false;
    dealNextRound();
    render();
  };

  document.addEventListener("click", (e) => {
    const pickBtn = e.target.closest(".js-pick");
    if (pickBtn) {
      e.preventDefault(); e.stopPropagation();
      pick(pickBtn.closest(".card"));
      return;
    }
    const restartBtn = e.target.closest(".js-restart");
    if (restartBtn) {
      e.preventDefault(); e.stopPropagation();
      restart();
    }
  });

  document.addEventListener("DOMContentLoaded", async () => {
    renderLoading();
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch data");
      const data = await res.json();

      ALL_PAIRS = preparePairs(data);
      if (ALL_PAIRS.length === 0) throw new Error("No valid pairs found in emails.json");

      REMAINING = shuffle([...ALL_PAIRS]);
      dealNextRound();
      render();
    } catch (err) {
      const root = $("content");
      if (root) root.innerHTML = `<p style="color:#b91c1c;">Failed to load data. ${escapeHtml(err?.message || "")}</p>`;
    }
  });
})();
