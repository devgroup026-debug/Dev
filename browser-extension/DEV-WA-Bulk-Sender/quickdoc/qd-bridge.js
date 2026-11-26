// DEV WA Bulk Sender — Quick Doc: page (MAIN world) bridge
//
// Wahi WPP (wa-js) library use karta hai jo bulk sender ka bridge-main.js karta hai,
// lekin ALAG channel par (qd-req / qd-res) — taaki bridge-main.js ko chhedna na pade.
//
// Actions:
//   version / ready
//   activeChat                      -> { chat: { id, name, user, isGroup } | null }
//   sendDoc  { chatId | phone, dataUrl, name, mime, caption }
//   sendText { chatId | phone, text }
(() => {
  const V = 1;
  const prev = window.__qdBridge;
  if (prev && prev.v >= V) return;
  // Naya version: purana listener hatao, warna dono jawab denge (double send)
  if (prev && prev.fn) window.removeEventListener('message', prev.fn);

  const ready = () => !!(window.WPP && WPP.isFullReady);

  function chatInfo(c) {
    if (!c || !c.id) return null;
    const id = c.id._serialized || String(c.id);
    let name = c.formattedTitle || c.name || '';
    try { if (!name && c.contact) name = c.contact.formattedName || c.contact.pushname || ''; } catch (e) { /* ignore */ }
    const user = c.id.user || '';
    return { id, name: name || (user ? '+' + user : id), user, isGroup: !!c.isGroup || /@g\.us$/.test(id) };
  }

  // Bulk sender jaisa hi: phone diya ho to pehle check karo number WhatsApp par hai ya nahi
  async function target({ chatId, phone }) {
    if (chatId) return chatId;
    const r = await WPP.contact.queryWidExists(String(phone).replace(/\D/g, '') + '@c.us');
    if (!r) {
      const e = new Error('Number WhatsApp par nahi hai');
      e.notOnWA = true;
      throw e;
    }
    return r.wid;
  }

  async function handle(action, p) {
    if (action === 'version') return { ok: true, version: V };
    if (action === 'ready') return { ok: true, ready: ready() };
    if (!ready()) return { ok: false, notReady: true, error: 'WhatsApp abhi load ho raha hai' };

    if (action === 'activeChat') return { ok: true, chat: chatInfo(WPP.chat.getActiveChat()) };

    if (action === 'sendDoc') {
      const to = await target(p);
      const isImage = /^image\//i.test(p.mime || '');
      const o = isImage
        ? { createChat: true, waitForAck: true, type: 'image' }
        : { createChat: true, waitForAck: true, type: 'document', filename: p.name || 'document.pdf', mimetype: p.mime || 'application/pdf' };
      if (p.caption) o.caption = p.caption;
      await WPP.chat.sendFileMessage(to, p.dataUrl, o);
      return { ok: true };
    }

    if (action === 'sendText') {
      const to = await target(p);
      await WPP.chat.sendTextMessage(to, p.text, { createChat: true, waitForAck: true });
      return { ok: true };
    }
    return { ok: false, error: 'unknown action' };
  }

  async function onMessage(e) {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.src !== 'qd-req') return;
    let result;
    try {
      result = await handle(d.action, d.payload || {});
    } catch (err) {
      result = { ok: false, notOnWA: !!(err && err.notOnWA), error: String((err && err.message) || err) };
    }
    window.postMessage({ src: 'qd-res', id: d.id, result }, '*');
  }

  window.addEventListener('message', onMessage);
  window.__qdBridge = { v: V, fn: onMessage };
})();
