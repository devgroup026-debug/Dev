// DEV WA Bulk Sender — toolbar popup (Dashboard + Quick Docs on/off)
const $ = id => document.getElementById(id);

async function open(path) {
  await chrome.runtime.sendMessage({ type: 'open-page', path });
  window.close();
}
$('dash').onclick = () => open('dashboard.html');
$('qdSettings').onclick = () => open('quickdoc/settings.html');
$('qdLog').onclick = () => open('quickdoc/settings.html#log');

$('qdOn').onchange = () => QD.saveSettings({ enabled: $('qdOn').checked });

(async () => {
  const [s, today, docs] = await Promise.all([QD.getSettings(), QD.getDailyCount(), QD.getDocs()]);
  $('qdOn').checked = !!s.enabled;
  $('today').textContent = today;
  $('limit').textContent = s.dailyLimit;
  $('docCount').textContent = docs.filter(d => d.active).length;
  $('stat').classList.toggle('warn', today >= s.dailyLimit);
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
})();
