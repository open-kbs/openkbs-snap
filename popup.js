const $ = (s) => document.querySelector(s);
const msg = (t, cls = '') => { $('#msg').textContent = t; $('#msg').className = 'msg ' + cls; };
let activeTabUrl = '';
let busy = null;

async function render() {
  const s = await snapGetSession();
  const live = await snapGetLive();
  const conn = await snapGetConnection();
  const pending = snapPending(s), recent = snapRecent(s);
  const pendingShots = snapPendingShotCount(s);
  const on = !!conn;

  $('#connDot').className = 'dot' + (on ? ' on' : '');
  $('#connText').textContent = on ? (conn.title || conn.projectId) + ' · ' + new URL(conn.origin).host : 'Not connected to a project';
  $('#connText').title = on ? conn.origin : '';
  $('#disconnect').hidden = !on;
  $('#connActions').hidden = on;
  $('#modelRow').hidden = !on;

  // live line: working chats on the project + what we sent
  const ours = recent.filter((i) => i.link.kind === 'chat');
  const count = (st) => ours.filter((i) => (live[i.id] || {}).state === st).length;
  const parts = [];
  if (busy) parts.push(`<span><b>${busy.working}</b> working</span>`);
  if (count('queued')) parts.push(`<span><b>${count('queued')}</b> queued</span>`);
  if (count('awaiting')) parts.push(`<span style="color:var(--danger)"><b>${count('awaiting')}</b> waiting for you</span>`);
  if (count('done')) parts.push(`<span><b>${count('done')}</b> done</span>`);
  $('#liveLine').hidden = !on || !parts.length;
  $('#liveLine').innerHTML = parts.join('');

  $('#send').hidden = !on || !pending.length;
  $('#sendCount').textContent = pending.length ? `${pending.length} ${pending.length === 1 ? 'card' : 'cards'}` : '';
  $('#pendingText').textContent = pending.length ? `${pending.length} pending · ${pendingShots} ${pendingShots === 1 ? 'screenshot' : 'screenshots'}` : 'Nothing pending';
  $('#export').disabled = !pending.length; $('#clearPending').disabled = !pending.length; $('#clearRecent').disabled = !recent.length;

  $('#recentWrap').hidden = !recent.length;
  snapRenderRecent($('#recent'), recent.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)), live, { expandQuestions: true, onChanged: refreshLive });

  if (!on) {
    try { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); activeTabUrl = tab && /^https?:/.test(tab.url || '') ? tab.url : ''; } catch { activeTabUrl = ''; }
    $('#connectTab').disabled = !activeTabUrl;
    $('#connectTab').title = activeTabUrl ? new URL(activeTabUrl).host : 'Open your OpenKBS Studio project in the current tab first';
  }
  const settings = await snapGetSettings();
  const sel = $('#model');
  if (!sel.options.length) for (const m of SNAP_TRANSCRIBE_MODELS) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.appendChild(o); }
  sel.value = settings.transcribeModel;
  const lang = $('#lang');
  if (!lang.options.length) for (const l of SNAP_TRANSCRIBE_LANGS) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.label; lang.appendChild(o); }
  lang.value = settings.transcribeLanguage || 'auto';
}

async function refreshLive() {
  const r = await chrome.runtime.sendMessage({ type: 'snap:status' });
  if (r && !r.error) busy = r.busy;
  await render();
}

async function connect(url) {
  msg('Connecting…');
  const r = await chrome.runtime.sendMessage({ type: 'snap:connect', url });
  if (r && r.error) { msg(r.error, 'err'); return; }
  busy = r.busy || null;
  msg(`Connected to ${r.title || r.projectId}`, 'ok');
  await render();
}
$('#connectTab').addEventListener('click', () => activeTabUrl && connect(activeTabUrl));
$('#pasteToggle').addEventListener('click', () => { $('#pasteRow').hidden = false; $('#pasteToggle').hidden = true; $('#connUrl').focus(); });
$('#connectUrl').addEventListener('click', () => { const u = $('#connUrl').value.trim(); if (u) connect(u); });
$('#connUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#connectUrl').click(); });
$('#disconnect').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'snap:disconnect' }); busy = null; msg('Disconnected'); await render(); });
$('#model').addEventListener('change', async (e) => { await snapSetSettings({ transcribeModel: e.target.value }); });
$('#lang').addEventListener('change', async (e) => { await snapSetSettings({ transcribeLanguage: e.target.value }); });

$('#capture').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'snap:capture-active' });
  if (res && res.error) { msg(res.error, 'err'); return; }
  window.close();
});
$('#panel').addEventListener('click', async () => { const w = await chrome.windows.getCurrent(); await chrome.sidePanel.open({ windowId: w.id }); window.close(); });
$('#send').addEventListener('click', async () => {
  const btn = $('#send'); btn.disabled = true; const label = btn.querySelector('.lbl'); const orig = label.innerHTML; label.textContent = 'Sending…';
  msg('Creating cards and uploading screenshots…');
  const r = await chrome.runtime.sendMessage({ type: 'snap:send-pending-board' });
  label.innerHTML = orig; btn.disabled = false;
  if (r && r.error) { msg(r.error, 'err'); return; }
  msg(`${r.count} card(s) on the board.`, 'ok');
  await render();
});
$('#refresh').addEventListener('click', refreshLive);

$('#more').addEventListener('click', (e) => { e.stopPropagation(); $('#moreMenu').hidden = !$('#moreMenu').hidden; });
document.addEventListener('click', () => { $('#moreMenu').hidden = true; });
$('#export').addEventListener('click', async () => { $('#moreMenu').hidden = true; const r = await snapExportZip(); msg(r.error ? r.error : `Saved ${r.filename}`, r.error ? 'err' : 'ok'); });
$('#clearPending').addEventListener('click', async () => { $('#moreMenu').hidden = true; await snapClearSession(); msg('Pending cleared', 'ok'); await render(); });
$('#clearRecent').addEventListener('click', async () => { $('#moreMenu').hidden = true; await snapClearRecent(); await snapSetLive({}); msg('Recent cleared', 'ok'); await render(); });

(async () => {
  await render();
  const c = await chrome.runtime.sendMessage({ type: 'snap:connection' });
  if (c && c.busy) busy = c.busy;
  await refreshLive();
  chrome.runtime.sendMessage({ type: 'snap:seen' });
})();
