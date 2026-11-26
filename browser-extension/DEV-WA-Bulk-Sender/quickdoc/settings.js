// DEV WA Bulk Sender — Quick Docs settings page (document library + send log)
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let docs = [];
let settings = { ...QD.DEFAULTS };
let editingId = null;      // null = naya doc
let pendingFile = null;    // { name, mime, size, data } — editor me naya chuna hua
let replaceId = null;

// ---------- Tabs ----------
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $('tab-docs').hidden = name !== 'docs';
  $('tab-log').hidden = name !== 'log';
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  if (name === 'log') renderLog();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
window.addEventListener('hashchange', () => showTab(location.hash === '#log' ? 'log' : 'docs'));

// ---------- File read + validation ----------
// Sirf PDF (aur JPG/PNG), max 10 MB. Windows kabhi PDF ka type khaali deta hai — extension se pehchano.
function fileMime(f) {
  if (f.type) return f.type;
  if (/\.pdf$/i.test(f.name)) return 'application/pdf';
  if (/\.jpe?g$/i.test(f.name)) return 'image/jpeg';
  if (/\.png$/i.test(f.name)) return 'image/png';
  return '';
}
async function readDocFile(f) {
  const mime = fileMime(f);
  if (!QD.ALLOWED.includes(mime)) throw new Error(`"${f.name}" allowed nahi — sirf PDF (ya JPG / PNG) chalega.`);
  if (f.size > QD.MAX_BYTES) throw new Error(`"${f.name}" ${QD.fmtSize(f.size)} ki hai — max 10 MB allowed hai. PDF compress karke dobara try karo.`);
  const raw = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('File padh nahi paaye'));
    r.readAsDataURL(f);
  });
  // dataUrl ka header sahi mime ke saath
  const data = 'data:' + mime + ';base64,' + String(raw).slice(String(raw).indexOf(',') + 1);
  return { name: f.name, mime, size: f.size, data };
}
function cleanName(name, fallbackExt) {
  let n = String(name || '').replace(/[\\/:*?"<>|]+/g, '_').trim();
  if (!n) return '';
  if (!/\.[a-z0-9]{2,4}$/i.test(n) && fallbackExt) n += fallbackExt;
  return n;
}
const extOf = name => (/\.[a-z0-9]{2,4}$/i.exec(name || '') || [''])[0];

// ---------- Doc list ----------
function renderDocs() {
  const box = $('docList');
  if (!docs.length) {
    box.innerHTML = '<div class="empty-docs">Abhi koi document nahi. <b>➕ Add document</b> dabao — jaise "SS Bank" + bank details PDF.</div>';
    return;
  }
  box.innerHTML = docs.map(d => {
    const c = QD.safeColor(d.color);
    return `<div class="doc${d.active ? '' : ' off'}" draggable="true" data-id="${esc(d.id)}">
      <span class="grip" title="Drag karke order badlo">⠿</span>
      <span class="chip" style="background:${c};color:${QD.textColor(c)}">${esc(d.label)}</span>
      <div class="meta"><b>${esc(d.firm || '—')}</b>
        <small>📄 ${esc(d.sendName || d.fileName)} · ${QD.fmtSize(d.size || 0)}${d.shortcut ? ` · ⌨ Alt+${d.shortcut}` : ''}</small></div>
      <label class="switch" title="Active / inactive"><input type="checkbox" data-act="active" ${d.active ? 'checked' : ''}><span></span></label>
      <div class="acts">
        <button data-act="preview" title="PDF dekho">👁 Preview</button>
        <button data-act="edit">✏ Edit</button>
        <button data-act="replace">📎 Replace PDF</button>
        <button data-act="delete" class="danger" title="Delete">🗑</button>
      </div>
    </div>`;
  }).join('');
}

$('docList').addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  const card = e.target.closest('.doc');
  if (!el || !card) return;
  const d = docs.find(x => x.id === card.dataset.id);
  if (!d) return;
  const act = el.dataset.act;
  if (act === 'edit') openEditor(d);
  else if (act === 'preview') previewDoc(d.id);
  else if (act === 'replace') { replaceId = d.id; $('replaceFile').click(); }
  else if (act === 'delete') {
    if (!confirm(`"${d.label}" (${d.firm || d.fileName}) delete karein?\nYeh wapas nahi aayega.`)) return;
    docs = docs.filter(x => x.id !== d.id);
    await QD.saveDocs(docs);
    await chrome.storage.local.remove(QD.FILE_PREFIX + d.id);
  }
});

// Active / inactive switch
$('docList').addEventListener('change', async e => {
  if (e.target.dataset.act !== 'active') return;
  const d = docs.find(x => x.id === e.target.closest('.doc').dataset.id);
  if (!d) return;
  d.active = e.target.checked;
  await QD.saveDocs(docs);
});

async function previewDoc(id) {
  const f = await QD.getFile(id);
  if (!f || !f.data) return alert('File nahi mili — Replace PDF se dobara upload karo.');
  const url = URL.createObjectURL(QD.dataUrlToBlob(f.data));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

$('replaceFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  const d = docs.find(x => x.id === replaceId);
  if (!f || !d) return;
  try {
    const fo = await readDocFile(f);
    // Send name purane file name jaisa hi tha to naye ke saath badlo, custom tha to rehne do
    if (!d.sendName || d.sendName === d.fileName) d.sendName = fo.name;
    else if (extOf(d.sendName).toLowerCase() !== extOf(fo.name).toLowerCase()) d.sendName = cleanName(d.sendName.replace(/\.[a-z0-9]{2,4}$/i, ''), extOf(fo.name));
    Object.assign(d, { fileName: fo.name, mime: fo.mime, size: fo.size, updatedAt: Date.now() });
    await chrome.storage.local.set({ [QD.K.docs]: docs, [QD.FILE_PREFIX + d.id]: fo });
    alert(`✅ "${d.label}" ki file badal di: ${fo.name}`);
  } catch (err) { alert(err.message); }
};

// ---------- Drag to reorder ----------
let dragId = null;
$('docList').addEventListener('dragstart', e => {
  const card = e.target.closest('.doc');
  if (!card) return;
  dragId = card.dataset.id;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
$('docList').addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('.doc').forEach(c => c.classList.remove('dragging', 'drag-over'));
});
$('docList').addEventListener('dragover', e => {
  const card = e.target.closest('.doc');
  if (!card || !dragId) return;
  e.preventDefault();
  document.querySelectorAll('.doc.drag-over').forEach(c => c !== card && c.classList.remove('drag-over'));
  card.classList.add('drag-over');
});
$('docList').addEventListener('drop', async e => {
  const card = e.target.closest('.doc');
  if (!card || !dragId || card.dataset.id === dragId) return;
  e.preventDefault();
  const from = docs.findIndex(d => d.id === dragId);
  const [moved] = docs.splice(from, 1);
  const to = docs.findIndex(d => d.id === card.dataset.id);
  const r = card.getBoundingClientRect();
  docs.splice(e.clientY > r.top + r.height / 2 ? to + 1 : to, 0, moved);
  await QD.saveDocs(docs);
});

// ---------- Add / Edit dialog ----------
function fillShortcutSelect(current) {
  const used = new Map(docs.filter(d => d.id !== editingId && d.shortcut).map(d => [String(d.shortcut), d.label]));
  $('shortcut').innerHTML = '<option value="">— None —</option>' +
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<option value="${n}">Alt+${n}${used.has(String(n)) ? ` (abhi: ${esc(used.get(String(n)))})` : ''}</option>`).join('');
  $('shortcut').value = current ? String(current) : '';
}
function firstFreeShortcut() {
  const used = new Set(docs.map(d => String(d.shortcut || '')));
  for (let n = 1; n <= 9; n++) if (!used.has(String(n))) return n;
  return '';
}
function renderFileInfo(meta) {
  $('fileInfo').textContent = meta ? `📄 ${meta.name} · ${QD.fmtSize(meta.size)}` : '';
}
function renderCapPreview() {
  $('capPreview').textContent = QD.fillCaption($('caption').value, { firm: $('firm').value.trim(), contact_name: 'Ramesh Bhai' }) || '—';
}

function openEditor(d) {
  editingId = d ? d.id : null;
  pendingFile = null;
  $('edTitle').textContent = d ? `Edit — ${d.label}` : 'Add document';
  $('label').value = d ? d.label : '';
  $('firm').value = d ? d.firm || '' : '';
  $('file').value = '';
  $('sendName').value = d ? d.sendName || d.fileName : '';
  $('caption').value = d ? d.caption || '' : '*{firm} – Bank Details*';
  $('color').value = QD.safeColor(d ? d.color : QD.COLORS[docs.length % QD.COLORS.length]);
  fillShortcutSelect(d ? d.shortcut : firstFreeShortcut());
  $('active').checked = d ? !!d.active : true;
  $('edErr').textContent = '';
  renderFileInfo(d ? { name: d.fileName, size: d.size } : null);
  renderCapPreview();
  $('editor').showModal();
  $('label').focus();
}

$('swatches').innerHTML = QD.COLORS.map(c => `<i style="background:${c}" data-c="${c}" title="${c}"></i>`).join('');
$('swatches').onclick = e => { const c = e.target.dataset.c; if (c) $('color').value = c; };
document.querySelectorAll('.var').forEach(b => b.onclick = () => {
  const ta = $('caption');
  const [s, en] = [ta.selectionStart, ta.selectionEnd];
  ta.setRangeText(b.dataset.v, s, en, 'end');
  ta.focus();
  renderCapPreview();
});
$('caption').oninput = renderCapPreview;
$('firm').oninput = renderCapPreview;
$('edCancel').onclick = () => $('editor').close();
$('add').onclick = () => openEditor(null);

$('file').onchange = async e => {
  const f = e.target.files[0];
  $('edErr').textContent = '';
  if (!f) return;
  try {
    const prevName = pendingFile ? pendingFile.name : (editingId && docs.find(d => d.id === editingId)?.fileName);
    pendingFile = await readDocFile(f);
    renderFileInfo(pendingFile);
    const sn = $('sendName').value.trim();
    if (!sn || sn === prevName) $('sendName').value = pendingFile.name;
  } catch (err) {
    pendingFile = null;
    e.target.value = '';
    $('edErr').textContent = err.message;
  }
};

$('form').onsubmit = async e => {
  e.preventDefault();
  const err = msg => { $('edErr').textContent = msg; };
  const label = $('label').value.trim();
  if (!label) return err('Button label likho (jaise "SS Bank").');
  const old = editingId ? docs.find(d => d.id === editingId) : null;
  if (!old && !pendingFile) return err('PDF file chuno.');
  const fileMeta = pendingFile || old;
  const ext = extOf(pendingFile ? pendingFile.name : old.fileName) || '.pdf';
  const sendName = cleanName($('sendName').value, ext) || (pendingFile ? pendingFile.name : old.fileName);

  let shortcut = $('shortcut').value ? +$('shortcut').value : '';
  const clash = shortcut && docs.find(d => d.id !== editingId && String(d.shortcut) === String(shortcut));
  if (clash && !confirm(`Alt+${shortcut} abhi "${clash.label}" ke paas hai. Use is document par le aayein?`)) return;
  if (clash) clash.shortcut = '';

  const doc = {
    id: old ? old.id : QD.uid(),
    label,
    firm: $('firm').value.trim(),
    fileName: pendingFile ? pendingFile.name : old.fileName,
    sendName,
    mime: fileMeta.mime,
    size: fileMeta.size,
    caption: $('caption').value.replace(/\s+$/, ''),
    color: QD.safeColor($('color').value),
    shortcut,
    active: $('active').checked,
    updatedAt: Date.now()
  };
  if (old) docs[docs.indexOf(old)] = doc; else docs.push(doc);
  const out = { [QD.K.docs]: docs };
  if (pendingFile) out[QD.FILE_PREFIX + doc.id] = pendingFile;
  try {
    await chrome.storage.local.set(out);
  } catch (ex) {
    return err('Save nahi hua: ' + ex.message);
  }
  $('editor').close();
};

// ---------- Settings ----------
async function loadSettings() {
  settings = await QD.getSettings();
  $('enabled').checked = !!settings.enabled;
  $('mode').value = settings.mode;
  $('dailyLimit').value = settings.dailyLimit;
  $('delayMin').value = settings.delayMin;
  $('delayMax').value = settings.delayMax;
  $('todayCount').textContent = await QD.getDailyCount();
}
$('enabled').onchange = () => QD.saveSettings({ enabled: $('enabled').checked });
$('mode').onchange = () => QD.saveSettings({ mode: $('mode').value });
['dailyLimit', 'delayMin', 'delayMax'].forEach(id => $(id).onchange = async () => {
  const dailyLimit = Math.max(1, +$('dailyLimit').value || QD.DEFAULTS.dailyLimit);
  const delayMin = Math.max(3, +$('delayMin').value || QD.DEFAULTS.delayMin);
  const delayMax = Math.max(delayMin, +$('delayMax').value || QD.DEFAULTS.delayMax);
  await QD.saveSettings({ dailyLimit, delayMin, delayMax });
});

// ---------- Export / Import (PDFs base64 ke saath ek JSON) ----------
$('export').onclick = async () => {
  if (!docs.length) return alert('Export karne ke liye koi document nahi.');
  const files = await chrome.storage.local.get(docs.map(d => QD.FILE_PREFIX + d.id));
  const backup = {
    format: 'devwa-quickdocs',
    version: 1,
    extVersion: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings: await QD.getSettings(),
    docs: docs.map(d => ({ ...d, file: files[QD.FILE_PREFIX + d.id] || null }))
  };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `QuickDocs_Backup_${QD.todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

let importData = null;
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || data.format !== 'devwa-quickdocs' || !Array.isArray(data.docs)) throw new Error('Yeh Quick Docs backup file nahi hai.');
    const valid = [];
    const bad = [];
    for (const d of data.docs) {
      const fo = d && d.file;
      const ok = d && d.label && fo && typeof fo.data === 'string' &&
        QD.ALLOWED.includes(fo.mime) && fo.data.startsWith('data:' + fo.mime + ';base64,') &&
        (fo.size || 0) <= QD.MAX_BYTES;
      (ok ? valid : bad).push(d);
    }
    if (!valid.length) throw new Error('Backup me koi sahi document nahi mila.');
    importData = { ...data, docs: valid };
    $('importInfo').innerHTML = `<b>${valid.length}</b> document(s) mile` +
      (bad.length ? ` (${bad.length} kharab skip honge)` : '') +
      `. Abhi aapke paas <b>${docs.length}</b> hai.<br><br>` +
      `<b>Merge</b> = naye add honge, purane rahenge.<br><b>Replace all</b> = purane sab hatke backup wale aayenge (settings bhi).`;
    $('importDlg').showModal();
  } catch (err) {
    alert('Import fail: ' + err.message);
  }
};
$('importDlg').addEventListener('click', async e => {
  const mode = e.target.dataset && e.target.dataset.imp;
  if (!mode) return;
  $('importDlg').close();
  if (mode === 'cancel' || !importData) return;
  const replace = mode === 'replace';
  const base = replace ? [] : docs.slice();
  const usedKeys = new Set(base.map(d => String(d.shortcut || '')).filter(Boolean));
  const out = {};
  const added = importData.docs.map(src => {
    const { file, ...meta } = src;
    const d = {
      id: QD.uid(),
      label: String(meta.label).slice(0, 24),
      firm: String(meta.firm || ''),
      fileName: String(meta.fileName || file.name || 'document.pdf'),
      sendName: cleanName(meta.sendName || file.name, extOf(file.name) || '.pdf'),
      mime: file.mime,
      size: file.size || 0,
      caption: String(meta.caption || ''),
      color: QD.safeColor(meta.color),
      shortcut: '',
      active: meta.active !== false,
      updatedAt: Date.now()
    };
    // Shortcut tabhi rakho jab khaali ho
    const sc = String(meta.shortcut || '');
    if (/^[1-9]$/.test(sc) && !usedKeys.has(sc)) { d.shortcut = +sc; usedKeys.add(sc); }
    out[QD.FILE_PREFIX + d.id] = { name: file.name || d.fileName, mime: file.mime, size: file.size || 0, data: file.data };
    return d;
  });
  try {
    if (replace) {
      await chrome.storage.local.remove(docs.map(d => QD.FILE_PREFIX + d.id));
      if (importData.settings) out[QD.K.settings] = { ...QD.DEFAULTS, ...importData.settings };
    }
    out[QD.K.docs] = base.concat(added);
    await chrome.storage.local.set(out);
    alert(`✅ ${added.length} document(s) import ho gaye.`);
  } catch (err) {
    alert('Import fail: ' + err.message);
  }
  importData = null;
});

// ---------- Log ----------
let logRows = [];
async function loadLog() {
  const raw = (await chrome.storage.local.get(QD.K.log))[QD.K.log] || [];
  const pruned = QD.pruneLog(raw);
  if (pruned.length !== raw.length) await chrome.storage.local.set({ [QD.K.log]: pruned }); // 90 din purane hatao
  return pruned;
}
function filteredLog() {
  const from = $('fFrom').value ? new Date($('fFrom').value + 'T00:00:00').getTime() : 0;
  const to = $('fTo').value ? new Date($('fTo').value + 'T23:59:59.999').getTime() : Infinity;
  const doc = $('fDoc').value;
  const st = $('fStatus').value;
  return logRows.filter(e => e.t >= from && e.t <= to && (!doc || e.label === doc) && (!st || e.status === st))
    .sort((a, b) => b.t - a.t);
}
async function renderLog() {
  logRows = await loadLog();
  const labels = [...new Set([...docs.map(d => d.label), ...logRows.map(e => e.label)].filter(Boolean))];
  const cur = $('fDoc').value;
  $('fDoc').innerHTML = '<option value="">Sab</option>' + labels.map(l => `<option>${esc(l)}</option>`).join('');
  $('fDoc').value = labels.includes(cur) ? cur : '';
  const rows = filteredLog();
  $('logInfo').textContent = `${rows.length} entries` + (rows.length !== logRows.length ? ` (kul ${logRows.length})` : '');
  $('logBody').innerHTML = rows.slice(0, 2000).map(e =>
    `<tr><td>${QD.fmtDateTime(e.t)}</td><td>${esc(e.name)}</td><td>${e.phone ? '+' + esc(e.phone) : ''}</td>` +
    `<td>${esc(e.label)}</td><td>${esc(e.mode)}</td><td class="${esc(e.status)}">${esc(e.status)}</td><td>${esc(e.reason)}</td></tr>`
  ).join('');
}
['fFrom', 'fTo', 'fDoc', 'fStatus'].forEach(id => $(id).onchange = renderLog);

$('csv').onclick = () => {
  const rows = filteredLog();
  if (!rows.length) return alert('Log khali hai (ya filter me kuch nahi).');
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['Date-time', 'Contact', 'Number', 'Document', 'Firm', 'Mode', 'Status', 'Reason'].map(q).join(',')]
    .concat(rows.map(e => [QD.fmtDateTime(e.t), e.name, e.phone ? '+' + e.phone : '', e.label, e.firm, e.mode, e.status, e.reason].map(q).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }); // BOM = Excel me Hindi/₹ sahi
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `QuickDoc_Log_${QD.todayKey()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};
$('clearLog').onclick = async () => {
  if (!confirm('Poora Quick Docs log delete karein?')) return;
  await chrome.storage.local.set({ [QD.K.log]: [] });
};

// ---------- Live update + init ----------
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes[QD.K.docs]) { docs = changes[QD.K.docs].newValue || []; renderDocs(); }
  if (changes[QD.K.settings] || changes[QD.K.daily]) loadSettings();
  if (changes[QD.K.log] && !$('tab-log').hidden) renderLog();
});

(async () => {
  docs = await QD.getDocs();
  renderDocs();
  await loadSettings();
  showTab(location.hash === '#log' ? 'log' : 'docs');
})();
