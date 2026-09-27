importScripts('lib/store.js', 'lib/zip.js', 'lib/report.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'open-panel', title: 'Open Snap panel', contexts: ['action'] });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  refreshBadge();
});

chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'capture') startCapture(tab);
  if (cmd === 'open-panel') openPanel(tab);
});
chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === 'open-panel') openPanel(tab); });

async function openPanel(tab) {
  try { if (tab && tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (e) { console.warn('sidePanel.open failed', e); }
}

async function startCapture(tab) {
  if (!tab || !tab.id) return;
  if (!/^https?:|^file:/.test(tab.url || '')) { console.warn('Snap: cannot capture this page', tab.url); return; }
  // The page's content script may be missing (installed after the page
  // loaded) or dead (extension reloaded since): inject a fresh copy and retry.
  try { await chrome.tabs.sendMessage(tab.id, { type: 'snap:start' }); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'snap:start' });
  }
}

// ── badge ──────────────────────────────────────────────────────────
// pending snaps count in blue; a chat waiting for you shows "!" in red;
// newly finished chats since the popup was last opened show "✓N" in green.
async function refreshBadge() {
  const s = await snapGetSession();
  const live = await snapGetLive();
  const recent = snapRecent(s);
  const waiting = recent.filter((i) => live[i.id] && live[i.id].state === 'awaiting').length;
  const fresh = recent.filter((i) => live[i.id] && live[i.id].state === 'done' && !live[i.id].seen).length;
  let text = '', color = '#3D85C9';
  if (waiting) { text = '!'; color = '#B42318'; }
  else if (fresh) { text = `✓${fresh}`; color = '#157F3F'; }
  else { const n = snapPendingShotCount(s); text = n ? String(n) : ''; }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}
chrome.storage.onChanged.addListener((ch) => { if (ch.session || ch.live) refreshBadge(); });

// ── studio connection ─────────────────────────────────────────────
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
async function requireConnection() {
  const conn = await snapGetConnection();
  if (!conn) throw new Error('Connect a project first (click the Snap icon on your studio tab).');
  return conn;
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
  return { ...connection, busy: info.busy || null };
}

async function connectionWithBusy() {
  const conn = await snapGetConnection();
  if (!conn) return { connection: null, busy: null };
  try { const st = await studioFetch(conn.origin, '/api/snap/status'); return { connection: conn, busy: st.busy || null }; }
  catch (e) { return { connection: conn, busy: null, error: String(e.message || e) }; }
}

// ── payloads ──────────────────────────────────────────────────────
function groupOf(issue, n) {
  return {
    n, title: issue.title, type: issue.type, priority: issue.priority, expected: issue.expected, notes: issue.notes, createdAt: issue.createdAt,
    shots: issue.shots.filter((x) => !x.uploaded).map((shot, si) => ({ k: si + 1, id: shot.id, note: shot.note, createdAt: shot.createdAt, png: `shot-${si + 1}.png`, context: shot.context || {}, vectors: shot.vectors })),
  };
}
async function payloadFor(issue, n) {
  const group = groupOf(issue, n);
  const imgs = await snapGetImages(group.shots.map((s) => s.id));
  const images = {};
  for (const shot of group.shots) {
    const png = imgs[shot.id] && imgs[shot.id].png;
    if (!png) throw new Error('A screenshot is missing from local storage');
    images[shot.png] = png.split(',')[1];
    delete shot.id;
  }
  return { group, images };
}

// ── destinations ──────────────────────────────────────────────────
async function sendIssue(issueId, dest, mode) {
  const conn = await requireConnection();
  const s = await snapGetSession();
  const idx = s.issues.findIndex((i) => i.id === issueId);
  if (idx < 0) throw new Error('Group not found');
  const issue = s.issues[idx];
  if (issue.link) throw new Error('Already sent');
  const { group, images } = await payloadFor(issue, idx + 1);
  let link, liveEntry;
  if (dest === 'board') {
    const r = await studioFetch(conn.origin, '/api/snap/board', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group, images }) });
    link = { kind: 'card', cardId: r.cardId, cardUrl: r.cardUrl || conn.boardUrl, title: r.title || issue.title };
    liveEntry = { kind: 'card', state: 'board', title: link.title };
  } else {
    const r = await studioFetch(conn.origin, '/api/snap/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group, images, mode: mode === 'parallel' ? 'parallel' : 'queue' }) });
    link = { kind: 'chat', sessionId: r.sessionId, title: r.title || issue.title, chatUrl: `${conn.origin}/?#session=${r.sessionId}` };
    liveEntry = { kind: 'chat', state: r.state === 'queued' ? 'queued' : 'running', title: link.title };
  }
  await snapMarkSent(issueId, link);
  const live = await snapGetLive(); live[issueId] = { ...liveEntry, at: Date.now() }; await snapSetLive(live);
  await ensureAlarm();
  return { link, live: liveEntry };
}

async function sendPendingToBoard() {
  const conn = await requireConnection();
  const s = await snapGetSession();
  const pending = snapPending(s);
  if (!pending.length) throw new Error('Nothing pending');
  const report = { name: '', createdAt: s.createdAt, exportedAt: new Date().toISOString(), issues: [] };
  const images = {};
  for (let i = 0; i < pending.length; i++) {
    const { group, images: imgs } = await payloadFor(pending[i], i + 1);
    for (const shot of group.shots) { const key = `issues/${String(i + 1).padStart(2, '0')}/${shot.png}`; images[key] = imgs[shot.png]; shot.png = key; }
    report.issues.push(group);
  }
  const r = await studioFetch(conn.origin, '/api/snap/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report, images }) });
  const live = await snapGetLive();
  for (let i = 0; i < pending.length; i++) {
    const c = (r.cards || [])[i];
    if (!c) continue;
    await snapMarkSent(pending[i].id, { kind: 'card', cardId: c.cardId, cardUrl: c.cardUrl || conn.boardUrl, title: c.title || pending[i].title });
    live[pending[i].id] = { kind: 'card', state: 'board', title: c.title || pending[i].title, at: Date.now() };
  }
  await snapSetLive(live);
  return { count: (r.cards || []).length, boardUrl: r.boardUrl || conn.boardUrl };
}

// A snap added to a group that was already sent: onto its card, or into its chat.
async function addToSent(issueId, shot, force) {
  const conn = await requireConnection();
  const s = await snapGetSession();
  const issue = s.issues.find((i) => i.id === issueId);
  if (!issue || !issue.link) throw new Error('Group not found');
  const snaps = [{ k: 1, note: shot.note || '', context: shot.context || {}, png: 'shot-1.png' }];
  const images = { 'shot-1.png': shot.png.split(',')[1] };
  let result;
  if (issue.link.kind === 'card') {
    await studioFetch(conn.origin, `/api/snap/board/${issue.link.cardId}/append`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snaps, images }) });
    result = 'sent';
  } else {
    const r = await studioFetch(conn.origin, `/api/snap/chat/${issue.link.sessionId}/followup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snaps, images, force: !!force }) });
    result = r.result;
    if (result === 'not_found') throw new Error('That chat no longer exists');
  }
  if (result === 'sent') {
    issue.shots.push({ id: snapUid(), note: shot.note || '', context: shot.context, vectors: shot.vectors || [], createdAt: new Date().toISOString(), uploaded: true });
    await snapSetSession(s);
    if (issue.link.kind === 'chat') { const live = await snapGetLive(); if (live[issueId] && live[issueId].state === 'done') live[issueId].state = 'running'; await snapSetLive(live); await ensureAlarm(); }
  }
  return { result, link: issue.link };
}

// ── live state of sent groups ─────────────────────────────────────
const ACTIVE_STATES = new Set(['queued', 'running', 'awaiting', 'planning', 'interrupted']);
function stateOf(sess) {
  if (!sess || sess.missing) return 'gone';
  if (sess.queued) return 'queued';
  if (sess.live === 'awaiting') return 'awaiting';
  if (sess.live === 'running' || sess.live === 'planning' || sess.live === 'spec') return 'running';
  if (sess.live === 'interrupted') return 'interrupted';
  if (sess.result) return sess.result.error ? 'failed' : sess.result.aborted ? 'stopped' : 'done';
  return 'running';
}
async function refreshStatus(opts = {}) {
  const conn = await snapGetConnection();
  if (!conn) return { busy: null, live: {} };
  const s = await snapGetSession();
  const recent = snapRecent(s);
  const chats = recent.filter((i) => i.link.kind === 'chat');
  const cards = recent.filter((i) => i.link.kind === 'card');
  const qs = `sessions=${chats.map((i) => i.link.sessionId).join(',')}&cards=${cards.map((i) => i.link.cardId).join(',')}`;
  const st = await studioFetch(conn.origin, `/api/snap/status?${qs}`);
  const prev = await snapGetLive();
  const live = {};
  const notify = [];
  for (const i of chats) {
    const sess = (st.sessions || []).find((x) => x.sessionId === i.link.sessionId);
    const state = stateOf(sess);
    const before = prev[i.id] || {};
    live[i.id] = { kind: 'chat', title: (sess && sess.title) || i.link.title, state, summary: sess && sess.result ? sess.result.summary : '', error: sess && sess.result ? sess.result.error : undefined, question: sess ? sess.question : null, seen: before.state === state ? before.seen : false, at: Date.now() };
    if (before.state && before.state !== state) {
      if (state === 'done') notify.push({ id: i.id, title: `Done: ${live[i.id].title}`, message: live[i.id].summary || 'The chat finished.' });
      if (state === 'awaiting') notify.push({ id: i.id, title: `Question: ${live[i.id].title}`, message: (sess && sess.question && sess.question.text) || 'The AI needs your answer.' });
      if (state === 'failed') notify.push({ id: i.id, title: `Failed: ${live[i.id].title}`, message: live[i.id].error || 'The chat failed.' });
    }
  }
  for (const i of cards) {
    const c = (st.cards || []).find((x) => x.cardId === i.link.cardId);
    live[i.id] = { kind: 'card', title: i.link.title, state: c && c.missing ? 'gone' : 'board', columnName: c ? c.columnName : undefined, seen: true, at: Date.now() };
  }
  // A chat or card deleted in the studio has nothing left to show: drop it.
  const gone = Object.keys(live).filter((id) => live[id].state === 'gone');
  if (gone.length) {
    for (const id of gone) delete live[id];
    const cur = await snapGetSession();
    cur.issues = cur.issues.filter((i) => !gone.includes(i.id));
    await snapSetSession(cur);
  }
  await snapSetLive(live);
  if (!opts.silent) for (const n of notify) {
    try { chrome.notifications.create(`snap-${n.id}`, { type: 'basic', iconUrl: 'icons/icon-128.png', title: n.title, message: n.message.slice(0, 200) }); } catch {}
  }
  const active = Object.values(live).some((l) => ACTIVE_STATES.has(l.state));
  if (!active) chrome.alarms.clear('snap-status');
  return { busy: st.busy || null, live };
}
async function ensureAlarm() {
  const existing = await chrome.alarms.get('snap-status');
  if (!existing) chrome.alarms.create('snap-status', { delayInMinutes: 0.5, periodInMinutes: 1 });
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'snap-status') refreshStatus().catch(() => {}); });
chrome.notifications.onClicked.addListener(async (id) => {
  const conn = await snapGetConnection();
  const s = await snapGetSession();
  const issue = s.issues.find((i) => `snap-${i.id}` === id);
  const url = issue && issue.link && issue.link.kind === 'chat' ? issue.link.chatUrl : (issue && issue.link && issue.link.cardUrl) || (conn && conn.boardUrl);
  if (url) chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});
async function markSeen() {
  const live = await snapGetLive();
  for (const l of Object.values(live)) l.seen = true;
  await snapSetLive(live);
}

// ── dictation: offscreen recorder + studio transcription ────────
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Record a short voice note for a screenshot while the user holds the mic button' });
}
let micTabId = null;
async function micStart(tabId) {
  micTabId = tabId || null;
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
  const conn = await requireConnection();
  const { transcribeModel, transcribeLanguage } = await snapGetSettings();
  const headers = { 'Content-Type': 'application/octet-stream', 'X-Audio-Format': format || 'webm', 'X-Transcribe-Model': transcribeModel };
  if (transcribeLanguage && transcribeLanguage !== 'auto') headers['X-Transcribe-Language'] = transcribeLanguage;
  const data = await studioFetch(conn.origin, '/api/transcribe', {
    method: 'POST', headers,
    body: snapDataUrlToU8(dataUrl),
  });
  return { text: (data.text || '').trim() };
}

// ── issues for the editor picker ──────────────────────────────────
async function issuesForPicker() {
  const s = await snapGetSession();
  const live = await snapGetLive();
  const pending = snapPending(s).map((i) => ({ id: i.id, n: s.issues.indexOf(i) + 1, title: i.title, shots: i.shots.length, link: null }));
  const recent = snapRecent(s).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)).map((i) => ({ id: i.id, n: s.issues.indexOf(i) + 1, title: i.link.title || i.title, shots: i.shots.length, link: i.link, live: live[i.id] || null }));
  return { pending, recent };
}

const respond = (p, sendResponse) => { p.then((r) => sendResponse(r === undefined ? { ok: true } : r)).catch((e) => sendResponse({ error: String(e && e.message || e), needsPermission: !!(e && e.needsPermission) })); return true; };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  if (msg.target === 'bg' && msg.type === 'mic:levels') {
    if (micTabId != null) chrome.tabs.sendMessage(micTabId, { type: 'snap:mic-levels', levels: msg.levels }).catch(() => {});
    return;
  }
  switch (msg.type) {
    case 'snap:capture':
      chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }).then((dataUrl) => sendResponse({ dataUrl })).catch((e) => sendResponse({ error: String(e && e.message || e) }));
      return true;
    case 'snap:issues': return respond(issuesForPicker(), sendResponse);
    case 'snap:save': return respond(snapSaveShot({ ...msg, shot: { ...msg.shot, tabId: sender.tab && sender.tab.id } }), sendResponse);
    case 'snap:send-issue': return respond(sendIssue(msg.issueId, msg.dest, msg.mode), sendResponse);
    case 'snap:send-pending-board': return respond(sendPendingToBoard(), sendResponse);
    case 'snap:add-to': return respond(addToSent(msg.issueId, msg.shot, msg.force), sendResponse);
    case 'snap:status': return respond(refreshStatus({ silent: true }), sendResponse);
    case 'snap:seen': return respond(markSeen(), sendResponse);
    case 'snap:answer': return respond(requireConnection().then((conn) => studioFetch(conn.origin, '/api/snap/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: msg.sessionId, questionId: msg.questionId, answer: msg.answer, force: !!msg.force }) })).then((r) => refreshStatus({ silent: true }).then(() => r)), sendResponse);
    case 'snap:connect': return respond(connectTo(msg.url), sendResponse);
    case 'snap:disconnect': return respond(snapSetConnection(null), sendResponse);
    case 'snap:connection': return respond(connectionWithBusy(), sendResponse);
    case 'snap:mic-start': return respond(micStart(sender.tab && sender.tab.id), sendResponse);
    case 'snap:mic-stop': return respond(micStop(), sendResponse);
    case 'snap:mic-cancel': return respond(chrome.offscreen.hasDocument().then((h) => h ? chrome.runtime.sendMessage({ target: 'offscreen', type: 'mic:cancel' }) : null), sendResponse);
    case 'snap:transcribe': return respond(transcribe(msg.dataUrl, msg.format), sendResponse);
    case 'snap:capture-active': return respond(chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => startCapture(tabs[0])), sendResponse);
    case 'snap:reload-tab': return respond(chrome.tabs.reload(msg.tabId).then(() => chrome.tabs.update(msg.tabId, { active: true })), sendResponse);
  }
});
