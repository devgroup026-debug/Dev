// DEV WA Bulk Sender — WhatsApp Web automation (content script)
(() => {
  // Har injection naya instance; purana (extension reload ke baad) apne aap ruk jayega
  const MYID = Math.random().toString(36).slice(2);
  window.__devwaInstance = MYID;
  const alive = () => window.__devwaInstance === MYID;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const getJob = async () => (await chrome.storage.local.get('job')).job;
  const setJob = job => chrome.storage.local.set({ job });
  // OMS item apni files (jaise DC PDF) laata hai; dashboard wale items job.images use karte hai
  const itemFiles = (job, item) => (Array.isArray(item.files) ? item.files : (job.images || []));

  async function waitFor(fn, timeout = 30000, interval = 300) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { const r = fn(); if (r) return r; } catch (e) { /* ignore */ }
      await sleep(interval);
    }
    return null;
  }

  // ---------- Overlay (WhatsApp page par status) ----------
  let box;
  function overlay(text, color = '#075e54') {
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:999999;padding:10px 14px;' +
        'border-radius:10px;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:320px';
      document.body.appendChild(box);
    }
    box.style.background = color;
    box.textContent = '📤 DEV Bulk: ' + text;
  }

  // ---------- WhatsApp DOM helpers (selectors badal sakte hai) ----------
  function composeBox() {
    return document.querySelector('footer div[contenteditable="true"]') ||
           document.querySelector('#main div[contenteditable="true"][data-tab="10"]');
  }
  function isLoggedOut() {
    return !!document.querySelector('canvas[aria-label*="Scan" i], div[data-ref] canvas');
  }
  function invalidDialog() {
    return $$('div[role="dialog"], [data-animate-modal-popup="true"]')
      .find(d => /invalid|isn.t on whatsapp|not on whatsapp/i.test(d.innerText || '')) || null;
  }
  function visible(el) { return el && el.getClientRects().length > 0; }
  const SEND_LABEL = /^(send|भेजें|भेजे|મોકલો|મોકલવું)$/i;
  function sendIcons() {
    const byIcon = $$('[data-icon*="send" i]');
    const byLabel = $$('[aria-label], [title]').filter(e =>
      SEND_LABEL.test((e.getAttribute('aria-label') || e.getAttribute('title') || '').trim()));
    return [...new Set([...byIcon, ...byLabel])].filter(visible);
  }
  const clickable = el => el.closest('button,[role="button"]') || el;

  // Compose box ke paas wala send button (text-only)
  function footerSendBtn() {
    const cb = composeBox();
    const area = cb && (cb.closest('footer') || cb.closest('#main'));
    const el = area && sendIcons().find(e => area.contains(e));
    return el ? clickable(el) : null;
  }

  // Media editor: paste se pehle ke elements ka snapshot, taaki sirf NAYE elements pakde
  let beforeEditables = new Set();
  let beforeSends = new Set();
  function snapshot() {
    beforeEditables = new Set($$('div[contenteditable="true"]'));
    beforeSends = new Set(sendIcons());
  }
  function editorCaption() {
    return $$('div[contenteditable="true"]')
      .find(e => !beforeEditables.has(e) && !e.closest('#side') && visible(e)) || null;
  }
  function editorSendBtn() {
    const el = sendIcons().find(e => !beforeSends.has(e) && !beforeSends.has(clickable(e)));
    return el ? clickable(el) : null;
  }
  function editorPreview() {
    return $$('img[src^="blob:"]').find(i => visible(i) && i.width > 80) || null;
  }

  function pressEnter(el) {
    el.focus();
    const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keypress', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  }

  // Failure par debug info (report me dikhega)
  function diag() {
    const icons = [...new Set($$('[data-icon]').filter(visible).map(e => e.getAttribute('data-icon')))];
    return ' [icons: ' + icons.slice(-12).join(', ') + ']';
  }

  function pasteInto(el, { text, files }) {
    el.focus();
    const dt = new DataTransfer();
    if (text) dt.setData('text/plain', text);
    if (files) files.forEach(f => dt.items.add(f));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }

  async function toFile(img) {
    const blob = await (await fetch(img.dataUrl)).blob();
    return new File([blob], img.name, { type: img.type || blob.type });
  }

  async function attachViaInput(files) {
    const btn = document.querySelector('#main [data-icon="plus"], #main [data-icon="plus-rounded"], #main [data-icon="clip"], #main [title="Attach"], footer [aria-label="Attach"]');
    if (btn) { clickable(btn).click(); await sleep(800); }
    const input = await waitFor(() => $$('input[type="file"]').find(i => /image/.test(i.accept || '')), 5000);
    if (!input) return false;
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ---------- Ek contact ko bhejna ----------
  async function processItem(job, item) {
    const state = await waitFor(() => {
      if (isLoggedOut()) return 'loggedout';
      if (invalidDialog()) return 'invalid';
      if (composeBox()) return 'ready';
      return null;
    }, 90000, 500);

    if (state === 'loggedout') return { loggedOut: true };
    if (state === 'invalid') {
      const d = invalidDialog();
      const b = d && d.querySelector('button,[role="button"]');
      if (b) b.click();
      return { ok: false, reason: 'Number WhatsApp par nahi hai / invalid' };
    }
    if (!state) return { ok: false, reason: 'Chat open nahi hua (timeout)' };

    await sleep(rand(500, 1000));

    if (itemFiles(job, item).length) {
      const files = await Promise.all(itemFiles(job, item).map(toFile));
      snapshot();
      pasteInto(composeBox(), { files });
      const editorOpen = () => editorSendBtn() || editorCaption();
      const outBefore = $$('#main .message-out').length;
      let ed = await waitFor(editorOpen, 10000);
      if (!ed) {
        snapshot();
        await attachViaInput(files);
        ed = await waitFor(editorOpen, 12000);
      }
      if (!ed) return { ok: false, reason: 'Image attach nahi hui' + diag() };
      await sleep(800);

      const cap = await waitFor(editorCaption, 5000);
      if (item.msg && cap) {
        pasteInto(cap, { text: item.msg });
        await sleep(700);
        if (!(cap.innerText || '').trim()) {
          cap.focus();
          document.execCommand('insertText', false, item.msg);
          await sleep(500);
        }
      }

      // 1) Send button click  2) na mile to caption me Enter
      const sb = await waitFor(editorSendBtn, 6000);
      if (sb) sb.click();
      else if (cap) pressEnter(cap);
      else return { ok: false, reason: 'Image send button nahi mila' + diag() };

      // Sent check: editor ke wahi elements gayab ho gaye YA chat me naya outgoing message aa gaya
      const watch = [cap, sb].filter(Boolean);
      const sent = () =>
        watch.every(el => !document.contains(el) || !visible(el)) ||
        $$('#main .message-out').length > outBefore;
      let closed = await waitFor(sent, 15000);
      if (!closed && cap && document.contains(cap) && visible(cap)) {
        pressEnter(cap);                       // ek baar aur try
        closed = await waitFor(sent, 15000);
      }
      if (!closed) return { ok: false, reason: 'Image editor band nahi hua (send fail)' + diag() };
    } else {
      const cb = composeBox();
      const filled = await waitFor(() => (composeBox()?.innerText || '').trim().length > 0, 8000);
      if (!filled) { pasteInto(cb, { text: item.msg }); await sleep(700); }
      const sb = await waitFor(footerSendBtn, 6000);
      if (sb) sb.click();
      else pressEnter(composeBox());
      const cleared = await waitFor(() => !(composeBox()?.innerText || '').trim(), 10000);
      if (!cleared) return { ok: false, reason: 'Message send nahi hua' + diag() };
    }

    // Pending (clock) icon jaane tak ruko, taaki upload beech me na kate
    await sleep(1200);
    await waitFor(() => !document.querySelector('#main [data-icon="msg-time"]'), 90000, 500);
    return { ok: true };
  }

  // ---------- Bina reload ke chat kholna ----------
  function chatTitle() {
    const h = document.querySelector('#main header');
    return h ? (h.innerText || '').split('\n')[0].trim() : '';
  }

  // WhatsApp ka apna link-handler use karke chat in-place khulta hai (page reload nahi)
  async function openChatInPlace(job, item) {
    const oldTitle = chatTitle();
    const text = (!itemFiles(job, item).length && item.msg) ? item.msg : '';
    const q = text ? '&text=' + encodeURIComponent(text) : '';
    const hrefs = [
      'https://api.whatsapp.com/send?phone=' + item.phone + q,
      'https://wa.me/' + item.phone + (text ? '?text=' + encodeURIComponent(text) : ''),
      'whatsapp://send?phone=' + item.phone + q
    ];
    for (const href of hrefs) {
      const a = document.createElement('a');
      a.href = href;
      a.style.display = 'none';
      // Browser ko page chhodne se roko — sirf WhatsApp ka handler chale
      const block = e => { if (e.target === a) e.preventDefault(); };
      window.addEventListener('click', block);
      (document.querySelector('#app') || document.body).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.removeEventListener('click', block), 0);

      const ok = await waitFor(() =>
        invalidDialog() ||
        (composeBox() && chatTitle() && chatTitle() !== oldTitle), 7000, 250);
      if (ok) { await sleep(400); return true; }
    }
    return false;
  }

  // ---------- Main loop (ek hi page me, koi reload nahi) ----------
  let busy = false;
  let myTabId = null;
  let apiDisabled = false;

  async function isMyTab(job) {
    if (myTabId == null) myTabId = (await chrome.runtime.sendMessage({ type: 'whoami' })).tabId;
    return job && job.waTabId === myTabId;
  }

  // Page bridge (bridge-main.js) se baat
  let reqSeq = 0;
  const pending = new Map();
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.src === 'devwa-res' && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
  });
  function bridge(action, payload, timeout = 120000) {
    return new Promise(res => {
      const id = MYID + '-' + (++reqSeq);
      pending.set(id, res);
      window.postMessage({ src: 'devwa-req', id, action, payload }, '*');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ ok: false, error: 'timeout' }); } }, timeout);
    });
  }

  async function apiReady(maxSec) {
    for (let i = 0; i < maxSec; i++) {
      const r = await bridge('ready', {}, 2000);
      if (r && r.ready) return true;
      if (isLoggedOut()) return false;
      await sleep(1000);
    }
    return false;
  }

  // Seedha send (chat khole bina). null = API kaam nahi kar raha, DOM fallback use karo
  // Page bridge ka version (2+ = PDF/document bhej sakta hai). Purane tab me
  // v2.0 ka bridge reh jata hai jo files ignore karke sirf text bhejta hai.
  let bridgeVersion = null;
  async function getBridgeVersion() {
    if (bridgeVersion === null) {
      const r = await bridge('version', {}, 3000);
      bridgeVersion = (r && r.ok && r.version) || 1;
    }
    return bridgeVersion;
  }

  async function sendViaApi(job, item) {
    if (apiDisabled) return null;
    if (!(await apiReady(60))) { apiDisabled = true; return null; }
    if (itemFiles(job, item).length && (await getBridgeVersion()) < 2) {
      return { needsRefresh: true };
    }
    const r = await bridge('send', {
      phone: item.phone,
      text: item.msg || '',
      files: itemFiles(job, item).map(f => ({ dataUrl: f.dataUrl, name: f.name, type: f.type }))
    });
    if (r && r.ok) return { ok: true };
    if (r && r.notOnWA) return { ok: false, reason: r.reason };
    console.warn('[DEV WA] API send fail, DOM fallback:', r && r.error);
    return null;
  }

  async function finishItem(item, res) {
    const store = await chrome.storage.local.get(['log', 'daily']);
    const log = store.log || [];
    let daily = store.daily || { date: DEVWA.today(), count: 0 };
    if (daily.date !== DEVWA.today()) daily = { date: DEVWA.today(), count: 0 };
    log.push({
      phone: item.phone, name: item.name || '',
      status: res.ok ? 'Sent' : 'Failed', reason: res.reason || '',
      time: new Date().toLocaleString('en-IN')
    });
    if (res.ok) daily.count++;
    const out = { log, daily };
    // OMS se aaya item: result alag key me, OMS page padh ke DB update karega
    if (item.ref) {
      out['omsres:' + item.ref] = {
        ref: item.ref, status: res.ok ? 'Sent' : 'Failed', reason: res.reason || '', time: Date.now()
      };
    }
    await chrome.storage.local.set(out);
    return daily;
  }

  async function sendOne(job, item) {
    let res = await sendViaApi(job, item);
    if (res) return res;
    if (isLoggedOut()) return { loggedOut: true };
    // Fallback: chat in-place kholke (reload nahi)
    overlay(`Chat khol rahe hai → ${item.name || item.phone}`);
    const opened = await openChatInPlace(job, item);
    if (!opened) return { ok: false, reason: 'Chat open nahi hua' + diag() };
    return processItem(job, item);
  }

  async function runLoop() {
    if (busy) return;
    busy = true;
    try {
      while (alive()) {
        let job = await getJob();
        if (!job || job.status !== 'running' || !(await isMyTab(job))) return;
        const item = job.items[job.index];

        job.stage = 'processing';
        await setJob(job);
        overlay(`Bhej rahe hai → ${item.name || item.phone} (${job.index + 1}/${job.items.length})`);
        const res = await sendOne(job, item);

        let fresh = await getJob();
        if (res.needsRefresh) {
          // Purana (v2.0) page bridge PDF nahi bhej sakta. Tab ko khud reload
          // NAHI karte (user ka WhatsApp beech me na hile) - bas pause, item
          // pending rehta hai; F5 ke baad Resume / OMS se dobara bhejo.
          Object.assign(fresh, {
            status: 'paused', stage: 'idle',
            pauseReason: 'WhatsApp tab purane extension code par hai — tab ko F5 se refresh karke Resume dabao'
          });
          await setJob(fresh);
          overlay('Paused: WhatsApp tab ek baar F5 se refresh karo', '#c0392b');
          return;
        }
        if (res.loggedOut) {
          Object.assign(fresh, { status: 'paused', stage: 'idle', pauseReason: 'WhatsApp logged out hai — QR scan karke Resume dabao' });
          await setJob(fresh);
          overlay('Paused: WhatsApp logged out', '#c0392b');
          return;
        }
        const daily = await finishItem(item, res);

        fresh.index++;
        if (fresh.index >= fresh.items.length) {
          Object.assign(fresh, { status: 'done', stage: 'idle' });
          await setJob(fresh);
          overlay('✅ Sab messages complete!', '#128c7e');
          return;
        }
        if (daily.count >= fresh.dailyLimit) {
          Object.assign(fresh, { status: 'paused', stage: 'idle', pauseReason: `Aaj ki daily limit (${fresh.dailyLimit}) poori — kal Resume karo` });
          await setJob(fresh);
          overlay('Paused: daily limit poori', '#e67e22');
          return;
        }
        if (fresh.status !== 'running') {
          fresh.stage = 'idle';
          await setJob(fresh);
          overlay(fresh.status === 'stopped' ? 'Stopped' : 'Paused', '#e67e22');
          return;
        }
        fresh.stage = 'waiting';
        await setJob(fresh);

        const d = rand(fresh.delayMin, fresh.delayMax);
        for (let s = d; s > 0; s--) {
          overlay(`${res.ok ? '✓ Sent' : '✗ Failed'} — agla ${s}s me (${fresh.index}/${fresh.items.length} done)`);
          await sleep(1000);
          const jj = await getJob();
          if (!alive() || !jj || jj.status !== 'running') {
            if (jj) { jj.stage = 'idle'; await setJob(jj); }
            overlay(jj && jj.status === 'stopped' ? 'Stopped' : 'Paused', '#e67e22');
            return;
          }
        }
      }
    } finally {
      busy = false;
    }
  }

  // Dashboard se Start/Resume
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!alive()) return;
    if (msg.type === 'devwa-run') {
      sendResponse({ ok: true });
      runLoop();
    }
  });

  // Page khud load/refresh hua aur kaam chalu tha -> continue
  setTimeout(async () => {
    for (let i = 0; i < 8; i++) {
      const job = await getJob();
      if (!job || job.status !== 'running') return;
      if (await isMyTab(job)) return runLoop();
      await sleep(700);
    }
  }, 1500);
})();
