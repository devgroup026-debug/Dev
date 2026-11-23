// DEV WA Bulk Sender — Dashboard
const $ = id => document.getElementById(id);
const store = {
  get: k => chrome.storage.local.get(k),
  set: o => chrome.storage.local.set(o)
};

let contacts = [];   // [{phone, name, vars}]
let headers = [];
let images = [];     // [{name, type, dataUrl}]
let skipped = 0;

// ---------- Helpers ----------
function normPhone(raw, cc) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) d = cc + d;
  else if (d.length === 11 && d.startsWith('0')) d = cc + d.slice(1);
  return d.length >= 11 && d.length <= 15 ? d : null;
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{([^}]+)\}/g, (m, k) => {
    const key = Object.keys(vars).find(h => h.toLowerCase() === k.trim().toLowerCase());
    return key !== undefined ? String(vars[key] ?? '').trim() : m;
  });
}

function setContacts(rows, hdrs) {
  const cc = $('cc').value.replace(/\D/g, '') || '91';
  const phoneKey = hdrs.find(h => /phone|mobile|number|contact|whatsapp|no\.?$/i.test(h)) || hdrs[0];
  const nameKey = hdrs.find(h => /name|naam/i.test(h));
  const seen = new Set();
  contacts = [];
  skipped = 0;
  for (const r of rows) {
    const phone = normPhone(r[phoneKey], cc);
    if (!phone || seen.has(phone)) { skipped++; continue; }
    seen.add(phone);
    contacts.push({ phone, name: nameKey ? String(r[nameKey] ?? '').trim() : '', vars: r });
  }
  headers = hdrs;
  showListInfo();
  renderPreview();
  saveDraft();
}

function showListInfo() {
  const el = $('listInfo');
  if (!contacts.length) { el.textContent = 'Koi valid number nahi mila.'; el.className = 'info err'; }
  else {
    el.textContent = `✔ ${contacts.length} contacts load hue` + (skipped ? ` (${skipped} invalid/duplicate skip)` : '');
    el.className = 'info';
  }
  $('placeholders').innerHTML = headers.length
    ? 'Placeholders: ' + headers.map(h => `<code>{${h}}</code>`).join(' ')
    : 'Placeholders: <code>{Name}</code>';
}

function renderPreview() {
  const tpl = $('msg').value;
  if (!contacts.length) { $('preview').textContent = tpl || '—'; return; }
  $('preview').textContent = fillTemplate(tpl, contacts[0].vars) || '—';
}

function renderThumbs() {
  const t = $('thumbs');
  t.innerHTML = '';
  images.forEach((img, i) => {
    const d = document.createElement('div');
    d.innerHTML = `<img src="${img.dataUrl}" title="${img.name}"><span>×</span>`;
    d.querySelector('span').onclick = () => { images.splice(i, 1); renderThumbs(); saveDraft(); };
    t.appendChild(d);
  });
}

async function saveDraft() {
  await store.set({
    draft: {
      contacts, headers, skipped, images,
      msg: $('msg').value, cc: $('cc').value,
      dmin: $('dmin').value, dmax: $('dmax').value, limit: $('limit').value
    }
  });
}

// ---------- Inputs ----------
$('file').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  const hdrs = rows.length ? Object.keys(rows[0]) : [];
  setContacts(rows, hdrs);
};

$('loadPaste').onclick = () => {
  const rows = $('paste').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(/\t|,/);
    return { Phone: parts[0], Name: (parts.slice(1).join(',') || '').trim() };
  });
  setContacts(rows, ['Phone', 'Name']);
};

$('msg').oninput = () => { renderPreview(); saveDraft(); };
['cc', 'dmin', 'dmax', 'limit'].forEach(id => $(id).onchange = saveDraft);

$('images').onchange = async e => {
  for (const f of e.target.files) {
    if (f.size > 8 * 1024 * 1024) { alert(`${f.name} 8MB se badi hai, skip.`); continue; }
    const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    images.push({ name: f.name, type: f.type, dataUrl });
  }
  e.target.value = '';
  renderThumbs();
  saveDraft();
};

// ---------- Controls ----------
function buildJob(list) {
  const dmin = Math.max(5, +$('dmin').value || 15);
  const dmax = Math.max(dmin, +$('dmax').value || 35);
  return {
    status: 'idle', stage: 'idle', pauseReason: '',
    items: list.map(c => ({ phone: c.phone, name: c.name, msg: fillTemplate($('msg').value, c.vars).trim() })),
    images, index: 0, delayMin: dmin, delayMax: dmax,
    dailyLimit: Math.max(1, +$('limit').value || 150),
    waTabId: null, createdAt: Date.now()
  };
}

$('start').onclick = async () => {
  const { job } = await store.get('job');
  if (job && (job.status === 'running')) return alert('Pehle chal raha kaam Pause/Stop karo.');
  if (!contacts.length) return alert('Pehle contact list load karo.');
  if (!$('msg').value.trim() && !images.length) return alert('Message ya image me se kuch to daalo.');
  if (!confirm(`${contacts.length} contacts ko bhejna start karein?\n(Purani report clear ho jayegi)`)) return;
  await store.set({ job: buildJob(contacts), log: [] });
  const r = await chrome.runtime.sendMessage({ type: 'start' });
  if (!r.ok) alert(r.error);
};

$('pause').onclick = async () => {
  const { job } = await store.get('job');
  if (!job || job.status !== 'running') return;
  job.status = 'paused'; job.pauseReason = 'Aapne pause kiya';
  await store.set({ job });
};

$('resume').onclick = async () => {
  const { job } = await store.get('job');
  if (!job || !['paused', 'stopped'].includes(job.status)) return alert('Resume karne ke liye koi paused list nahi.');
  if (job.stage === 'waiting' || job.stage === 'processing') {
    // Thoda ruko taaki WhatsApp tab apna current step band kare
    await new Promise(r => setTimeout(r, 1500));
  }
  const r = await chrome.runtime.sendMessage({ type: 'start' });
  if (!r.ok) alert(r.error);
};

$('stop').onclick = async () => {
  const { job } = await store.get('job');
  if (!job || job.status === 'done') return;
  if (!confirm('Stop karein? (Resume se baad me wahi se continue kar sakte ho)')) return;
  job.status = 'stopped'; job.pauseReason = 'Stopped';
  await store.set({ job });
};

$('retry').onclick = async () => {
  const { job, log = [] } = await store.get(['job', 'log']);
  if (job && job.status === 'running') return alert('Pehle Pause/Stop karo.');
  const latest = new Map();
  log.forEach(l => latest.set(l.phone, l.status));
  const failedPhones = [...latest].filter(([, s]) => s === 'Failed').map(([p]) => p);
  if (!failedPhones.length) return alert('Koi failed number nahi.');
  const items = (job?.items || []).filter(i => failedPhones.includes(i.phone));
  if (!confirm(`${items.length} failed numbers ko dobara bhejein?`)) return;
  const newJob = { ...job, items, index: 0, status: 'idle', stage: 'idle', pauseReason: '' };
  await store.set({ job: newJob });
  const r = await chrome.runtime.sendMessage({ type: 'start' });
  if (!r.ok) alert(r.error);
};

$('export').onclick = async () => {
  const { log = [] } = await store.get('log');
  if (!log.length) return alert('Report khali hai.');
  const ws = XLSX.utils.json_to_sheet(log.map((l, i) => ({
    '#': i + 1, Phone: l.phone, Name: l.name, Status: l.status, Reason: l.reason, Time: l.time
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, `WA_Report_${DEVWA.today()}.xlsx`);
};

// ---------- Live status ----------
async function refresh() {
  const { job, log = [], daily } = await store.get(['job', 'log', 'daily']);
  const sent = log.filter(l => l.status === 'Sent').length;
  const fail = log.filter(l => l.status === 'Failed').length;
  const total = job?.items?.length || 0;
  const done = job?.index || 0;
  $('sSent').textContent = sent;
  $('sFail').textContent = fail;
  $('sPend').textContent = Math.max(0, total - done);
  $('sToday').textContent = daily && daily.date === DEVWA.today() ? daily.count : 0;
  $('bar').style.width = total ? (done / total * 100) + '%' : '0';

  const labels = { idle: 'Idle', running: '🟢 Chal raha hai…', paused: '🟠 Paused', stopped: '🔴 Stopped', done: '✅ Complete' };
  let s = labels[job?.status || 'idle'] || job?.status;
  if (job?.pauseReason && job.status !== 'running') s += ' — ' + job.pauseReason;
  if (total) s += `  (${done}/${total})`;
  $('status').textContent = s;

  const running = job?.status === 'running';
  $('start').disabled = running;
  $('pause').disabled = !running;
  $('resume').disabled = !job || !['paused', 'stopped'].includes(job.status);
  $('stop').disabled = !job || ['done', 'stopped', 'idle'].includes(job.status);

  $('log').innerHTML = log.slice().reverse().map((l, i) =>
    `<tr><td>${log.length - i}</td><td>${l.phone}</td><td>${escapeHtml(l.name)}</td>` +
    `<td class="${l.status}">${l.status}</td><td>${escapeHtml(l.reason)}</td><td>${l.time}</td></tr>`
  ).join('');
}
const escapeHtml = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

chrome.storage.onChanged.addListener(refresh);

// ---------- Init (draft wapas load) ----------
(async () => {
  const { draft } = await store.get('draft');
  if (draft) {
    contacts = draft.contacts || []; headers = draft.headers || []; skipped = draft.skipped || 0;
    images = draft.images || [];
    $('msg').value = draft.msg || '';
    $('cc').value = draft.cc || '91';
    $('dmin').value = draft.dmin || 25;
    $('dmax').value = draft.dmax || 60;
    $('limit').value = draft.limit || 150;
    if (contacts.length) showListInfo();
    renderThumbs();
    renderPreview();
  }
  refresh();
})();
