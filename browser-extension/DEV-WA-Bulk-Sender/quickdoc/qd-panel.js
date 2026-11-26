// DEV WA Bulk Sender — Quick Doc Sender: WhatsApp Web ke andar floating panel
//
// - Saved docs ke buttons (Alt+1…9), "Sending to: <chat>" header, Direct / Attach Only mode
// - Direct Send: pehle WPP API (bulk sender jaisa, quickdoc/qd-bridge.js), WPP ready na ho to DOM chain
// - Attach Only: hamesha DOM chain (quickdoc/qd-attach.js) — send aap khud dabate ho
// - Multi Send modal: kai docs × kai contacts, random delay, pause/resume/stop, report, retry
// UI Shadow DOM me hai: WhatsApp ka CSS hum par nahi, hamara CSS WhatsApp par nahi.
(() => {
  const TAG = '[QuickDoc]';
  const PANEL_W = 250;       // panel ki chaudai (css() isse skeleton banne se PEHLE padhta hai)
  const A = QD_ATTACH;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Ek hi instance (extension reload ke baad purana apne aap band) ----------
  const MYID = Math.random().toString(36).slice(2);
  document.documentElement.dataset.qdInst = MYID;
  const alive = () => document.documentElement.dataset.qdInst === MYID;
  const oldHost = document.getElementById('devwa-qd-root');
  if (oldHost) oldHost.remove();

  // ---------- chrome.* calls (extension reload ho gaya ho to saaf message) ----------
  let deadShown = false;
  async function safe(fn, fallback) {
    try { return await fn(); } catch (e) {
      if (/context invalidated/i.test(String((e && e.message) || e))) {
        if (!deadShown) { deadShown = true; toast('Extension reload hua hai — WhatsApp tab ek baar F5 karo', 'err', 9000); }
      } else console.error(TAG, e);
      return fallback;
    }
  }

  // ---------- Page bridge (MAIN world) ----------
  let seq = 0;
  const pending = new Map();
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.src === 'qd-res' && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
  });
  function bridge(action, payload = {}, timeout = 15000) {
    return new Promise(res => {
      const id = 'qd-' + MYID + '-' + (++seq);
      pending.set(id, res);
      window.postMessage({ src: 'qd-req', id, action, payload }, '*');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ ok: false, timeout: true, error: 'timeout' }); } }, timeout);
    });
  }
  async function wppReady() {
    const r = await bridge('ready', {}, 2000);
    return !!(r && r.ready);
  }

  // ---------- State ----------
  let docs = [];
  let settings = { ...QD.DEFAULTS };
  let ui = { x: null, y: null, collapsed: false };
  let todayCount = 0;
  let chat = null;           // jo panel par dikh raha hai
  let busy = false;          // ek waqt me ek hi send (double-click lock)
  let busyId = null;
  let multi = null;          // chalu Multi Send
  let modalView = null;      // 'setup' | 'progress' | null
  let dashContacts = [];     // bulk sender ki saved list (draft.contacts)

  // ---------- Shadow DOM skeleton ----------
  const host = document.createElement('div');
  host.id = 'devwa-qd-root';
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;display:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css()}</style>
    <div class="panel" id="panel">
      <div class="hdr" id="hdr" title="Drag karke kahin bhi rakho">
        <span class="grip">⠿</span>
        <span class="title">📄 Quick Docs</span>
        <span class="today" id="today" title="Aaj ke doc sends / daily limit"></span>
        <button class="icon" id="gear" title="Quick Docs settings">⚙</button>
        <button class="icon" id="collapse" title="Chhota / bada karo">–</button>
      </div>
      <div class="body" id="body">
        <div class="to" id="to"></div>
        <div class="seg" id="mode">
          <button data-mode="direct" title="Click = attach + caption + send">⚡ Direct Send</button>
          <button data-mode="attach" title="Click = attach + caption, send aap dabao">👁 Attach Only</button>
        </div>
        <div class="btns" id="btns"></div>
        <button class="multi" id="multiBtn">👥 Multi Send</button>
      </div>
    </div>
    <div class="toasts" id="toasts"></div>
    <div class="overlay" id="modal" hidden></div>`;
  const $ = id => root.getElementById(id);
  const panel = $('panel');

  // WhatsApp ke global keyboard shortcuts hamare inputs me type karte waqt na chale
  ['keydown', 'keyup', 'keypress', 'paste', 'input'].forEach(t =>
    host.addEventListener(t, e => e.stopPropagation()));

  function mount() {
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
  }

  // ---------- Toast ----------
  function toast(msg, kind = 'ok', ms = 4500) {
    const box = $('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---------- Position / collapse ----------
  function place(x, y) {
    const w = panel.offsetWidth || PANEL_W;
    const hdrH = $('hdr').offsetHeight || 34;
    x = Math.min(Math.max(4, x), window.innerWidth - w - 4);
    y = Math.min(Math.max(4, y), window.innerHeight - hdrH - 70);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    // Neeche ka message box / send button (≈70px) kabhi na dhake
    $('body').style.maxHeight = Math.max(110, window.innerHeight - y - hdrH - 80) + 'px';
    return { x, y };
  }
  function applyUi() {
    const x = ui.x == null ? window.innerWidth - PANEL_W - 16 : ui.x;
    const y = ui.y == null ? 72 : ui.y;
    place(x, y);
    panel.classList.toggle('collapsed', !!ui.collapsed);
    $('collapse').textContent = ui.collapsed ? '+' : '–';
  }
  function saveUi() { safe(() => chrome.storage.local.set({ [QD.K.ui]: ui })); }

  let drag = null;
  $('hdr').addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
    $('hdr').setPointerCapture(e.pointerId);
  });
  $('hdr').addEventListener('pointermove', e => {
    if (!drag) return;
    const p = place(e.clientX - drag.dx, e.clientY - drag.dy);
    ui.x = p.x; ui.y = p.y;
  });
  $('hdr').addEventListener('pointerup', () => { if (drag) { drag = null; saveUi(); } });
  window.addEventListener('resize', () => { if (alive()) applyUi(); });

  $('collapse').onclick = () => { ui.collapsed = !ui.collapsed; applyUi(); saveUi(); };
  $('gear').onclick = () => safe(() => chrome.runtime.sendMessage({ type: 'open-page', path: 'quickdoc/settings.html' }));

  // ---------- Render ----------
  function activeDocs() { return docs.filter(d => d.active); }

  function renderAll() {
    host.style.display = settings.enabled ? '' : 'none';
    root.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === settings.mode));
    renderToday();
    renderChat();
    renderButtons();
    applyUi();
  }
  function renderToday() {
    const el = $('today');
    el.textContent = `${todayCount}/${settings.dailyLimit}`;
    el.classList.toggle('warn', todayCount >= settings.dailyLimit);
  }
  function renderChat() {
    const el = $('to');
    if (!chat) { el.innerHTML = '<span class="muted">⚠ Koi chat open nahi — buttons band hai</span>'; return; }
    const sub = chat.phone && !chat.name.replace(/\D/g, '').endsWith(chat.phone.slice(-10))
      ? `<small>+${esc(chat.phone)}</small>` : '';
    el.innerHTML = `Sending to: <b title="${esc(chat.name)}">${esc(chat.name)}</b>` +
      (chat.isGroup ? ' <span class="tag">Group</span>' : '') + sub;
  }
  function renderButtons() {
    const list = activeDocs();
    const box = $('btns');
    if (!list.length) {
      box.innerHTML = '<div class="empty">Koi active document nahi.<br><a href="#" id="addFirst">⚙ Settings me add karo</a></div>';
      const a = $('addFirst');
      if (a) a.onclick = e => { e.preventDefault(); $('gear').click(); };
    } else {
      box.innerHTML = list.map(d => {
        const c = QD.safeColor(d.color);
        return `<button class="doc${busyId === d.id ? ' busy' : ''}" data-id="${esc(d.id)}"
          style="--bg:${c};--fg:${QD.textColor(c)}"
          title="${esc(d.firm || d.label)} — ${esc(d.sendName || d.fileName)}">
          <span class="lbl">${esc(d.label)}</span>${d.shortcut ? `<kbd>Alt+${d.shortcut}</kbd>` : ''}</button>`;
      }).join('');
    }
    const off = !chat || busy;
    box.querySelectorAll('button.doc').forEach(b => { b.disabled = off; });
    const mb = $('multiBtn');
    mb.textContent = multi && !['done', 'stopped'].includes(multi.state)
      ? `👥 Multi Send — ${multi.i}/${multi.contacts.length}${multi.state === 'paused' ? ' (paused)' : '…'}`
      : '👥 Multi Send';
    mb.disabled = busy && !multi;
  }

  root.addEventListener('click', e => {
    const m = e.target.closest('#mode button');
    if (m) {
      settings.mode = m.dataset.mode;
      renderAll();
      safe(() => QD.saveSettings({ mode: settings.mode })); // last mode yaad rakho
      return;
    }
    const b = e.target.closest('button.doc');
    if (b && !b.disabled) runDoc(b.dataset.id);
  });

  // ---------- Kaunsi chat khuli hai ----------
  async function currentChat() {
    if (!A.isChatOpen()) return null;
    const domTitle = A.chatTitle();
    let api = null;
    const r = await bridge('activeChat', {}, 1500);
    if (r && r.ok && r.chat) api = r.chat;
    const name = domTitle || (api && api.name) || '';
    if (!name) return null;
    return {
      key: api ? api.id : 'dom:' + domTitle,
      id: api ? api.id : null,
      name,
      phone: api && !api.isGroup ? api.user : '',
      isGroup: !!(api && api.isGroup),
      domTitle
    };
  }

  let ticking = false;
  async function tick() {
    if (!alive()) { clearInterval(tickTimer); host.remove(); return; }
    if (ticking || !settings.enabled) return;
    ticking = true;
    try {
      mount();
      const c = await currentChat();
      const changed = (c && c.key + c.name) !== (chat && chat.key + chat.name);
      chat = c;
      if (changed) { renderChat(); renderButtons(); }
    } finally { ticking = false; }
  }
  const tickTimer = setInterval(tick, 800);

  async function bulkRunning() {
    const { job } = await safe(() => chrome.storage.local.get('job'), {});
    return !!(job && job.status === 'running');
  }

  // ---------- Ek document current chat me ----------
  async function runDoc(id) {
    if (!alive() || !settings.enabled) return;
    if (busy) return toast(multi ? 'Multi Send chal raha hai — pehle use pause/stop karo' : 'Ek document abhi ja raha hai…', 'warn');
    const doc = docs.find(d => d.id === id && d.active);
    if (!doc) return;

    busy = true; busyId = id; renderButtons();
    const mode = settings.mode;
    let target = null;
    let res = null;
    try {
      if (await bulkRunning()) { res = { ok: false, reason: 'Bulk sending chal rahi hai — pehle Dashboard se Pause karo' }; return; }

      // Wrong-chat protection: jo naam panel par dikh raha tha, wahi chat abhi bhi khuli honi chahiye
      const shown = chat;
      target = await currentChat();
      if (!target) { res = { ok: false, reason: 'Pehle koi chat kholo' }; return; }
      if (!shown || shown.key !== target.key) {
        chat = target; renderChat();
        res = { ok: false, reason: `Chat badal gayi — ab "${target.name}" khuli hai. Naam check karke dobara click karo` };
        return;
      }

      todayCount = await safe(() => QD.getDailyCount(), todayCount);
      if (todayCount >= settings.dailyLimit &&
          !confirm(`Aaj ki Quick Docs limit (${settings.dailyLimit}) poori ho gayi hai.\nFir bhi "${doc.label}" ${target.name} ko bhejein?`)) {
        busy = false; busyId = null; renderButtons();
        return;
      }

      const f = await safe(() => QD.getFile(doc.id), null);
      if (!f || !f.data) { res = { ok: false, reason: `"${doc.label}" ki file nahi mili — Settings me dobara upload karo` }; return; }
      const name = doc.sendName || f.name || doc.fileName;
      const mime = f.mime || doc.mime || 'application/pdf';
      const caption = QD.fillCaption(doc.caption, { firm: doc.firm, contact_name: target.name });

      if (mode === 'direct' && target.id && await wppReady()) {
        // Wahi API jo bulk sender use karta hai. Chat id click ke time lock ho chuki hai,
        // isliye beech me chat badle tab bhi doc sahi chat me hi jayega.
        res = await bridge('sendDoc', { chatId: target.id, dataUrl: f.data, name, mime, caption }, 180000);
        // API ka error (timeout bhi) aaye to DOM se dobara NAHI bhejte — ho sakta hai pehla chala gaya ho (double send)
        if (!res.ok) res = { ok: false, reason: res.timeout ? 'WhatsApp se jawab nahi aaya (3 min) — chat me check karo' : 'Send fail: ' + res.error };
        else res.via = 'api';
      } else {
        const file = QD.dataUrlToFile(f.data, name, mime);
        res = await A.attachDocument(file, caption, { send: mode === 'direct', expectTitle: target.domTitle });
        res.via = 'dom';
      }
    } catch (e) {
      console.error(TAG, e);
      res = { ok: false, reason: String((e && e.message) || e) };
    } finally {
      if (res) {
        const who = target ? target.name : 'chat';
        if (res.ok) {
          const attachOnly = mode === 'attach';
          toast(attachOnly ? `📎 ${doc.label} attach ho gaya — caption check karke Send dabao` : `✅ ${doc.label} sent to ${who}`, 'ok');
          todayCount = await safe(() => QD.bumpDaily(1), todayCount + 1);
          await safe(() => QD.addLog({ name: who, phone: target && target.phone, label: doc.label, firm: doc.firm, mode: attachOnly ? 'Attach Only' : 'Direct', status: attachOnly ? 'Attached' : 'Sent', reason: res.via === 'dom' ? 'DOM: ' + (res.method || '') : '' }));
        } else {
          console.warn(TAG, doc.label, '→', who, ':', res.reason);
          toast(`❌ ${doc.label}: ${res.reason}`, 'err', 7000);
          if (target) await safe(() => QD.addLog({ name: who, phone: target.phone, label: doc.label, firm: doc.firm, mode: mode === 'attach' ? 'Attach Only' : 'Direct', status: 'Failed', reason: res.reason }));
        }
      }
      busy = false; busyId = null;
      renderToday(); renderButtons();
    }
  }

  // ---------- Keyboard: Alt+1 … Alt+9 ----------
  function onKey(e) {
    if (!alive()) { document.removeEventListener('keydown', onKey, true); return; }
    if (!settings.enabled || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    if (!m) return;
    const doc = activeDocs().find(d => String(d.shortcut) === m[1]);
    if (!doc) return;
    e.preventDefault();
    e.stopPropagation();
    if (!chat) return toast('Pehle koi chat kholo', 'err');
    runDoc(doc.id);
  }
  document.addEventListener('keydown', onKey, true);

  // =====================================================================
  // Multi Send
  // =====================================================================
  const modal = $('modal');
  function closeModal() { modal.hidden = true; modalView = null; }
  $('multiBtn').onclick = async () => {
    // Chalu / pichhla Multi Send ho to uski progress/report dikhao (wahan se "Naya Multi Send")
    if (multi) return renderProgress(true);
    await openSetup();
  };

  async function openSetup(preset) {
    const { draft } = await safe(() => chrome.storage.local.get('draft'), {});
    dashContacts = ((draft && draft.contacts) || []).filter(c => c && c.phone);
    const list = activeDocs();
    const pre = preset || {};
    const preDocs = new Set(pre.docIds || []);
    modalView = 'setup';
    modal.hidden = false;
    modal.innerHTML = `<div class="modal">
      <div class="mh"><b>👥 Multi Send</b><button class="icon" data-act="close" title="Band karo">✕</button></div>
      <div class="mb">
        <h4>1. Documents</h4>
        <div class="checks">${list.length ? list.map(d => `<label><input type="checkbox" name="doc" value="${esc(d.id)}" ${preDocs.has(d.id) ? 'checked' : ''}>
          <span class="dot" style="background:${QD.safeColor(d.color)}"></span>${esc(d.label)} <small>${esc(d.firm)}</small></label>`).join('')
          : '<div class="muted">Koi active document nahi — pehle Settings me add karo.</div>'}</div>

        <h4>2. Contacts</h4>
        <div class="sub">
          <span>Dashboard ki saved list (${dashContacts.length})</span>
          <input type="search" id="mcSearch" placeholder="Naam / number search…">
          <label class="all"><input type="checkbox" id="mcAll"> Sab dikhne wale</label>
        </div>
        <div class="clist" id="mcList">${dashContacts.length ? dashContacts.map((c, i) =>
          `<label data-q="${esc((c.name + ' ' + c.phone).toLowerCase())}"><input type="checkbox" name="ct" value="${i}"> ${esc(c.name || '—')} <small>+${esc(c.phone)}</small></label>`).join('')
          : '<div class="muted">Dashboard me koi contact list load nahi hai.</div>'}</div>
        <textarea id="mcPaste" rows="3" placeholder="Ya numbers paste karo — har line ek:\n9876543210\n9898989898, Ramesh Bhai">${esc(pre.paste || '')}</textarea>
        <div class="muted" id="mcCount"></div>

        <h4>3. Extra message <small>(optional, docs ke baad alag message)</small></h4>
        <textarea id="mcMsg" rows="2" placeholder="{contact_name}, {date} use kar sakte ho">${esc(pre.extra || '')}</textarea>

        <div class="row">
          <label>Delay min (sec) <input type="number" id="mcMin" min="3" value="${settings.delayMin}"></label>
          <label>Delay max (sec) <input type="number" id="mcMax" min="3" value="${settings.delayMax}"></label>
          <span class="muted">Aaj: ${todayCount}/${settings.dailyLimit} doc sends</span>
        </div>
      </div>
      <div class="mf"><button data-act="close">Cancel</button><button class="primary" data-act="start">▶ Start</button></div>
    </div>`;

    const listEl = $('mcList');
    const count = () => {
      const picked = collectContacts();
      $('mcCount').textContent = `${picked.list.length} contacts select` + (picked.bad ? ` · ${picked.bad} invalid line skip` : '');
    };
    $('mcSearch').oninput = () => {
      const q = $('mcSearch').value.trim().toLowerCase();
      listEl.querySelectorAll('label[data-q]').forEach(l => { l.style.display = !q || l.dataset.q.includes(q) ? '' : 'none'; });
    };
    $('mcAll').onchange = () => {
      listEl.querySelectorAll('label[data-q]').forEach(l => {
        if (l.style.display !== 'none') l.querySelector('input').checked = $('mcAll').checked;
      });
      count();
    };
    listEl.onchange = count;
    $('mcPaste').oninput = count;
    count();
  }

  // Dashboard list + paste kiye numbers (10 digit -> +91), duplicate hatao
  function collectContacts() {
    const seen = new Set();
    const list = [];
    let bad = 0;
    root.querySelectorAll('#mcList input[name=ct]:checked').forEach(i => {
      const c = dashContacts[+i.value];
      const phone = c && QD.normPhone(c.phone);
      if (phone && !seen.has(phone)) { seen.add(phone); list.push({ phone, name: c.name || '' }); }
    });
    const paste = $('mcPaste') ? $('mcPaste').value : '';
    paste.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
      const [num, ...rest] = l.split(/\t|,/);
      const phone = QD.normPhone(num);
      if (!phone) { bad++; return; }
      if (!seen.has(phone)) { seen.add(phone); list.push({ phone, name: rest.join(',').trim() }); }
    });
    return { list, bad };
  }

  modal.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (!act) { if (e.target === modal && modalView === 'setup') closeModal(); return; }
    const a = act.dataset.act;
    if (a === 'close') closeModal();
    else if (a === 'start') startMulti();
    else if (a === 'pause' && multi) { multi.state = 'paused'; renderProgress(); }
    else if (a === 'resume' && multi) { multi.state = 'running'; renderProgress(); }
    else if (a === 'stop' && multi && confirm('Multi Send stop karein? Baaki contacts ko nahi jayega.')) { multi.state = 'stopped'; renderProgress(); }
    else if (a === 'retry') retryFailed();
    else if (a === 'new') { multi = null; openSetup(); }
  });

  async function startMulti(preset) {
    if (busy) return toast('Pehle chal raha send khatam hone do', 'warn');
    let docIds, contacts, extra, dmin, dmax;
    if (preset) {
      ({ docIds, contacts, extra, dmin, dmax } = preset);
    } else {
      docIds = [...root.querySelectorAll('#modal input[name=doc]:checked')].map(i => i.value);
      contacts = collectContacts().list;
      extra = $('mcMsg').value.trim();
      dmin = Math.max(3, +$('mcMin').value || QD.DEFAULTS.delayMin);
      dmax = Math.max(dmin, +$('mcMax').value || QD.DEFAULTS.delayMax);
      if (!docIds.length) return toast('Kam se kam ek document select karo', 'err');
      if (!contacts.length) return toast('Kam se kam ek contact select / paste karo', 'err');
      settings = await safe(() => QD.saveSettings({ delayMin: dmin, delayMax: dmax }), settings);
    }
    const mdocs = docIds.map(id => docs.find(d => d.id === id)).filter(Boolean);
    if (!mdocs.length) return toast('Selected documents ab nahi mile', 'err');
    if (await bulkRunning()) return toast('Bulk sending chal rahi hai — pehle Dashboard se Pause karo', 'err');

    todayCount = await safe(() => QD.getDailyCount(), todayCount);
    const planned = contacts.length * mdocs.length;
    const left = settings.dailyLimit - todayCount;
    if (planned > left && !confirm(`Daily limit: aaj ${todayCount}/${settings.dailyLimit} ho chuke hai, ${Math.max(0, left)} aur bhej sakte ho.\n` +
        `Is Multi Send me ${planned} doc sends hai — limit aate hi ruk jayega (baaki "Skipped").\n\nStart karein?`)) return;
    if (!preset && !confirm(`${contacts.length} contacts × ${mdocs.length} document(s) bhejein?\nDelay ${dmin}–${dmax} sec`)) return;

    multi = { docs: mdocs, contacts, extra, dmin, dmax, i: 0, results: [], state: 'running', note: '', startedAt: Date.now() };
    renderProgress(true);
    runMulti();
  }

  function retryFailed() {
    if (!multi) return;
    const failed = multi.results.filter(r => !r.ok).map(r => ({ phone: r.phone, name: r.name }));
    if (!failed.length) return toast('Koi failed contact nahi', 'ok');
    startMulti({ docIds: multi.docs.map(d => d.id), contacts: failed, extra: multi.extra, dmin: multi.dmin, dmax: multi.dmax });
  }

  async function runMulti() {
    const m = multi;
    busy = true; renderButtons();
    try {
      while (m.i < m.contacts.length && alive()) {
        if (m.state === 'stopped') break;
        if (m.state === 'paused') { await sleep(400); continue; }
        if (await bulkRunning()) { m.state = 'paused'; m.note = 'Bulk sending chalu hui — wo khatam ho tab Resume karo'; renderProgress(); continue; }

        todayCount = await safe(() => QD.getDailyCount(), todayCount);
        if (todayCount + m.docs.length > settings.dailyLimit) {
          for (; m.i < m.contacts.length; m.i++) m.results.push({ ...m.contacts[m.i], ok: false, skipped: true, reason: `Skipped — daily limit (${settings.dailyLimit})` });
          toast(`⚠ Daily limit (${settings.dailyLimit}) poori — baaki skip`, 'warn', 8000);
          break;
        }

        const c = m.contacts[m.i];
        m.note = `Bhej rahe hai → ${c.name || '+' + c.phone}`;
        renderProgress();
        const r = await sendToContact(c, m);
        m.results.push({ ...c, ok: r.ok, reason: r.reason || '' });
        m.i++;
        renderProgress();

        // Agle contact se pehle random delay (pause/stop har second check)
        if (m.i < m.contacts.length) {
          let s = rand(m.dmin, m.dmax);
          while (s > 0 && m.state !== 'stopped' && alive()) {
            if (m.state === 'running') { m.note = `Agla ${s}s me…`; s--; }
            renderProgress();
            await sleep(1000);
          }
        }
      }
    } catch (e) {
      console.error(TAG, 'Multi Send error', e);
      m.note = 'Error: ' + ((e && e.message) || e);
    } finally {
      if (m.state !== 'stopped') m.state = 'done';
      m.note = '';
      busy = false;
      renderButtons(); renderToday();
      renderProgress(modalView === 'progress');
      const sent = m.results.filter(r => r.ok).length;
      toast(`👥 Multi Send ${m.state === 'stopped' ? 'stopped' : 'complete'}: ✅ ${sent}  ❌ ${m.results.length - sent}`, sent === m.results.length ? 'ok' : 'warn', 8000);
      safe(() => chrome.storage.local.set({ [QD.K.lastMulti]: {
        at: Date.now(), state: m.state, docs: m.docs.map(d => d.label),
        results: m.results, pending: m.contacts.slice(m.i)
      } }));
    }
  }

  // Ek contact ko saare selected docs (+ extra message)
  async function sendToContact(c, m) {
    const who = c.name || '+' + c.phone;
    for (let k = 0; k < m.docs.length; k++) {
      const d = m.docs[k];
      const f = await safe(() => QD.getFile(d.id), null);
      let r;
      if (!f || !f.data) r = { ok: false, reason: `"${d.label}" ki file nahi mili` };
      else {
        const caption = QD.fillCaption(d.caption, { firm: d.firm, contact_name: who });
        r = await sendDocToPhone(c.phone, d, f, caption);
      }
      await safe(() => QD.addLog({ name: who, phone: c.phone, label: d.label, firm: d.firm, mode: 'Multi', status: r.ok ? 'Sent' : 'Failed', reason: r.reason || '' }));
      if (!r.ok) return { ok: false, reason: `${d.label}: ${r.reason}` };
      todayCount = await safe(() => QD.bumpDaily(1), todayCount + 1);
      renderToday();
      if (k < m.docs.length - 1) await sleep(rand(1500, 3000));
    }
    if (m.extra) {
      await sleep(rand(1000, 2000));
      const text = QD.fillCaption(m.extra, { contact_name: who });
      let r = null;
      if (await wppReady()) {
        r = await bridge('sendText', { phone: c.phone, text }, 60000);
        if (!r.ok) r = { ok: false, reason: r.error };
      } else r = await A.sendText(text); // DOM: chat pehle doc ke time khul chuki hai
      if (!r.ok) return { ok: false, reason: 'Docs gaye, extra message fail: ' + r.reason };
    }
    return { ok: true };
  }

  // Bulk sender wala hi tarika: pehle WPP API (chat khole bina), warna
  // content.js ka openChatInPlace (bina reload chat kholna) + DOM attach
  async function sendDocToPhone(phone, d, f, caption) {
    const name = d.sendName || f.name || d.fileName;
    const mime = f.mime || d.mime || 'application/pdf';
    if (await wppReady()) {
      const r = await bridge('sendDoc', { phone, dataUrl: f.data, name, mime, caption }, 180000);
      if (r.ok) return { ok: true };
      if (r.notOnWA) return { ok: false, reason: r.error };
      return { ok: false, reason: r.timeout ? 'WhatsApp se jawab nahi aaya — chat me check karo' : r.error };
    }
    const dom = window.__devwaDom;
    if (!dom || !dom.openChatInPlace) return { ok: false, reason: 'WhatsApp abhi ready nahi — tab ek baar F5 karo' };
    const opened = await dom.openChatInPlace({ images: [] }, { phone, files: [true], msg: '' });
    if (!opened) return { ok: false, reason: 'Chat open nahi hua' };
    const inv = dom.invalidDialog && dom.invalidDialog();
    if (inv) {
      const b = inv.querySelector('button,[role="button"]');
      if (b) b.click();
      return { ok: false, reason: 'Number WhatsApp par nahi hai / invalid' };
    }
    const file = QD.dataUrlToFile(f.data, name, mime);
    return A.attachDocument(file, caption, { send: true, expectTitle: A.chatTitle() });
  }

  function renderProgress(show) {
    const m = multi;
    if (!m) return;
    if (show) { modalView = 'progress'; modal.hidden = false; }
    renderButtons();
    if (modalView !== 'progress') return;
    const total = m.contacts.length;
    const sent = m.results.filter(r => r.ok).length;
    const failed = m.results.length - sent;
    const pct = total ? Math.round(m.i / total * 100) : 0;
    const label = { running: '🟢 Chal raha hai', paused: '🟠 Paused', stopped: '🔴 Stopped', done: '✅ Complete' }[m.state] || m.state;
    const finished = ['done', 'stopped'].includes(m.state) && !busy;
    const rows = m.results.slice().reverse().map(r =>
      `<tr><td>${esc(r.name || '—')}</td><td>+${esc(r.phone)}</td><td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? 'Sent' : (r.skipped ? 'Skipped' : 'Failed')}</td><td>${esc(r.reason)}</td></tr>`).join('');
    modal.innerHTML = `<div class="modal">
      <div class="mh"><b>👥 Multi Send</b> <span class="muted">${esc(m.docs.map(d => d.label).join(', '))}</span>
        <button class="icon" data-act="close" title="${finished ? 'Band karo' : 'Chhupao (kaam chalta rahega)'}">✕</button></div>
      <div class="mb">
        <div class="pinfo"><b>${sent}/${total} sent</b> · ❌ ${failed} · ${label}</div>
        <div class="bar"><div style="width:${pct}%"></div></div>
        <div class="muted note">${esc(m.note || (m.state === 'paused' ? 'Resume dabao' : ''))}</div>
        ${finished ? `<div class="report">Report: ✅ ${sent} sent · ❌ ${failed} failed${total - m.i ? ` · ⏳ ${total - m.i} nahi bheje` : ''}</div>` : ''}
        <div class="tbl"><table><thead><tr><th>Naam</th><th>Number</th><th>Status</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <div class="mf">${finished
        ? `<button data-act="new">➕ Naya Multi Send</button>${failed ? `<button class="primary" data-act="retry">🔁 Retry failed (${failed})</button>` : ''}<button data-act="close">Close</button>`
        : `${m.state === 'paused' ? '<button class="primary" data-act="resume">▶ Resume</button>' : '<button data-act="pause">⏸ Pause</button>'}<button class="danger" data-act="stop">⏹ Stop</button>`}</div>
    </div>`;
  }

  // ---------- Storage se load + live update ----------
  async function load() {
    const o = await safe(() => chrome.storage.local.get([QD.K.docs, QD.K.settings, QD.K.ui]), {});
    docs = o[QD.K.docs] || [];
    settings = { ...QD.DEFAULTS, ...(o[QD.K.settings] || {}) };
    ui = { ...ui, ...(o[QD.K.ui] || {}) };
    todayCount = await safe(() => QD.getDailyCount(), 0);
  }
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !alive()) return;
    if (changes[QD.K.docs] || changes[QD.K.settings]) { await load(); renderAll(); tick(); }
    else if (changes[QD.K.daily]) { todayCount = await safe(() => QD.getDailyCount(), todayCount); renderToday(); }
  });

  (async () => {
    await load();
    mount();
    renderAll();
    tick();
    console.log(TAG, 'Panel ready —', activeDocs().length, 'active docs');
  })();

  // ---------- Styles (Shadow DOM ke andar hi) ----------
  function css() {
    return `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    [hidden] { display: none !important; }
    .panel { position: fixed; width: ${PANEL_W}px; background: #fff; color: #111b21; border-radius: 12px;
      box-shadow: 0 6px 24px rgba(0,0,0,.22); border: 1px solid #d1d7db; overflow: hidden; font-size: 13px; }
    .hdr { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 8px; background: #075e54; color: #fff;
      cursor: move; user-select: none; touch-action: none; }
    .grip { opacity: .7; }
    .title { font-weight: 700; flex: 1; white-space: nowrap; }
    .today { font-size: 11px; background: rgba(255,255,255,.18); padding: 1px 6px; border-radius: 10px; }
    .today.warn { background: #e67e22; }
    button { font: inherit; cursor: pointer; }
    .icon { background: transparent; border: 0; color: inherit; width: 24px; height: 24px; border-radius: 6px; font-size: 14px; line-height: 1; }
    .icon:hover { background: rgba(255,255,255,.18); }
    .collapsed .body { display: none; }
    .body { padding: 8px; overflow: auto; }
    .to { background: #f0f2f5; border-radius: 8px; padding: 6px 8px; margin-bottom: 8px; line-height: 1.35; word-break: break-word; }
    .to b { color: #075e54; }
    .to small { display: block; color: #667781; }
    .tag { font-size: 10px; background: #d9fdd3; color: #075e54; padding: 0 5px; border-radius: 6px; }
    .muted { color: #667781; font-size: 12px; }
    .seg { display: flex; background: #f0f2f5; border-radius: 8px; padding: 2px; margin-bottom: 8px; }
    .seg button { flex: 1; border: 0; background: transparent; padding: 5px 4px; border-radius: 6px; font-size: 12px; color: #54656f; }
    .seg button.on { background: #fff; color: #075e54; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
    .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .doc { position: relative; border: 0; border-radius: 8px; padding: 9px 6px; background: var(--bg); color: var(--fg);
      font-weight: 700; font-size: 13px; text-align: center; min-height: 40px; box-shadow: 0 1px 2px rgba(0,0,0,.15); }
    .doc:hover:not(:disabled) { filter: brightness(1.08); }
    .doc:disabled { opacity: .45; cursor: not-allowed; }
    .doc .lbl { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .doc kbd { display: block; font: 10px system-ui; opacity: .8; margin-top: 1px; }
    .doc.busy { opacity: 1 !important; animation: pulse 1s infinite; }
    @keyframes pulse { 50% { filter: brightness(.8); } }
    .empty { grid-column: 1 / -1; text-align: center; color: #667781; padding: 8px 0; }
    .empty a { color: #075e54; }
    .multi { width: 100%; margin-top: 8px; border: 1px solid #d1d7db; background: #fff; border-radius: 8px; padding: 7px; font-weight: 600; color: #075e54; }
    .multi:hover:not(:disabled) { background: #f0f2f5; }
    .multi:disabled { opacity: .5; }

    .toasts { position: fixed; top: 46px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
    .toast { padding: 8px 14px; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; max-width: 460px;
      box-shadow: 0 2px 10px rgba(0,0,0,.25); background: #128c7e; animation: tin .2s ease-out; }
    .toast.err { background: #c0392b; } .toast.warn { background: #e67e22; }
    @keyframes tin { from { opacity: 0; transform: translateY(-6px); } }

    .overlay { position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(11,20,26,.45); display: flex; align-items: center; justify-content: center; }
    .modal { background: #fff; width: min(600px, 94vw); max-height: 90vh; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,.3); color: #111b21; font-size: 13px; }
    .mh { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #075e54; color: #fff; border-radius: 12px 12px 0 0; }
    .mh .muted { color: #cfe9e4; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mh b { white-space: nowrap; }
    .mh .icon { margin-left: auto; }
    .mb { padding: 10px 14px; overflow: auto; }
    .mb h4 { margin: 10px 0 6px; color: #075e54; font-size: 13px; }
    .mb h4 small { color: #667781; font-weight: 400; }
    .checks { display: flex; flex-wrap: wrap; gap: 6px 14px; }
    .checks label, .clist label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .checks small, .clist small { color: #667781; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .sub { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
    .sub input[type=search] { flex: 1; min-width: 140px; }
    .all { display: flex; gap: 4px; align-items: center; }
    .clist { max-height: 170px; overflow: auto; border: 1px solid #e9edef; border-radius: 8px; padding: 6px 8px; margin-bottom: 6px; display: grid; gap: 3px; }
    input[type=search], input[type=number], textarea { font: inherit; border: 1px solid #d1d7db; border-radius: 6px; padding: 6px 8px; color: #111b21; background: #fff; }
    textarea { width: 100%; resize: vertical; }
    .row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; margin-top: 10px; }
    .row label { display: flex; flex-direction: column; gap: 3px; font-weight: 600; font-size: 12px; }
    .row input { width: 100px; }
    .mf { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px; border-top: 1px solid #e9edef; }
    .mf button { border: 1px solid #d1d7db; background: #fff; border-radius: 8px; padding: 7px 14px; font-weight: 600; }
    .mf .primary { background: #25d366; border-color: #25d366; color: #fff; }
    .mf .danger { color: #c0392b; border-color: #e5a29a; }
    .pinfo { font-size: 15px; margin: 4px 0 8px; }
    .bar { height: 8px; background: #e9edef; border-radius: 4px; overflow: hidden; }
    .bar div { height: 100%; background: #25d366; transition: width .3s; }
    .note { margin: 6px 0; min-height: 16px; }
    .report { background: #f0f2f5; border-radius: 8px; padding: 8px 10px; font-weight: 600; margin: 6px 0; }
    .tbl { max-height: 260px; overflow: auto; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #f0f2f5; }
    th { position: sticky; top: 0; background: #f7f8fa; }
    td.ok { color: #15803d; font-weight: 600; } td.bad { color: #c0392b; font-weight: 600; }
    `;
  }
})();
