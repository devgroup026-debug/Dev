importScripts('common.js');

// Icon click -> Dashboard kholo (agar pehle se khula hai to wahi)
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('dashboard.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'whoami') {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null });
    return;
  }
  if (msg.type === 'start') {
    startOrResume().then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }
  if (msg.type === 'oms-enqueue') {
    omsEnqueue(msg.items).then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }
});

// ---------- DEV OMS se aaye messages (oms-connector.js ke through) ----------
function normPhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  else if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
  return d.length >= 11 && d.length <= 15 ? d : null;
}

// Invalid number jaise turant-fail cases ka result seedha OMS ko
async function writeOmsResult(ref, status, reason) {
  await chrome.storage.local.set({
    ['omsres:' + ref]: { ref, status, reason: reason || '', time: Date.now() }
  });
}

async function omsEnqueue(rawItems) {
  const valid = [];
  const rejected = [];
  for (const i of rawItems || []) {
    const ref = i && i.ref ? String(i.ref) : '';
    const phone = normPhone(i && i.phone);
    if (!phone) {
      rejected.push(ref);
      if (ref) await writeOmsResult(ref, 'Failed', `Invalid WhatsApp number: ${i && i.phone}`);
      continue;
    }
    valid.push({
      phone,
      name: String(i.name || ''),
      msg: String(i.msg || '').trim(),
      // Hamesha array — taaki dashboard job ki images OMS message ke saath na chali jaaye
      files: Array.isArray(i.files) ? i.files : [],
      ref: ref || undefined,
      source: 'oms'
    });
  }

  const { job, draft } = await chrome.storage.local.get(['job', 'draft']);
  const active = job && job.items && job.index < job.items.length &&
    ['running', 'paused', 'stopped'].includes(job.status);

  // Same ref pehle se queue me baaki hai to dobara mat daalo (double-send se bachav)
  const pendingRefs = new Set(active ? job.items.slice(job.index).map(x => x.ref).filter(Boolean) : []);
  const fresh = valid.filter(x => !x.ref || !pendingRefs.has(x.ref));
  const duplicates = valid.length - fresh.length;

  if (!fresh.length) {
    return { ok: true, queued: 0, duplicates, rejected: rejected.length };
  }

  if (active) {
    job.items.push(...fresh);
    await chrome.storage.local.set({ job });
    if (job.status === 'running') {
      return { ok: true, queued: fresh.length, duplicates, rejected: rejected.length };
    }
  } else {
    const dmin = Math.max(5, +(draft && draft.dmin) || 20);
    const dmax = Math.max(dmin, +(draft && draft.dmax) || 45);
    await chrome.storage.local.set({
      job: {
        status: 'idle', stage: 'idle', pauseReason: '',
        items: fresh, images: [], index: 0,
        delayMin: dmin, delayMax: dmax,
        dailyLimit: Math.max(1, +(draft && draft.limit) || 150),
        waTabId: null, createdAt: Date.now(), source: 'oms'
      }
    });
  }

  const r = await startOrResume();
  return {
    ok: true, queued: fresh.length, duplicates, rejected: rejected.length,
    started: !!r.ok, warning: r.ok ? '' : r.error
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ping(tabId) {
  try { return await chrome.tabs.sendMessage(tabId, { type: 'devwa-run' }); }
  catch (e) { return null; }
}

// Extension reload/update ke baad WhatsApp tab me scripts dobara daalo — page refresh ke bina
async function inject(tabId) {
  const [{ result: hasWPP }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: () => !!window.WPP
  });
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    files: hasWPP ? ['bridge-main.js'] : ['wppconnect-wa.js', 'bridge-main.js']
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['common.js', 'content.js'] });
}

async function startOrResume() {
  const { job } = await chrome.storage.local.get('job');
  if (!job || !job.items || job.index >= job.items.length) return { ok: false, error: 'Koi pending item nahi' };

  job.status = 'running';
  job.stage = 'starting';
  job.pauseReason = '';

  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length) {
    const tab = tabs[0];
    job.waTabId = tab.id;
    await chrome.storage.local.set({ job });
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    let r = await ping(tab.id);
    if (!r) {
      try { await inject(tab.id); } catch (e) { /* ignore */ }
      await sleep(1500);
      r = await ping(tab.id);
    }
    if (!r || !r.ok) {
      const fresh = (await chrome.storage.local.get('job')).job;
      fresh.status = 'paused';
      fresh.pauseReason = 'WhatsApp tab se connect nahi hua — tab ek baar khud refresh karke Resume dabao';
      await chrome.storage.local.set({ job: fresh });
      return { ok: false, error: fresh.pauseReason };
    }
  } else {
    // WhatsApp khula hi nahi hai: ek baar normal kholo, load hote hi kaam shuru
    job.waTabId = null;
    await chrome.storage.local.set({ job });
    const tab = await chrome.tabs.create({ url: 'https://web.whatsapp.com/', active: true });
    const fresh = (await chrome.storage.local.get('job')).job;
    fresh.waTabId = tab.id;
    await chrome.storage.local.set({ job: fresh });
  }
  return { ok: true };
}
