// DEV OMS <-> DEV WA Bulk Sender connector (content script on OMS pages)
//
// OMS page window.postMessage({ src: 'devwa-oms-req', id, action, payload })
// bhejta hai, yeh script background/storage se baat karke
// { src: 'devwa-oms-res', id, result } wapas post karta hai.
//
// Actions:
//   ping            -> { ok, version }
//   enqueue         -> payload.items = [{ phone, name, msg, files?, ref }]
//   results         -> { ok, results: { [ref]: { ref, status, reason, time } } }
//   ack             -> payload.refs = [ref, ...]  (synced results hatao)
(() => {
  if (window.__devwaOmsConnector) return;
  window.__devwaOmsConnector = true;

  const RES_PREFIX = 'omsres:';
  const origin = window.location.origin;
  const post = data => window.postMessage(data, origin);

  async function readResults() {
    const all = await chrome.storage.local.get(null);
    const results = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(RES_PREFIX) && v && v.ref) results[v.ref] = v;
    }
    return results;
  }

  async function handle(action, payload) {
    switch (action) {
      case 'ping':
        return { ok: true, version: chrome.runtime.getManifest().version };
      case 'enqueue':
        return await chrome.runtime.sendMessage({ type: 'oms-enqueue', items: (payload && payload.items) || [] });
      case 'results':
        return { ok: true, results: await readResults() };
      case 'ack': {
        const refs = (payload && payload.refs) || [];
        if (refs.length) await chrome.storage.local.remove(refs.map(r => RES_PREFIX + r));
        return { ok: true };
      }
      default:
        return { ok: false, error: 'unknown action: ' + action };
    }
  }

  window.addEventListener('message', async e => {
    if (e.source !== window || e.origin !== origin) return;
    const d = e.data;
    if (!d || d.src !== 'devwa-oms-req') return;
    let result;
    try {
      result = await handle(d.action, d.payload);
    } catch (err) {
      const msg = String((err && err.message) || err);
      result = {
        ok: false,
        error: /context invalidated/i.test(msg)
          ? 'Extension reload hua hai - OMS page ek baar refresh karo'
          : msg
      };
    }
    post({ src: 'devwa-oms-res', id: d.id, result });
  });

  // Naya result aaya -> OMS ko batao taaki turant sync ho
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some(k => k.startsWith(RES_PREFIX) && changes[k].newValue)) {
      post({ src: 'devwa-oms-event', type: 'results-changed' });
    }
  });
})();
