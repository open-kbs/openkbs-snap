const $ = (s, r = document) => r.querySelector(s);
let session = null;

async function load() {
  session = await snapGetSession();
  render();
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function render() {
  $('#sessionName').value = session.name || '';
  const shots = snapShotCount(session);
  $('#stats').textContent = `${session.issues.length} issue(s) · ${shots} screenshot(s) · started ${session.createdAt.slice(0, 16).replace('T', ' ')}`;
  $('#empty').hidden = session.issues.length > 0;
  const main = $('#issues');
  main.innerHTML = '';
  const ids = session.issues.flatMap((i) => i.shots.map((s) => s.id));
  const imgs = ids.length ? await snapGetImages(ids) : {};

  session.issues.forEach((issue, ii) => {
    const el = document.createElement('section');
    el.className = 'issue';
    el.innerHTML = `
      <div class="head"><span class="num">#${ii + 1}</span><input class="title" value="${esc(issue.title)}"></div>
      <div class="meta">
        <select class="type">${['bug', 'ux', 'idea', 'question'].map((t) => `<option value="${t}"${issue.type === t ? ' selected' : ''}>${t.toUpperCase()}</option>`).join('')}</select>
        <select class="prio">${['low', 'medium', 'high', 'critical'].map((p) => `<option value="${p}"${issue.priority === p ? ' selected' : ''}>${p}</option>`).join('')}</select>
      </div>
      <label>Expected</label><textarea class="expected" placeholder="Expected behavior">${esc(issue.expected)}</textarea>
      <label>Notes</label><textarea class="notes" placeholder="Free text for the whole issue">${esc(issue.notes)}</textarea>
      <label>Screenshots (${issue.shots.length})</label>
      <div class="shots"></div>
      <div class="tools">
        <button class="btn btn-ghost btn-sm up" title="Move up">↑</button>
        <button class="btn btn-ghost btn-sm down" title="Move down">↓</button>
        <button class="btn btn-ghost btn-sm btn-text-danger del">Delete issue</button>
      </div>`;
    const bind = (sel, key) => $(sel, el).addEventListener('change', async (e) => { issue[key] = e.target.value; await snapSetSession(session); });
    bind('.title', 'title'); bind('.type', 'type'); bind('.prio', 'priority'); bind('.expected', 'expected'); bind('.notes', 'notes');
    $('.up', el).addEventListener('click', () => move(ii, -1));
    $('.down', el).addEventListener('click', () => move(ii, 1));
    $('.del', el).addEventListener('click', async (e) => {
      if (e.target.dataset.armed) { await snapDeleteIssue(issue.id); await load(); return; }
      e.target.dataset.armed = '1'; e.target.textContent = 'Confirm delete';
      setTimeout(() => { delete e.target.dataset.armed; e.target.textContent = 'Delete issue'; }, 2500);
    });

    const shotsEl = $('.shots', el);
    issue.shots.forEach((shot, si) => {
      const c = shot.context || {};
      const s = document.createElement('div');
      s.className = 'shot';
      const png = imgs[shot.id] && imgs[shot.id].png;
      s.innerHTML = `
        <img src="${png || ''}" alt="Screenshot ${ii + 1}.${si + 1}">
        <div class="body">
          <textarea class="note" placeholder="Note for this screenshot">${esc(shot.note)}</textarea>
          <div class="ctx">${esc(snapShortUrl(c.url))}${c.viewport ? ` · ${c.viewport.width}×${c.viewport.height} @${c.dpr}x` : ''}${c.selector ? ` · <code>${esc(c.selector)}</code>` : ''}${c.consoleErrors && c.consoleErrors.length ? ` · ${c.consoleErrors.length} console error(s)` : ''}</div>
          <div class="foot"><span class="idx">${ii + 1}.${si + 1} · ${(shot.createdAt || '').slice(11, 16)}</span><button class="btn btn-ghost btn-sm btn-text-danger delshot">Remove</button></div>
        </div>`;
      $('.note', s).addEventListener('change', async (e) => { shot.note = e.target.value; await snapSetSession(session); });
      $('img', s).addEventListener('click', () => { if (png) { $('#lightbox img').src = png; $('#lightbox').hidden = false; } });
      $('.delshot', s).addEventListener('click', async () => { await snapDeleteShot(issue.id, shot.id); await load(); });
      shotsEl.appendChild(s);
    });
    main.appendChild(el);
  });
}

async function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= session.issues.length) return;
  [session.issues[i], session.issues[j]] = [session.issues[j], session.issues[i]];
  await snapSetSession(session);
  render();
}

function toast(t) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = t;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2500);
}

$('#sessionName').addEventListener('change', async (e) => { session.name = e.target.value.trim(); await snapSetSession(session); });
$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });

$('#capture').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'snap:capture-active' });
  if (res && res.error) toast('Cannot capture: ' + res.error);
});

$('#export').addEventListener('click', async () => {
  const r = await snapExportZip();
  toast(r.error ? r.error : `Exported ${r.files} files → ${r.filename}`);
});

$('#clear').addEventListener('click', () => { $('#confirm').classList.add('show'); });
$('#confirmNo').addEventListener('click', () => { $('#confirm').classList.remove('show'); });
$('#confirmYes').addEventListener('click', async () => {
  $('#confirm').classList.remove('show');
  await snapClearSession(); await load(); toast('Started a new report');
});

chrome.storage.onChanged.addListener((ch) => { if (ch.session) load(); });
load();
