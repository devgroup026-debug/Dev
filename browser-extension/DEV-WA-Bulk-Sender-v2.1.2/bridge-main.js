// Page (MAIN world) bridge — WhatsApp ke andar se seedha message bhejta hai (WPP / wa-js)
(() => {
  // v2 = files[] (PDF/document) support. A v1 bridge (extension v2.0) left
  // in an already-open WhatsApp tab can't be unhooked (it kept no handle to
  // its listener), and registering alongside it would make BOTH answer -
  // i.e. double sends. So stay out of the way; content.js asks for
  // 'version', gets "unknown action" from the old bridge, and pauses the
  // job asking for a WhatsApp tab refresh instead of sending without the file.
  const BRIDGE_VERSION = 2;
  if (window.__devwaBridgeVersion >= BRIDGE_VERSION) return;
  if (window.__devwaBridge && !window.__devwaBridgeVersion) return;
  window.__devwaBridge = true;
  window.__devwaBridgeVersion = BRIDGE_VERSION;

  // files: [{ dataUrl, name, type }] — image ho to photo, baaki (PDF etc.) document
  async function send({ phone, text, images, files }) {
    const r = await WPP.contact.queryWidExists(phone + '@c.us');
    if (!r) return { ok: false, notOnWA: true, reason: 'Number WhatsApp par nahi hai' };
    const chatId = r.wid;
    const opts = { createChat: true, waitForAck: true };
    const list = (files && files.length)
      ? files
      : (images || []).map(dataUrl => ({ dataUrl, type: 'image/*' }));
    if (list.length) {
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const isImage = /^image\//i.test(f.type || '');
        const o = isImage
          ? { ...opts, type: 'image' }
          : { ...opts, type: 'document', filename: f.name || 'file', mimetype: f.type || 'application/octet-stream' };
        if (i === 0 && text) o.caption = text;
        await WPP.chat.sendFileMessage(chatId, f.dataUrl, o);
      }
    } else {
      await WPP.chat.sendTextMessage(chatId, text, opts);
    }
    return { ok: true };
  }

  window.addEventListener('message', async e => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.src !== 'devwa-req') return;
    let result;
    try {
      if (d.action === 'version') {
        result = { ok: true, version: BRIDGE_VERSION };
      } else if (d.action === 'ready') {
        result = { ok: true, ready: !!(window.WPP && WPP.isFullReady) };
      } else if (d.action === 'send') {
        result = await send(d.payload);
      } else {
        result = { ok: false, error: 'unknown action' };
      }
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err) };
    }
    window.postMessage({ src: 'devwa-res', id: d.id, result }, '*');
  });
})();
