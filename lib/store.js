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

async function snapClearSession() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('img:') || k.startsWith('raw:'));
  if (keys.length) await chrome.storage.local.remove(keys);
  await snapSetSession(snapNewSession());
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
const SNAP_TRANSCRIBE_MODELS = [
  { id: 'gemini-3.5-transcribe', label: 'Google · Gemini 3.5 Transcribe' },
  { id: 'gpt-4o-transcribe', label: 'OpenAI · GPT-4o Transcribe' },
  { id: 'gemini-flash-latest', label: 'Google · Gemini Flash' },
];
async function snapGetSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { transcribeModel: SNAP_TRANSCRIBE_MODELS[0].id, ...(settings || {}) };
}
async function snapSetSettings(patch) {
  const cur = await snapGetSettings();
  await chrome.storage.local.set({ settings: { ...cur, ...patch } });
}
