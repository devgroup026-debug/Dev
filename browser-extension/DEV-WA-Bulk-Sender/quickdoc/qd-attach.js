// DEV WA Bulk Sender — Quick Doc: WhatsApp DOM se document attach / send
//
// attachDocument(file, caption, { send }) — teen tarike, isi order me:
//   1. Clip/plus button -> attach menu ka document <input type="file"> -> DataTransfer + "change"
//      (Menu ka "Document" option CLICK nahi karte — usse Windows ka file-picker khul jata hai;
//       uski jagah wahi hidden input seedha set karte hai.)
//   2. Compose box par paste event (File ke saath) — bulk sender bhi yahi karta hai
//   3. Chat area par dragenter / dragover / drop
// Fir preview screen ka wait (MutationObserver, max 15s), caption, aur Direct mode me send + confirm.
// Kuch bhi fail ho to preview saaf band karte hai (aadha-attach state nahi chhodte).
// Selectors: quickdoc/selectors.js
var QD_ATTACH = (() => {
  const S = QD_SEL;
  const TAG = '[QuickDoc]';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sel = s => (Array.isArray(s) ? s.join(', ') : s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(sel(s)));
  const first = list => {
    for (const s of [].concat(list)) { const el = document.querySelector(s); if (el) return el; }
    return null;
  };
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0;
  const clickable = el => (el && el.closest('button,[role="button"]')) || el;
  const fail = reason => { console.warn(TAG, reason); return { ok: false, reason }; };

  // Polling wait (bulk sender jaisa)
  async function waitFor(fn, timeout = 10000, interval = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { const r = fn(); if (r) return r; } catch (e) { /* ignore */ }
      await sleep(interval);
    }
    return null;
  }

  // MutationObserver + timeout (aur backup me har 400ms check)
  function waitForDom(fn, timeout) {
    return new Promise(resolve => {
      const check = () => { try { return fn(); } catch (e) { return null; } };
      const now = check();
      if (now) return resolve(now);
      let done = false;
      const finish = r => {
        if (done) return;
        done = true;
        obs.disconnect(); clearInterval(iv); clearTimeout(to);
        resolve(r);
      };
      const obs = new MutationObserver(() => { const r = check(); if (r) finish(r); });
      obs.observe(document.body, { childList: true, subtree: true });
      const iv = setInterval(() => { const r = check(); if (r) finish(r); }, 400);
      const to = setTimeout(() => finish(null), timeout);
    });
  }

  // ---------- Page helpers ----------
  function composeBox() { return first(S.composeBox); }
  function isChatOpen() { return !!document.querySelector(S.chatHeader); }
  function chatTitle() {
    const h = document.querySelector(S.chatHeader);
    return h ? (h.innerText || '').split('\n')[0].trim() : '';
  }
  function outCount() { return $$(S.outgoingMsg).length; }
  function sendIcons() {
    const byIcon = $$(S.sendIcon);
    const byLabel = $$('[aria-label], [title]').filter(e =>
      S.sendLabel.test((e.getAttribute('aria-label') || e.getAttribute('title') || '').trim()));
    return [...new Set([...byIcon, ...byLabel])].filter(visible);
  }
  function closeIcons() { return $$(S.closeBtn).filter(visible).map(clickable); }

  function pasteInto(el, { text, files }) {
    el.focus();
    const dt = new DataTransfer();
    if (text) dt.setData('text/plain', text);
    if (files) files.forEach(f => dt.items.add(f));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }
  function pressKey(el, key, extra = {}) {
    if (!el) return;
    if (el.focus) el.focus();
    const o = { key, code: key, bubbles: true, cancelable: true, ...extra };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  }
  const pressEnter = el => pressKey(el, 'Enter', { keyCode: 13, which: 13 });
  const pressEscape = () => pressKey(document.activeElement || document.body, 'Escape', { keyCode: 27, which: 27 });

  // Failure par debug info
  function diag() {
    const icons = [...new Set($$('[data-icon]').filter(visible).map(e => e.getAttribute('data-icon')))];
    return ' [icons: ' + icons.slice(-12).join(', ') + ']';
  }

  // ---------- Preview screen ko "naye elements" se pehchano ----------
  let before = { editables: new Set(), sends: new Set(), closes: new Set() };
  function snapshot() {
    before = {
      editables: new Set($$(S.editable)),
      sends: new Set(sendIcons().flatMap(e => [e, clickable(e)])),
      closes: new Set(closeIcons())
    };
  }
  function newCaption() {
    return $$(S.editable).find(e => !before.editables.has(e) && !e.closest(S.sidePane) && visible(e)) || null;
  }
  function newSendBtn() {
    const el = sendIcons().find(e => !before.sends.has(e) && !before.sends.has(clickable(e)));
    return el ? clickable(el) : null;
  }
  function previewState() {
    const sb = newSendBtn();
    const cap = newCaption();
    return (sb || cap) ? { sb, cap } : null;
  }

  // ---------- Teen attach tarike ----------
  function docInput() {
    const inputs = $$(S.fileInput);
    const acc = i => (i.getAttribute('accept') || '').trim();
    return inputs.find(i => S.docInputAccept.test(acc(i))) ||
           inputs.find(i => !S.mediaInputAccept.test(acc(i))) || null;
  }

  async function viaInput(file) {
    const btn = first(S.attachBtn);
    if (!btn) { console.warn(TAG, 'Attach (clip/plus) button nahi mila'); return false; }
    clickable(btn).click();
    const input = await waitFor(docInput, 3000, 150);
    if (!input) { pressEscape(); console.warn(TAG, 'Document <input type=file> nahi mila'); return false; }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function viaPaste(file) {
    const cb = composeBox();
    if (!cb) return false;
    pasteInto(cb, { files: [file] });
    return true;
  }

  async function viaDrop(file) {
    const zone = first(S.dropZone);
    if (!zone) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    fire(zone, 'dragenter');
    fire(zone, 'dragover');
    await sleep(400); // WhatsApp apna drop overlay dikhata hai — drop us par girana hai
    const r = zone.getBoundingClientRect();
    let target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || zone;
    if (target.id === 'devwa-qd-root') target = zone;
    fire(target, 'dragenter');
    fire(target, 'dragover');
    fire(target, 'drop');
    return true;
  }

  // Line breaks bachake caption likho. Pehle paste (bulk sender wala tarika),
  // na chale to har line insertText + Shift+Enter.
  async function typeCaption(cap, text) {
    const filled = () => (cap.innerText || '').replace(/\s+/g, '').length > 0;
    pasteInto(cap, { text });
    await sleep(500);
    if (filled()) return true;
    cap.focus();
    text.split('\n').forEach((line, i) => {
      if (i) pressKey(cap, 'Enter', { keyCode: 13, which: 13, shiftKey: true });
      if (line) document.execCommand('insertText', false, line);
    });
    await sleep(400);
    return filled();
  }

  // Preview band karo (X button, warna Escape) + "Discard?" dialog
  async function closePreview(handles) {
    const open = () => (handles && handles.length ? handles.some(visible) : !!previewState());
    for (let k = 0; k < 3 && open(); k++) {
      const x = closeIcons().find(el => !before.closes.has(el));
      if (x) x.click(); else pressEscape();
      await sleep(500);
      const dlg = $$(S.dialog).find(visible);
      if (dlg) {
        const b = $$('button,[role="button"]', dlg).find(el => S.discardLabel.test((el.innerText || '').trim()));
        if (b) { b.click(); await sleep(400); }
      }
    }
    if (open()) console.warn(TAG, 'Preview band nahi hua — khud X dabao');
    return !open();
  }

  // ---------- Main ----------
  // opts.send        true = Direct Send (send dabao + confirm), false = Attach Only
  // opts.expectTitle chat ka naam jo click ke time tha — badla to kuch nahi bhejte
  async function attachDocument(file, caption, { send = false, expectTitle = null, timeoutMs = 15000 } = {}) {
    const t0 = Date.now();
    if (!isChatOpen() || !composeBox()) return fail('Koi chat open nahi hai (ya is chat me message nahi bhej sakte)');
    const title0 = chatTitle();
    if (expectTitle != null && expectTitle !== title0) return fail(`Chat badal gayi ("${title0}") — kuch nahi bheja`);

    const out0 = outCount();
    snapshot();

    let preview = null;
    let method = '';
    const chain = [['input', viaInput, 8000], ['paste', viaPaste, 3500], ['drop', viaDrop, 3500]];
    for (const [name, fn, wait] of chain) {
      const left = timeoutMs - (Date.now() - t0);
      if (left < 500) break;
      let started = false;
      try { started = await fn(file); } catch (e) { console.warn(TAG, name + ' error:', e); }
      if (!started) continue;
      preview = await waitForDom(previewState, Math.min(wait, left));
      if (preview) { method = name; break; }
      console.warn(TAG, `${name}: preview screen nahi aaya, agla tarika…`);
      pressEscape(); // khula attach menu band
      await sleep(300);
      preview = previewState(); // late aa gaya ho to
      if (preview) { method = name; break; }
    }
    if (!preview) {
      await closePreview(null);
      return fail('Document attach nahi hua (clip / paste / drop teeno fail)' + diag());
    }
    console.log(TAG, 'Preview khula via', method);
    await sleep(700);

    const cap = preview.cap || await waitFor(newCaption, 4000);
    let sb = preview.sb || null;
    const handles = () => [cap, sb].filter(Boolean);
    const abort = async reason => { await closePreview(handles()); return fail(reason); };

    if (caption) {
      if (!cap) return abort('Caption box nahi mila' + diag());
      if (!(await typeCaption(cap, caption))) return abort('Caption type nahi hua' + diag());
    }

    // Wrong-chat protection: preview ke beech chat badli to cancel
    const t = chatTitle();
    if (t && t !== title0) return abort(`Chat badal gayi ("${t}") — preview band, kuch nahi bheja`);

    if (!send) return { ok: true, method, attached: true };

    sb = newSendBtn() || await waitFor(newSendBtn, 5000);
    if (sb) sb.click();
    else if (cap) pressEnter(cap);
    else return abort('Send button nahi mila' + diag());

    const gone = () => handles().every(el => !visible(el));
    const sent = await waitFor(() => outCount() > out0 || gone(), 15000, 300);
    if (!sent) return abort('Send confirm nahi hua (15s)' + diag());
    // Chat me naya outgoing message aaye tak thoda ruko (confirm)
    await waitFor(() => outCount() > out0, 6000, 300);
    return { ok: true, method, sent: true, confirmed: outCount() > out0 };
  }

  // Multi Send ka "extra message" — DOM fallback (open chat me)
  async function sendText(text) {
    const cb = composeBox();
    if (!cb) return fail('Message box nahi mila');
    pasteInto(cb, { text });
    await sleep(600);
    if (!(cb.innerText || '').trim()) { cb.focus(); document.execCommand('insertText', false, text); await sleep(400); }
    const area = cb.closest('footer') || document.querySelector(S.main);
    const icon = sendIcons().find(e => area && area.contains(e));
    if (icon) clickable(icon).click(); else pressEnter(cb);
    const cleared = await waitFor(() => !((composeBox() || {}).innerText || '').trim(), 10000);
    return cleared ? { ok: true } : fail('Text message send nahi hua');
  }

  return { attachDocument, sendText, chatTitle, composeBox, isChatOpen, waitFor };
})();
