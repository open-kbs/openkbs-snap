importScripts('lib/store.js', 'lib/zip.js', 'lib/report.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'open-panel', title: 'Open Snap panel', contexts: ['action'] });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  refreshBadge();
});

chrome.action.onClicked.addListener((tab) => startCapture(tab));
chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'capture') startCapture(tab);
  if (cmd === 'open-panel') openPanel(tab);
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open-panel') openPanel(tab);
});

async function openPanel(tab) {
  try {
    if (tab && tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) { console.warn('sidePanel.open failed', e); }
}

async function startCapture(tab) {
  if (!tab || !tab.id) return;
  if (!/^https?:|^file:/.test(tab.url || '')) {
    console.warn('Snap: cannot capture this page', tab.url);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'snap:start' });
  } catch {
    // Content script not present (extension installed after the page loaded). Inject and retry.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'snap:start' });
  }
}

async function refreshBadge() {
  const s = await snapGetSession();
  const n = snapShotCount(s);
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });
}

chrome.storage.onChanged.addListener((changes) => { if (changes.session) refreshBadge(); });

// ── project connection (studio origin + the user's studio session cookies) ──
async function studioFetch(origin, path, init = {}) {
  const res = await fetch(`${origin}${path}`, { credentials: 'include', redirect: 'manual', ...init });
  const ct = res.headers.get('content-type') || '';
  if (res.type === 'opaqueredirect' || res.status === 0 || res.status === 302 || res.status === 401) {
    throw new Error('Not signed in to this studio. Open it in a tab, sign in, then try again.');
  }
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  if (!ct.includes('application/json')) throw new Error('This page is not an OpenKBS Studio project.');
  return data;
}

async function connectTo(rawUrl) {
  let origin;
  try { origin = new URL(rawUrl).origin; } catch { throw new Error('Not a valid URL'); }
  if (!/^https?:/.test(origin)) throw new Error('Studio URL must start with https://');
  const info = await studioFetch(origin, '/api/snap/info');
  if (!info.projectId) throw new Error('This page is not an OpenKBS Studio project.');
  const connection = {
    origin, projectId: info.projectId, title: info.title || null,
    boardUrl: `${origin}/?#tab=board`, columns: info.columns || [], connectedAt: new Date().toISOString(),
  };
  await snapSetConnection(connection);
  return connection;
}

async function sendToBoard(columnId) {
  const conn = await snapGetConnection();
  if (!conn) throw new Error('Not connected to a project');
  const session = await snapGetSession();
  if (!session.issues.length) throw new Error('Nothing to send yet');
  const report = snapReportJson(session);
  const ids = session.issues.flatMap((i) => i.shots.map((x) => x.id));
  const imgs = await snapGetImages(ids);
  const images = {};
  for (const issue of report.issues) for (const shot of issue.shots) {
    const png = imgs[shot.id] && imgs[shot.id].png;
    if (!png) throw new Error('A screenshot is missing from local storage');
    images[shot.png] = png.split(',')[1];
    delete shot.id;
  }
  const res = await studioFetch(conn.origin, '/api/snap/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, images, ...(columnId ? { columnId } : {}) }),
  });
  session.sent = { at: new Date().toISOString(), cardIds: res.cardIds || [], boardUrl: res.boardUrl || conn.boardUrl };
  await snapSetSession(session);
  return session.sent;
}

// ── dictation: offscreen recorder + studio transcription ────────
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['USER_MEDIA'],
    justification: 'Record a short voice note for a screenshot while the user holds the mic button',
  });
}
async function micStart() {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'mic:start' });
  if (r && r.error === 'permission') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
    throw Object.assign(new Error('Microphone access is requested in a new tab. Allow it there, then press the mic again.'), { needsPermission: true });
  }
  if (!r || r.error) throw new Error(r && r.error || 'recorder unavailable');
}
async function micStop() {
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'mic:stop' });
  if (!r || r.error) throw new Error(r && r.error || 'recorder unavailable');
  return r;
}
async function transcribe(dataUrl, format) {
  const conn = await snapGetConnection();
  if (!conn) throw new Error('Connect a project to use dictation');
  const { transcribeModel } = await snapGetSettings();
  const bytes = snapDataUrlToU8(dataUrl);
  const data = await studioFetch(conn.origin, '/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Format': format || 'webm', 'X-Transcribe-Model': transcribeModel },
    body: bytes,
  });
  return (data.text || '').trim();
}

const respond = (p, sendResponse) => { p.then((r) => sendResponse(r === undefined ? { ok: true } : r)).catch((e) => sendResponse({ error: String(e && e.message || e), needsPermission: !!(e && e.needsPermission) })); return true; };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  if (msg.type === 'snap:connect') return respond(connectTo(msg.url), sendResponse);
  if (msg.type === 'snap:disconnect') return respond(snapSetConnection(null), sendResponse);
  if (msg.type === 'snap:connection') return respond(snapGetConnection().then((c) => ({ connection: c })), sendResponse);
  if (msg.type === 'snap:send-to-board') return respond(sendToBoard(msg.columnId), sendResponse);
  if (msg.type === 'snap:mic-start') return respond(micStart(), sendResponse);
  if (msg.type === 'snap:mic-stop') return respond(micStop(), sendResponse);
  if (msg.type === 'snap:mic-cancel') return respond(chrome.offscreen.hasDocument().then((h) => h ? chrome.runtime.sendMessage({ target: 'offscreen', type: 'mic:cancel' }) : null), sendResponse);
  if (msg.type === 'snap:transcribe') return respond(transcribe(msg.dataUrl, msg.format).then((text) => ({ text })), sendResponse);
  if (msg.type === 'snap:capture') {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((e) => sendResponse({ error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'snap:issues') {
    snapGetSession().then((s) => sendResponse({
      issues: s.issues.map((i, idx) => ({ id: i.id, n: idx + 1, title: i.title, shots: i.shots.length })),
    }));
    return true;
  }
  if (msg.type === 'snap:save') {
    snapSaveShot(msg).then(sendResponse).catch((e) => sendResponse({ error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'snap:capture-active') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
      .then((tabs) => startCapture(tabs[0]))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: String(e && e.message || e) }));
    return true;
  }
});
