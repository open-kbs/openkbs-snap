// Recent (sent) groups with their live state — rendered the same way in the
// popup and the panel. Needs store.js. Uses window.chrome messaging to bg.
const SNAP_STATE_LABEL = { queued: 'Queued', running: 'Working', awaiting: 'Needs your answer', done: 'Done', failed: 'Failed', stopped: 'Stopped', interrupted: 'Interrupted', board: 'On board', gone: 'Gone' };
const SNAP_STATE_CLASS = { queued: 'chip-muted', running: 'chip-blue', awaiting: 'chip-red', done: 'chip-green', failed: 'chip-red', stopped: 'chip-muted', interrupted: 'chip-amber', board: 'chip-muted', gone: 'chip-muted' };
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function snapRenderRecent(container, issues, live, opts = {}) {
  container.innerHTML = '';
  if (!issues.length) { container.innerHTML = `<div class="recent-empty">${opts.emptyText || 'Nothing sent yet.'}</div>`; return; }
  for (const issue of issues) {
    const l = live[issue.id] || { state: issue.link.kind === 'card' ? 'board' : 'running' };
    const state = l.state || 'running';
    const el = document.createElement('div');
    el.className = 'recent-item' + (state === 'awaiting' ? ' attn' : '');
    const title = escHtml(l.title || issue.link.title || issue.title);
    const openUrl = issue.link.kind === 'chat' ? issue.link.chatUrl : issue.link.cardUrl;
    el.innerHTML = `
      <div class="recent-head">
        <span class="chip ${SNAP_STATE_CLASS[state] || 'chip-muted'}">${SNAP_STATE_LABEL[state] || state}</span>
        <span class="recent-title" title="${title}">${title}</span>
        <span class="recent-kind faint">${issue.link.kind === 'card' ? 'card' : 'chat'}${l.columnName ? ' · ' + escHtml(l.columnName) : ''}</span>
      </div>
      <div class="recent-body" hidden></div>`;
    const body = el.querySelector('.recent-body');
    const render = () => {
      let html = '';
      if (state === 'awaiting' && l.question) {
        html += `<div class="q-text">${escHtml(l.question.text)}</div>`;
        if (l.question.options && l.question.options.length) html += `<div class="q-opts">${l.question.options.map((o, i) => `<button class="btn btn-sm" data-answer="${escHtml(o.label)}" title="${escHtml(o.description || '')}">${escHtml(o.label)}</button>`).join('')}</div>`;
        html += `<div class="row q-free"><input class="q-input" placeholder="Or type an answer…"><button class="btn btn-sm btn-primary q-send">Send</button></div>`;
      } else if (l.summary) html += `<div class="summary">${escHtml(l.summary)}</div>`;
      else if (l.error) html += `<div class="summary err">${escHtml(l.error)}</div>`;
      else if (state === 'queued') html += `<div class="summary faint">Starts when the project is free.</div>`;
      html += `<div class="row recent-actions">${openUrl ? `<a class="btn btn-sm" href="${escHtml(openUrl)}" target="_blank" rel="noopener">Open ${issue.link.kind === 'card' ? 'card' : 'chat'}</a>` : ''}${issue.capturedTabId ? `<button class="btn btn-sm reload">Reload tab</button>` : ''}<span class="grow"></span><span class="q-msg faint"></span></div>`;
      body.innerHTML = html;
      const answer = async (text, force) => {
        const m = body.querySelector('.q-msg'); m.textContent = 'Sending…';
        const r = await chrome.runtime.sendMessage({ type: 'snap:answer', sessionId: issue.link.sessionId, questionId: l.question.questionId, answer: text, force: !!force });
        if (!r || r.error) { m.textContent = r && r.error || 'failed'; return; }
        if (r.result === 'held') { m.innerHTML = `Held: another chat is working. <button class="btn btn-sm q-force">Send anyway</button>`; body.querySelector('.q-force').onclick = () => answer(text, true); return; }
        m.textContent = r.result === 'none' ? 'Question is no longer open.' : 'Answered';
        if (opts.onChanged) opts.onChanged();
      };
      body.querySelectorAll('[data-answer]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.answer)));
      const inp = body.querySelector('.q-input'), send = body.querySelector('.q-send');
      if (send) { send.addEventListener('click', () => inp.value.trim() && answer(inp.value.trim())); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) answer(inp.value.trim()); }); }
      const rl = body.querySelector('.reload');
      if (rl) rl.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'snap:reload-tab', tabId: issue.capturedTabId }));
    };
    el.querySelector('.recent-head').addEventListener('click', () => { body.hidden = !body.hidden; if (!body.hidden) render(); });
    if (state === 'awaiting' && opts.expandQuestions) { body.hidden = false; render(); }
    container.appendChild(el);
  }
}
