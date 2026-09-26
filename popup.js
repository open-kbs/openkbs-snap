const $ = (s) => document.querySelector(s);
const msg = (t, cls = '') => { $('#msg').textContent = t; $('#msg').className = 'msg ' + cls; };

let activeTabUrl = '';

async function refresh() {
  const s = await snapGetSession();
  const shots = snapShotCount(s);
  $('#name').textContent = s.name || 'Untitled report';
  $('#counts').textContent = `${s.issues.length} ${s.issues.length === 1 ? 'issue' : 'issues'} · ${shots} ${shots === 1 ? 'screenshot' : 'screenshots'}` +
    (s.sent ? ` · sent ${s.sent.cardIds.length} card(s)` : '');
  $('#export').disabled = !s.issues.length;

  const conn = await snapGetConnection();
  const on = !!conn;
  $('#connDot').className = 'dot' + (on ? ' on' : '');
  $('#connText').textContent = on ? (conn.title ? `${conn.title}` : conn.projectId) + ' · ' + new URL(conn.origin).host : 'Not connected to a project';
  $('#connText').title = on ? conn.origin : '';
  $('#disconnect').hidden = !on;
  $('#connActions').hidden = on;
  $('#modelRow').hidden = !on;
  $('#send').hidden = !on;
  $('#send').disabled = !s.issues.length;
  $('#sendCount').textContent = s.issues.length ? `${s.issues.length} ${s.issues.length === 1 ? 'card' : 'cards'}` : '';
  $('#capture').classList.toggle('secondary', on);

  if (!on) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      activeTabUrl = tab && /^https?:/.test(tab.url || '') ? tab.url : '';
    } catch { activeTabUrl = ''; }
    $('#connectTab').disabled = !activeTabUrl;
    $('#connectTab').title = activeTabUrl ? new URL(activeTabUrl).host : 'Open your OpenKBS Studio project in the current tab first';
  }
  const settings = await snapGetSettings();
  const sel = $('#model');
  if (!sel.options.length) for (const m of SNAP_TRANSCRIBE_MODELS) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.appendChild(o); }
  sel.value = settings.transcribeModel;
}

async function connect(url) {
  msg('Connecting…');
  const r = await chrome.runtime.sendMessage({ type: 'snap:connect', url });
  if (r && r.error) { msg(r.error, 'err'); return; }
  msg(`Connected to ${r.title || r.projectId}`, 'ok');
  await refresh();
}
$('#connectTab').addEventListener('click', () => activeTabUrl && connect(activeTabUrl));
$('#connectUrl').addEventListener('click', () => { const u = $('#connUrl').value.trim(); if (u) connect(u); });
$('#connUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#connectUrl').click(); });
$('#disconnect').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'snap:disconnect' }); msg('Disconnected'); await refresh(); });
$('#model').addEventListener('change', async (e) => { await snapSetSettings({ transcribeModel: e.target.value }); });

$('#send').addEventListener('click', async () => {
  const btn = $('#send');
  btn.disabled = true; const label = btn.querySelector('.lbl'); const orig = label.innerHTML;
  label.textContent = 'Sending…'; msg('Creating cards and uploading screenshots…');
  const r = await chrome.runtime.sendMessage({ type: 'snap:send-to-board' });
  label.innerHTML = orig;
  if (r && r.error) { btn.disabled = false; msg(r.error, 'err'); return; }
  msg(`Sent ${r.cardIds.length} card(s) to the board.`, 'ok');
  const a = document.createElement('a'); a.href = r.boardUrl; a.target = '_blank'; a.textContent = ' Open board'; a.style.marginLeft = '4px'; $('#msg').appendChild(a);
  await refresh();
});

$('#capture').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'snap:capture-active' });
  if (res && res.error) { msg(res.error, 'err'); return; }
  window.close();
});

$('#panel').addEventListener('click', async () => {
  const w = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: w.id });
  window.close();
});

$('#export').addEventListener('click', async () => {
  const r = await snapExportZip();
  msg(r.error ? r.error : `Saved ${r.filename}`, r.error ? 'err' : 'ok');
});

$('#new').addEventListener('click', () => { $('#confirm').classList.add('show'); $('#new').hidden = true; });
$('#confirmNo').addEventListener('click', () => { $('#confirm').classList.remove('show'); $('#new').hidden = false; });
$('#confirmYes').addEventListener('click', async () => {
  await snapClearSession();
  $('#confirm').classList.remove('show'); $('#new').hidden = false;
  await refresh();
  msg('Started a new report', 'ok');
});

refresh();
