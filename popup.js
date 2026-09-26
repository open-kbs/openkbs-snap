const $ = (s) => document.querySelector(s);
const msg = (t, cls = '') => { $('#msg').textContent = t; $('#msg').className = 'msg ' + cls; };

async function refresh() {
  const s = await snapGetSession();
  const shots = snapShotCount(s);
  $('#name').textContent = s.name || 'Untitled report';
  $('#counts').textContent = `${s.issues.length} ${s.issues.length === 1 ? 'issue' : 'issues'} · ${shots} ${shots === 1 ? 'screenshot' : 'screenshots'}`;
  $('#export').disabled = !s.issues.length;
}

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
