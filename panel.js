const $ = (s, r = document) => r.querySelector(s);
let session = null;
let busy = null;

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function load() { session = await snapGetSession(); await render(); }

async function render() {
  const conn = await snapGetConnection();
  const live = await snapGetLive();
  const pending = snapPending(session), recent = snapRecent(session).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  $('#projectName').textContent = conn ? (conn.title || conn.projectId) : 'Snap';
  $('#send').hidden = !conn || !pending.length;
  $('#pendingWrap').hidden = !pending.length;
  $('#recentWrap').hidden = !recent.length;
  $('#empty').hidden = pending.length > 0 || recent.length > 0;
  $('#pendingCount').textContent = `${pending.length}`;
  $('#export').disabled = !pending.length; $('#clearPending').disabled = !pending.length; $('#clearRecent').disabled = !recent.length;

  const ours = recent.filter((i) => i.link.kind === 'chat');
  const count = (st) => ours.filter((i) => (live[i.id] || {}).state === st).length;
  const parts = [];
  if (busy) parts.push(`<span><b>${busy.working}</b> working</span>`);
  if (count('queued')) parts.push(`<span><b>${count('queued')}</b> queued</span>`);
  if (count('awaiting')) parts.push(`<span style="color:var(--danger)"><b>${count('awaiting')}</b> waiting for you</span>`);
  $('#liveLine').hidden = !conn || !parts.length; $('#liveLine').innerHTML = parts.join('');

  snapRenderRecent($('#recent'), recent, live, { expandQuestions: true, onChanged: refreshLive });

  const main = $('#issues');
  main.innerHTML = '';
  const ids = pending.flatMap((i) => i.shots.filter((s) => !s.uploaded).map((s) => s.id));
  const imgs = ids.length ? await snapGetImages(ids) : {};
  pending.forEach((issue) => {
    const n = session.issues.indexOf(issue) + 1;
    const el = document.createElement('section');
    el.className = 'issue';
    el.innerHTML = `
      <div class="head"><span class="num">#${n}</span><input class="title" value="${esc(issue.title)}"></div>
      <div class="meta">
        <select class="type">${['bug', 'ux', 'idea', 'question'].map((t) => `<option value="${t}"${issue.type === t ? ' selected' : ''}>${t.toUpperCase()}</option>`).join('')}</select>
        <select class="prio">${['low', 'medium', 'high', 'critical'].map((p) => `<option value="${p}"${issue.priority === p ? ' selected' : ''}>${p}</option>`).join('')}</select>
      </div>
      <label>Expected</label><textarea class="expected" placeholder="Expected behavior">${esc(issue.expected)}</textarea>
      <label>Notes</label><textarea class="notes" placeholder="Free text for the whole group">${esc(issue.notes)}</textarea>
      <label>Screenshots (${issue.shots.length})</label>
      <div class="shots"></div>
      ${conn ? `<div class="dest"><button class="btn btn-sm to-board">To board</button><button class="btn btn-sm btn-primary to-chat">New chat</button></div>` : ''}
      <div class="tools">
        <button class="btn btn-ghost btn-sm btn-text-danger del">Delete</button>
      </div>`;
    const bind = (sel, key) => $(sel, el).addEventListener('change', async (e) => { issue[key] = e.target.value; await snapSetSession(session); });
    bind('.title', 'title'); bind('.type', 'type'); bind('.prio', 'priority'); bind('.expected', 'expected'); bind('.notes', 'notes');
    $('.del', el).addEventListener('click', async (e) => {
      if (e.target.dataset.armed) { await snapDeleteIssue(issue.id); await load(); return; }
      e.target.dataset.armed = '1'; e.target.textContent = 'Confirm delete';
      setTimeout(() => { delete e.target.dataset.armed; e.target.textContent = 'Delete'; }, 2500);
    });
    const sendIt = async (dest, btn) => {
      btn.disabled = true; const t = btn.textContent; btn.textContent = 'Sending…';
      const r = await chrome.runtime.sendMessage({ type: 'snap:send-issue', issueId: issue.id, dest, mode: 'queue' });
      if (r && r.error) { btn.disabled = false; btn.textContent = t; toast(r.error); return; }
      toast(dest === 'board' ? `Card created: «${r.link.title}»` : (r.live.state === 'queued' ? `Chat queued: «${r.link.title}»` : `Chat started: «${r.link.title}»`));
      await load();
    };
    const tb = $('.to-board', el), tc = $('.to-chat', el);
    if (tb) tb.addEventListener('click', () => sendIt('board', tb));
    if (tc) tc.addEventListener('click', () => sendIt('chat', tc));

    const shotsEl = $('.shots', el);
    issue.shots.forEach((shot, si) => {
      const c = shot.context || {};
      const s = document.createElement('div');
      s.className = 'shot';
      const png = imgs[shot.id] && imgs[shot.id].png;
      s.innerHTML = `
        <img src="${png || ''}" alt="">
        <div class="body">
          <textarea class="note" placeholder="Note for this screenshot">${esc(shot.note)}</textarea>
          <div class="ctx">${esc(snapShortUrl(c.url))}${c.viewport ? ` · ${c.viewport.width}×${c.viewport.height} @${c.dpr}x` : ''}${c.selector ? ` · <code>${esc(c.selector)}</code>` : ''}${c.consoleErrors && c.consoleErrors.length ? ` · ${c.consoleErrors.length} console error(s)` : ''}</div>
          <div class="foot"><span class="idx">${n}.${si + 1} · ${(shot.createdAt || '').slice(11, 16)}</span><button class="btn btn-ghost btn-sm btn-text-danger delshot">Remove</button></div>
        </div>`;
      $('.note', s).addEventListener('change', async (e) => { shot.note = e.target.value; await snapSetSession(session); });
      $('img', s).addEventListener('click', () => { if (png) { $('#lightbox img').src = png; $('#lightbox').hidden = false; } });
      $('.delshot', s).addEventListener('click', async () => { await snapDeleteShot(issue.id, shot.id); await load(); });
      shotsEl.appendChild(s);
    });
    main.appendChild(el);
  });
}

async function refreshLive() {
  const r = await chrome.runtime.sendMessage({ type: 'snap:status' });
  if (r && !r.error) busy = r.busy;
  await render();
}

function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2500); }

$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });
$('#capture').addEventListener('click', async () => { const res = await chrome.runtime.sendMessage({ type: 'snap:capture-active' }); if (res && res.error) toast('Cannot capture: ' + res.error); });
$('#send').addEventListener('click', async () => {
  $('#send').disabled = true; $('#send').textContent = 'Sending…';
  const r = await chrome.runtime.sendMessage({ type: 'snap:send-pending-board' });
  $('#send').textContent = 'Send pending to board'; $('#send').disabled = false;
  if (r && r.error) { toast(r.error); return; }
  toast(`${r.count} card(s) on the board`);
  await load();
});
$('#refresh').addEventListener('click', refreshLive);
$('#more').addEventListener('click', (e) => { e.stopPropagation(); $('#moreMenu').hidden = !$('#moreMenu').hidden; });
document.addEventListener('click', () => { $('#moreMenu').hidden = true; });
$('#export').addEventListener('click', async () => { $('#moreMenu').hidden = true; const r = await snapExportZip(); toast(r.error ? r.error : `Exported ${r.files} files → ${r.filename}`); });
$('#clearPending').addEventListener('click', async () => { $('#moreMenu').hidden = true; await snapClearSession(); await load(); toast('Pending cleared'); });
$('#clearRecent').addEventListener('click', async () => { $('#moreMenu').hidden = true; await snapClearRecent(); await snapSetLive({}); await load(); toast('Recent cleared'); });

chrome.storage.onChanged.addListener((ch) => { if (ch.session || ch.live) load(); });
(async () => { await load(); const c = await chrome.runtime.sendMessage({ type: 'snap:connection' }); if (c && c.busy) busy = c.busy; await refreshLive(); })();
