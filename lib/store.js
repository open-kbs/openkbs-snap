// Shared storage helpers (plain globals; loaded by bg.js via importScripts and by panel.html via <script>).
function snapUid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function snapNewSession() {
  return { id: snapUid(), name: '', createdAt: new Date().toISOString(), issues: [] };
}

async function snapGetSession() {
  const { session } = await chrome.storage.local.get('session');
  return session || snapNewSession();
}

async function snapSetSession(session) {
  await chrome.storage.local.set({ session });
}

async function snapSaveShot({ issueId, newIssue, shot, png }) {
  const s = await snapGetSession();
  let issue = issueId ? s.issues.find((i) => i.id === issueId) : null;
  if (!issue) {
    issue = {
      id: snapUid(),
      title: (newIssue && newIssue.title) || `Issue ${s.issues.length + 1}`,
      type: (newIssue && newIssue.type) || 'bug',
      priority: (newIssue && newIssue.priority) || 'medium',
      expected: (newIssue && newIssue.expected) || '',
      notes: '',
      createdAt: new Date().toISOString(),
      shots: [],
    };
    s.issues.push(issue);
  }
  const id = snapUid();
  issue.shots.push({ id, note: shot.note || '', context: shot.context, vectors: shot.vectors || [], createdAt: new Date().toISOString() });
  if (shot.tabId) issue.capturedTabId = shot.tabId;
  await chrome.storage.local.set({ ['img:' + id]: png, session: s });
  return { issueId: issue.id, shotId: id, issueIndex: s.issues.indexOf(issue) + 1, shotIndex: issue.shots.length, issueTitle: issue.title };
}

async function snapDeleteShot(issueId, shotId) {
  const s = await snapGetSession();
  const issue = s.issues.find((i) => i.id === issueId);
  if (!issue) return;
  issue.shots = issue.shots.filter((x) => x.id !== shotId);
  await chrome.storage.local.remove(['img:' + shotId]);
  await snapSetSession(s);
}

async function snapDeleteIssue(issueId) {
  const s = await snapGetSession();
  const issue = s.issues.find((i) => i.id === issueId);
  if (!issue) return;
  const keys = issue.shots.map((x) => 'img:' + x.id);
  if (keys.length) await chrome.storage.local.remove(keys);
  s.issues = s.issues.filter((i) => i.id !== issueId);
  await snapSetSession(s);
}

// Clears PENDING groups (and their local images); sent groups stay in Recent.
async function snapClearSession() {
  const s = await snapGetSession();
  const pending = snapPending(s);
  const keys = pending.flatMap((i) => i.shots.map((x) => 'img:' + x.id));
  if (keys.length) await chrome.storage.local.remove(keys);
  s.issues = s.issues.filter((i) => i.link);
  await snapSetSession(s);
}

async function snapGetImages(shotIds) {
  const got = await chrome.storage.local.get(shotIds.map((id) => 'img:' + id));
  const out = {};
  for (const id of shotIds) out[id] = { png: got['img:' + id] };
  return out;
}

function snapShotCount(session) {
  return session.issues.reduce((n, i) => n + i.shots.length, 0);
}
function snapPendingShotCount(session) {
  return snapPending(session).reduce((n, i) => n + i.shots.length, 0);
}

// ── connection to a studio project + settings ───────────────────
// connection: { origin, projectId, title, boardUrl, columns: [{id,name}], connectedAt }
async function snapGetConnection() {
  const { connection } = await chrome.storage.local.get('connection');
  return connection || null;
}
async function snapSetConnection(connection) {
  if (connection) await chrome.storage.local.set({ connection });
  else await chrome.storage.local.remove('connection');
}
const SNAP_TRANSCRIBE_LANGS = [
  { id: 'auto', label: 'Auto-detect' }, { id: 'bg', label: 'Български' }, { id: 'en', label: 'English' }, { id: 'ro', label: 'Română' },
  { id: 'el', label: 'Ελληνικά' }, { id: 'it', label: 'Italiano' }, { id: 'es', label: 'Español' }, { id: 'ar', label: 'العربية' },
  { id: 'de', label: 'Deutsch' }, { id: 'fr', label: 'Français' }, { id: 'tr', label: 'Türkçe' }, { id: 'ru', label: 'Русский' }, { id: 'uk', label: 'Українська' },
];
const SNAP_TRANSCRIBE_MODELS = [
  { id: 'gemini-3.5-transcribe', label: 'Google · Gemini 3.5 Transcribe' },
  { id: 'gpt-4o-transcribe', label: 'OpenAI · GPT-4o Transcribe' },
  { id: 'gemini-flash-latest', label: 'Google · Gemini Flash' },
];
// Settings: global defaults, overridden per connected project (the plugin is
// used across many projects — a Bulgarian project and an English one keep
// their own dictation language and engine). `projectSettings[projectId]`.
const SNAP_DEFAULT_SETTINGS = { transcribeModel: SNAP_TRANSCRIBE_MODELS[0].id, transcribeLanguage: 'auto', autoDictate: false };
async function snapGetSettings() {
  const { settings, projectSettings, connection } = await chrome.storage.local.get(['settings', 'projectSettings', 'connection']);
  const perProject = connection && projectSettings ? projectSettings[connection.projectId] : null;
  return { ...SNAP_DEFAULT_SETTINGS, ...(settings || {}), ...(perProject || {}) };
}
async function snapSetSettings(patch) {
  const { settings, projectSettings, connection } = await chrome.storage.local.get(['settings', 'projectSettings', 'connection']);
  if (connection) {
    const all = projectSettings || {};
    all[connection.projectId] = { ...(all[connection.projectId] || {}), ...patch };
    await chrome.storage.local.set({ projectSettings: all });
  } else {
    await chrome.storage.local.set({ settings: { ...(settings || {}), ...patch } });
  }
}

// ── groups: pending (local) vs sent (linked to a card or a chat) ──
// issue.link = null | { kind:'card', cardId, cardUrl, title } | { kind:'chat', sessionId, title }
const SNAP_RECENT_MS = 24 * 60 * 60 * 1000;
function snapPending(session) { return session.issues.filter((i) => !i.link); }
function snapRecent(session) {
  const cutoff = Date.now() - SNAP_RECENT_MS;
  return session.issues.filter((i) => i.link && (Date.parse(i.sentAt || 0) || 0) >= cutoff);
}
async function snapMarkSent(issueId, link) {
  const s = await snapGetSession();
  const issue = s.issues.find((i) => i.id === issueId);
  if (!issue) return null;
  issue.link = link;
  issue.sentAt = new Date().toISOString();
  // The screenshots now live in the studio; drop the local copies.
  const keys = issue.shots.filter((x) => !x.uploaded).map((x) => 'img:' + x.id);
  for (const x of issue.shots) x.uploaded = true;
  if (keys.length) await chrome.storage.local.remove(keys);
  await snapSetSession(s);
  return issue;
}
async function snapClearRecent() {
  const s = await snapGetSession();
  s.issues = s.issues.filter((i) => !i.link);
  await snapSetSession(s);
}
// Live state per sent group, refreshed by the background poll: { [issueId]: {...} }
async function snapGetLive() { const { live } = await chrome.storage.local.get('live'); return live || {}; }
async function snapSetLive(live) { await chrome.storage.local.set({ live }); }
