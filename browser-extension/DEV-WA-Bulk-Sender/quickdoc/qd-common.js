// DEV WA Bulk Sender — Quick Doc: shared helpers
// WhatsApp content script, settings page aur popup — teeno yahi file use karte hai.
//
// Storage (chrome.storage.local):
//   qd_docs        [{ id, label, firm, fileName, sendName, mime, size, caption, color, shortcut, active }]
//                  (array ka order = button order)
//   qd_file:<id>   { name, mime, size, data }   data = base64 dataUrl
//   qd_settings    { enabled, mode, dailyLimit, delayMin, delayMax }
//   qd_ui          { x, y, collapsed }           panel position
//   qd_daily       { date, count }               aaj kitne doc gaye
//   qd_log         [{ t, name, phone, label, firm, mode, status, reason }]
//   qd_multi_last  aakhri Multi Send ki report
var QD = {
  K: {
    docs: 'qd_docs', settings: 'qd_settings', ui: 'qd_ui',
    daily: 'qd_daily', log: 'qd_log', lastMulti: 'qd_multi_last'
  },
  FILE_PREFIX: 'qd_file:',
  MAX_BYTES: 10 * 1024 * 1024,
  ALLOWED: ['application/pdf', 'image/jpeg', 'image/png'],
  LOG_DAYS: 90,
  LOG_MAX: 20000,
  DEFAULTS: { enabled: true, mode: 'direct', dailyLimit: 50, delayMin: 8, delayMax: 20 },
  COLORS: ['#25d366', '#128c7e', '#0b84ff', '#7c3aed', '#e11d48', '#f59e0b', '#0f766e', '#334155'],

  // ---------- Settings / docs ----------
  async getSettings() {
    const o = await chrome.storage.local.get(QD.K.settings);
    return { ...QD.DEFAULTS, ...(o[QD.K.settings] || {}) };
  },
  async saveSettings(patch) {
    const next = { ...(await QD.getSettings()), ...patch };
    await chrome.storage.local.set({ [QD.K.settings]: next });
    return next;
  },
  async getDocs() {
    return (await chrome.storage.local.get(QD.K.docs))[QD.K.docs] || [];
  },
  saveDocs(docs) {
    return chrome.storage.local.set({ [QD.K.docs]: docs });
  },
  async getFile(id) {
    const k = QD.FILE_PREFIX + id;
    return (await chrome.storage.local.get(k))[k] || null;
  },

  // ---------- Small utils ----------
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },
  todayKey() {
    return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
  },
  fmtDate(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`; // DD-MM-YYYY
  },
  fmtDateTime(t) {
    const d = new Date(t);
    const p = n => String(n).padStart(2, '0');
    return `${QD.fmtDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },
  fmtSize(b) {
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  },
  // Sirf #rrggbb maano (import kiye JSON se CSS injection na ho)
  safeColor(c) {
    return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#128c7e';
  },
  // Button ke background par padhne layak text colour
  textColor(hex) {
    const c = QD.safeColor(hex).slice(1);
    const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16));
    return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#111b21' : '#ffffff';
  },

  // Caption variables: {firm}, {date} (DD-MM-YYYY), {contact_name}
  fillCaption(tpl, vars = {}) {
    return String(tpl || '').replace(/\{(firm|date|contact_name)\}/gi, (m, k) => {
      k = k.toLowerCase();
      if (k === 'date') return QD.fmtDate();
      return String(vars[k] ?? '');
    }).trim();
  },

  // base64 dataUrl -> Blob -> File
  dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const head = dataUrl.slice(0, comma);
    const mime = (/^data:([^;,]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(dataUrl.slice(comma + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  },
  dataUrlToFile(dataUrl, name, mime) {
    const blob = QD.dataUrlToBlob(dataUrl);
    return new File([blob], name, { type: mime || blob.type });
  },

  // 10 digit -> 91 laga do. Return: sirf digits (jaise 919876543210) ya null
  normPhone(raw) {
    let d = String(raw ?? '').replace(/\D/g, '');
    if (d.length === 10) d = '91' + d;
    else if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
    return d.length >= 11 && d.length <= 15 ? d : null;
  },

  // ---------- Daily limit ----------
  async getDailyCount() {
    const d = (await chrome.storage.local.get(QD.K.daily))[QD.K.daily];
    return d && d.date === QD.todayKey() ? d.count : 0;
  },
  async bumpDaily(n = 1) {
    const count = (await QD.getDailyCount()) + n;
    await chrome.storage.local.set({ [QD.K.daily]: { date: QD.todayKey(), count } });
    return count;
  },

  // ---------- Send log (90 din se purane apne aap hat jaate hai) ----------
  pruneLog(log) {
    const cutoff = Date.now() - QD.LOG_DAYS * 864e5;
    const out = (log || []).filter(e => e && e.t >= cutoff);
    return out.length > QD.LOG_MAX ? out.slice(-QD.LOG_MAX) : out;
  },
  async addLog(entries) {
    const list = [].concat(entries).map(e => ({ t: Date.now(), ...e }));
    const log = (await chrome.storage.local.get(QD.K.log))[QD.K.log] || [];
    await chrome.storage.local.set({ [QD.K.log]: QD.pruneLog(log.concat(list)) });
  }
};
