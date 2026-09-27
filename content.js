// OpenKBS Snap content script: area selection → crop → annotate → save into an issue.
(() => {
  // One live instance per page. After the extension is reloaded (update, dev
  // reload) the old instance is still here with a dead runtime: it can never
  // receive a message again, so a new instance takes over instead of bailing.
  const prev = window.__openkbsSnap;
  if (prev && typeof prev.alive === 'function' && prev.alive()) return;
  if (prev && typeof prev.teardown === 'function') { try { prev.teardown(); } catch {} }
  for (const el of document.querySelectorAll('[data-openkbs-snap]')) el.remove();

  const Z = 2147483647;
  let host = null, shadow = null, busy = false;

  window.__openkbsSnap = {
    alive: () => { try { return !!chrome.runtime && !!chrome.runtime.id; } catch { return false; } },
    teardown: () => teardown(),
  };

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg.type === 'snap:start') {
      // A stuck flag with nothing on screen (an earlier flow died mid-way) must
      // not block every further capture until a page refresh.
      if (busy && !host) busy = false;
      startSelect(); send({ ok: true });
    }
  });

  function mount(html) {
    teardown();
    host = document.createElement('div');
    host.setAttribute('data-openkbs-snap', '');
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:${Z};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;`;
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = html;
    // Keep page-level keyboard shortcuts (Gmail, Slack, the studio…) from firing while we are open.
    for (const t of ['keydown', 'keyup', 'keypress']) host.addEventListener(t, (e) => e.stopPropagation());
    document.documentElement.appendChild(host);
    return shadow;
  }
  function teardown() { if (host) { host.remove(); host = null; shadow = null; } }

  function toast(text, ms = 2500) {
    const el = document.createElement('div');
    el.setAttribute('data-openkbs-snap', '');
    el.textContent = text;
    el.style.cssText = `all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:${Z};background:#111;color:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:10px 16px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.3);max-width:70vw;`;
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---------- selection ----------
  function startSelect() {
    if (busy) return;
    busy = true;
    const sh = mount(`
      <style>
        .dim{position:fixed;inset:0;background:rgba(17,24,39,.18);cursor:crosshair}
        .sel{position:fixed;border:2px solid #3D85C9;box-shadow:0 0 0 9999px rgba(17,24,39,.4);display:none;pointer-events:none;box-sizing:border-box;border-radius:2px}
        .hint{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(27,31,36,.92);color:#fff;font-size:12px;padding:6px 12px;border-radius:6px;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.25);transition:opacity .25s} .hint.off{opacity:0} .hint kbd{padding:0 4px;border:1px solid rgba(255,255,255,.3);border-radius:3px;font:11px ui-monospace,Menlo,monospace}
      </style>
      <div class="dim"></div><div class="sel"></div>
      <div class="hint">Drag to select the area to capture &nbsp;·&nbsp; <kbd>Esc</kbd> cancel</div>`);
    const dim = sh.querySelector('.dim'), sel = sh.querySelector('.sel'), hint = sh.querySelector('.hint');
    const hideHint = () => hint.classList.add('off');
    setTimeout(hideHint, 2000);
    let start = null, rect = null;
    const onKey = (e) => { if (e.key === 'Escape') { cleanup(); teardown(); busy = false; } };
    const cleanup = () => window.removeEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onKey, true);

    dim.addEventListener('mousedown', (e) => {
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      hideHint();
      dim.style.background = 'transparent';
      sel.style.display = 'block';
      update(e);
    });
    const update = (e) => {
      if (!start) return;
      const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
      const w = Math.abs(e.clientX - start.x), h = Math.abs(e.clientY - start.y);
      rect = { x, y, w, h };
      Object.assign(sel.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    };
    dim.addEventListener('mousemove', update);
    dim.addEventListener('mouseup', async (e) => {
      update(e);
      cleanup();
      if (!rect || rect.w < 8 || rect.h < 8) { teardown(); busy = false; toast('Selection too small'); return; }
      try { await finish(rect); } catch (err) { console.error('Snap:', err); toast('Snap failed: ' + (err && err.message || err)); busy = false; teardown(); }
    });
  }

  async function finish(rect) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    host.style.display = 'none';
    const el = document.elementFromPoint(cx, cy);
    const context = collectContext(rect, el);
    teardown();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const res = await chrome.runtime.sendMessage({ type: 'snap:capture' });
    if (!res || res.error) throw new Error(res && res.error || 'no response from background');
    const img = await loadImage(res.dataUrl);
    const sx = img.naturalWidth / window.innerWidth, sy = img.naturalHeight / window.innerHeight;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(rect.w * sx));
    c.height = Math.max(1, Math.round(rect.h * sy));
    c.getContext('2d').drawImage(img, rect.x * sx, rect.y * sy, rect.w * sx, rect.h * sy, 0, 0, c.width, c.height);
    const picker = (await chrome.runtime.sendMessage({ type: 'snap:issues' })) || {};
    const connInfo = (await chrome.runtime.sendMessage({ type: 'snap:connection' })) || {};
    openEditor(c, context, { pending: picker.pending || [], recent: picker.recent || [] }, sx, connInfo.connection || null, connInfo.busy || null);
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  // ---------- context ----------
  function collectContext(rect, el) {
    let errors = [];
    try {
      const h = (e) => { try { errors = JSON.parse(e.detail || '[]'); } catch {} };
      window.addEventListener('openkbs-snap:errors', h, { once: true });
      window.dispatchEvent(new Event('openkbs-snap:get-errors'));
      window.removeEventListener('openkbs-snap:errors', h);
    } catch {}
    const now = Date.now();
    errors = errors.filter((e) => now - e.t <= 60000).slice(-20)
      .map((e) => ({ level: e.level, secondsAgo: Math.round((now - e.t) / 1000), msg: e.msg }));
    return {
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dpr: window.devicePixelRatio,
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      userAgent: navigator.userAgent,
      rect,
      selector: el ? cssPath(el) : null,
      elementHtml: el ? el.outerHTML.slice(0, 600) : null,
      consoleErrors: errors,
    };
  }

  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      if (el.id && !/\d{3,}/.test(el.id)) { parts.unshift('#' + CSS.escape(el.id)); break; }
      let s = el.tagName.toLowerCase();
      const cls = [...el.classList].filter((c) => !/^(is-|has-|active|hover|focus)|\d{3,}|[:\[\]]/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const p = el.parentElement;
      if (p) {
        const sib = [...p.children].filter((x) => x.tagName === el.tagName);
        if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(el) + 1})`;
      }
      parts.unshift(s);
      el = p;
    }
    return parts.join(' > ');
  }

  // ---------- editor ----------
  function openEditor(base, context, issues, sx, connection, busy) {
    const W = base.width, H = base.height;
    const SIDE = 320;
    const maxW = Math.max(240, window.innerWidth * 0.94 - SIDE - 48);
    const maxH = Math.max(200, window.innerHeight * 0.9 - 110);
    const f = Math.min(maxW / W, maxH / H, 1);
    const lw = Math.max(3, Math.round(3 * sx));
    const fontSize = Math.round(18 * sx);

    const ICON = {
      pen: '<svg viewBox="0 0 16 16"><path d="M11.5 2.5l2 2L5 13H3v-2z"/><path d="M10 4l2 2"/></svg>',
      rect: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1"/></svg>',
      arrow: '<svg viewBox="0 0 16 16"><path d="M3 13L13 3M7 3h6v6"/></svg>',
      text: '<svg viewBox="0 0 16 16"><path d="M3 4h10M8 4v9M6 13h4"/></svg>',
      undo: '<svg viewBox="0 0 16 16"><path d="M6 4L3 7l3 3"/><path d="M3 7h6a4 4 0 0 1 0 8H7"/></svg>',
      trash: '<svg viewBox="0 0 16 16"><path d="M3 4h10M6 4V2.5h4V4M5 4l.6 9h4.8L11 4"/></svg>',
    };
    const sh = mount(`
      <style>
        *{box-sizing:border-box}
        :host{--brand:#3D85C9;--brand-hover:#2F6FAE;--text:#1B1F24;--muted:#6B7280;--faint:#9CA3AF;--border:#E5E7EB;--border-strong:#D1D5DB;--bg:#fff;--surface:#F6F7F9;--surface-2:#EEF0F3;--danger:#B42318}
        .bg{position:fixed;inset:0;background:rgba(17,24,39,.6);backdrop-filter:blur(2px)}
        .modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:var(--bg);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.35);display:flex;flex-direction:column;max-width:96vw;max-height:94vh;color:var(--text);font-size:13px;line-height:1.45;overflow:hidden}
        .hd{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)}
        .hd img{width:18px;height:18px}
        .hd h1{font-size:13px;font-weight:600;margin:0}
        .hd .hint{margin-left:auto;font-size:11px;color:var(--faint)}
        .hd kbd{display:inline-block;padding:0 4px;border:1px solid var(--border);border-bottom-width:2px;border-radius:3px;background:var(--surface);color:var(--muted);font:10px/16px ui-monospace,Menlo,monospace}
        .tb{display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--surface);border-bottom:1px solid var(--border)}
        .seg{display:inline-flex;background:var(--bg);border:1px solid var(--border-strong);border-radius:7px;padding:2px;gap:2px}
        .seg button{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:0;border-radius:5px;background:transparent;color:var(--muted);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
        .seg button:hover{background:var(--surface);color:var(--text)}
        .seg button.on{background:var(--brand);color:#fff}
        .seg svg,.ghost svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
        .colors{display:inline-flex;gap:6px;align-items:center;padding:0 4px}
        .colors i{display:inline-block;width:18px;height:18px;border-radius:50%;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
        .colors i.on{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--text)}
        .ghost{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--muted);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
        .ghost:hover{background:var(--bg);border-color:var(--border);color:var(--text)}
        .grow{flex:1}
        .body{display:flex;min-height:0}
        .cv-wrap{position:relative;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--surface-2);background-image:linear-gradient(45deg,#E3E6EA 25%,transparent 25%,transparent 75%,#E3E6EA 75%),linear-gradient(45deg,#E3E6EA 25%,transparent 25%,transparent 75%,#E3E6EA 75%);background-size:16px 16px;background-position:0 0,8px 8px}
        canvas{display:block;cursor:crosshair;box-shadow:0 4px 18px rgba(0,0,0,.22);touch-action:none;border-radius:2px}
        .txt-in{position:absolute;border:1px dashed var(--danger);background:rgba(255,255,255,.95);font-weight:700;padding:2px 4px;outline:none;color:var(--danger);border-radius:3px}
        .side{width:${SIDE}px;padding:14px;display:flex;flex-direction:column;gap:4px;border-left:1px solid var(--border);overflow:auto;background:var(--bg)}
        label{display:block;font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--muted);margin:8px 0 3px}
        label:first-child{margin-top:0}
        input,select,textarea{width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 9px;font:inherit;color:var(--text);background:var(--bg);outline:none}
        input:focus,select:focus,textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(61,133,201,.18)}
        input::placeholder,textarea::placeholder{color:var(--faint)}
        textarea{resize:vertical;min-height:60px}
        textarea.note{min-height:96px;max-height:40vh;overflow-y:auto;resize:none;line-height:1.45}
        .row{display:flex;gap:6px}
        .new-issue{display:none;flex-direction:column;gap:6px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-top:6px}
        .new-issue.show{display:flex}
        .ctx{font-size:11px;color:var(--muted);line-height:1.5;word-break:break-all;margin-top:auto;padding-top:10px;border-top:1px solid var(--border)}
        .ctx b{color:var(--text);font-weight:600}
        .ctx code{background:var(--surface-2);padding:0 4px;border-radius:3px;font:11px ui-monospace,Menlo,monospace}
        .ctx .warn{color:var(--danger)}
        .actions{display:flex;gap:8px;align-items:center;padding-top:12px}
        .actions .ghost-btn{border-color:transparent;color:var(--muted)}
        .actions .ghost-btn:hover{background:var(--surface);color:var(--text)}
        .busy-hint{font-size:11px;color:var(--muted);padding-top:8px;line-height:1.45}
        .busy-hint b{color:var(--text);font-weight:600}
        .busy-hint button{border:1px solid var(--border-strong);background:var(--bg);border-radius:5px;padding:2px 8px;font:inherit;font-size:11px;cursor:pointer;color:var(--text);margin-left:6px}
        .busy-hint button:hover{background:var(--surface)}
        .new-toggle{align-self:flex-start;border:0;background:none;padding:6px 0 0;font:inherit;font-size:11px;color:var(--muted);cursor:pointer}
        .new-toggle:hover{color:var(--text)}
        .new-toggle.open{color:var(--brand)}
        .actions button{height:34px;padding:0 12px;border:1px solid var(--border-strong);background:var(--bg);border-radius:6px;font:inherit;font-weight:500;cursor:pointer;color:var(--text);white-space:nowrap;flex:none}
        .actions button:hover{background:var(--surface)}
        .actions .primary{background:var(--brand);border-color:var(--brand);color:#fff;font-weight:600}
        .actions .primary:hover{background:var(--brand-hover)}
        .actions .primary:disabled{opacity:.6}
        .err{color:var(--danger);font-size:12px;display:none;padding-top:6px}
        .note-label{display:flex;align-items:center;justify-content:space-between}
        .mic{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border:1px solid var(--border-strong);border-radius:11px;background:var(--bg);color:var(--text);font:inherit;font-size:11px;font-weight:600;cursor:pointer;text-transform:none;letter-spacing:0}
        .mic svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
        .mic:hover{background:var(--surface)}
        .mic.rec{background:var(--danger);border-color:var(--danger);color:#fff;animation:snapPulse 1.2s ease-in-out infinite}
        .mic.busy{cursor:progress;background:var(--brand-soft, #EAF2FA);border-color:var(--brand);color:var(--brand)}
        .mic.busy svg{display:none}
        .mic.busy::before{content:'';width:11px;height:11px;border:2px solid var(--brand);border-top-color:transparent;border-radius:50%;animation:snapSpin .8s linear infinite;flex:none}
        @keyframes snapSpin{to{transform:rotate(360deg)}}
        .mic-status.working{color:var(--brand)}
        .mic-bar{height:3px;border-radius:2px;background:var(--surface-2);overflow:hidden;margin-top:6px;display:none}
        .mic-bar.on{display:block}
        .mic-bar i{display:block;height:100%;width:40%;background:var(--brand);border-radius:2px;animation:snapSlide 1.1s ease-in-out infinite}
        @keyframes snapSlide{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}
        @keyframes snapPulse{0%,100%{box-shadow:0 0 0 0 rgba(180,35,24,.45)}50%{box-shadow:0 0 0 6px rgba(180,35,24,0)}}
        .mic-status{font-size:11px;color:var(--muted);padding-top:4px}
      </style>
      <div class="bg"></div>
      <div class="modal">
        <div class="hd"><img src="${chrome.runtime.getURL('icons/icon-32.png')}" alt=""><h1>Annotate screenshot</h1><span class="hint"><kbd>Esc</kbd> cancel &nbsp; <kbd>⌘</kbd><kbd>↵</kbd> send to AI &nbsp; <kbd>⌘</kbd><kbd>⇧</kbd><kbd>↵</kbd> send to Board</span></div>
        <div class="tb">
          <div class="seg">
            <button data-tool="pen" class="on">${ICON.pen}Pen</button>
            <button data-tool="rect">${ICON.rect}Box</button>
            <button data-tool="arrow">${ICON.arrow}Arrow</button>
            <button data-tool="text">${ICON.text}Text</button>
          </div>
          <span class="colors"><i data-c="#E5484D" class="on" style="background:#E5484D"></i><i data-c="#F5A524" style="background:#F5A524"></i><i data-c="#3D85C9" style="background:#3D85C9"></i><i data-c="#17A34A" style="background:#17A34A"></i><i data-c="#1B1F24" style="background:#1B1F24"></i></span>
          <span class="grow"></span>
          <button class="ghost" data-act="undo">${ICON.undo}Undo</button>
          <button class="ghost" data-act="clear">${ICON.trash}Clear</button>
        </div>
        <div class="body">
          <div class="cv-wrap"><canvas></canvas><input class="txt-in" type="text" placeholder="Type, Enter to place" hidden></div>
          <div class="side">
            <label>Add to</label>
            <select class="dest"></select>
            <button type="button" class="new-toggle">New group options ▸</button>
            <div class="new-issue">
              <input class="title" placeholder="Title (optional)">
              <div class="row">
                <select class="type"><option value="bug">Bug</option><option value="ux">UX</option><option value="idea">Idea</option><option value="question">Question</option></select>
                <select class="prio"><option value="low">Low priority</option><option value="medium" selected>Medium priority</option><option value="high">High priority</option><option value="critical">Critical priority</option></select>
              </div>
              <textarea class="expected" placeholder="Expected behavior"></textarea>
            </div>
            <label class="note-label">Note for this screenshot<button class="mic" type="button" title="Dictate (click to start, click again to stop)" hidden><svg viewBox="0 0 16 16"><rect x="6" y="1.5" width="4" height="8" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5"/></svg><span>Dictate</span></button></label>
            <textarea class="note" placeholder="What is wrong here?"></textarea>
            <div class="mic-bar"><i></i></div>
            <div class="mic-status" hidden></div>
            <div class="err"></div>
            <div class="ctx"></div>
            <div class="busy-hint" hidden></div>
            <div class="actions"><button class="cancel ghost-btn">Cancel</button><span class="grow"></span><button class="btn-b" hidden>Send to Board</button><button class="btn-a primary">Send to AI</button></div>
          </div>
        </div>
      </div>`);

    const q = (s) => sh.querySelector(s);
    const canvas = q('canvas'), ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    canvas.style.width = Math.round(W * f) + 'px';
    canvas.style.height = Math.round(H * f) + 'px';

    // Destination: a new group (sent to a chat or the board, or kept pending),
    // a pending group (local add), or a sent group (follow-up into its chat /
    // more screenshots on its card). Buttons follow the choice.
    const destSel = q('.dest'), newBox = q('.new-issue'), newToggle = q('.new-toggle');
    const btnA = q('.btn-a'), btnB = q('.btn-b'), busyHint = q('.busy-hint');
    const addOpt = (parent, value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; parent.appendChild(o); return o; };
    addOpt(destSel, 'new', connection ? 'New request' : 'New (pending)');
    if (connection) addOpt(destSel, 'new-pending', 'New · keep pending, send later');
    if (issues.pending.length) {
      const g = document.createElement('optgroup'); g.label = 'Pending';
      for (const i of issues.pending) addOpt(g, 'p:' + i.id, `#${i.n} ${i.title} · ${i.shots} ${i.shots === 1 ? 'screenshot' : 'screenshots'}`);
      destSel.appendChild(g);
    }
    if (issues.recent.length) {
      const g = document.createElement('optgroup'); g.label = 'Sent';
      for (const i of issues.recent) {
        const st = i.link.kind === 'card' ? 'on board' : (i.live && i.live.state) || 'chat';
        addOpt(g, 's:' + i.id, `✓ ${i.title} · ${i.link.kind === 'card' ? 'card' : 'chat'}, ${st}`);
      }
      destSel.appendChild(g);
    }
    const findIssue = (id) => issues.pending.find((i) => i.id === id) || issues.recent.find((i) => i.id === id);
    const choice = () => {
      const v = destSel.value;
      if (v === 'new') return { kind: 'new' };
      if (v === 'new-pending') return { kind: 'new-pending' };
      const issue = findIssue(v.slice(2));
      return v.startsWith('p:') ? { kind: 'pending', issue } : { kind: 'sent', issue };
    };
    const busyWorking = connection && busy && busy.working > 0 ? busy : null;
    const busyName = busyWorking ? (busyWorking.chats[0] && busyWorking.chats[0].title) || 'A chat' : '';
    const showHint = (html) => { busyHint.hidden = !html; busyHint.innerHTML = html || ''; };
    const syncButtons = () => {
      const c = choice();
      btnB.hidden = true; btnA.dataset.mode = '';
      newToggle.hidden = !(c.kind === 'new' || c.kind === 'new-pending');
      if (c.kind === 'new' && connection) { btnA.textContent = 'Send to AI'; btnA.dataset.act = 'chat'; btnB.hidden = false; btnB.textContent = 'Send to Board'; }
      else if (c.kind === 'new' || c.kind === 'new-pending') { btnA.textContent = 'Save'; btnA.dataset.act = 'local'; }
      else if (c.kind === 'pending') { btnA.textContent = `Add to #${c.issue.n}`; btnA.dataset.act = 'local'; }
      else { btnA.textContent = `Send to «${(c.issue.title || '').slice(0, 22)}»`; btnA.dataset.act = 'add'; }
      if (c.kind === 'new' && connection && busyWorking) showHint(`<b>${esc(busyName)}</b> is working — the AI will take this when it is free.<button type="button" data-parallel="1">Start anyway</button>`);
      else if (c.kind === 'sent' && c.issue.link.kind === 'chat' && busyWorking && !busyWorking.chats.some((x) => x.sessionId === c.issue.link.sessionId)) showHint(`<b>${esc(busyName)}</b> is working — the follow-up will be held until it is free.`);
      else showHint('');
    };
    destSel.addEventListener('change', syncButtons); syncButtons();
    busyHint.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.parallel) save('chat', { mode: 'parallel' }); if (b.dataset.force) save('add', { force: true }); });
    newToggle.addEventListener('click', () => { const open = newBox.classList.toggle('show'); newToggle.classList.toggle('open', open); newToggle.textContent = open ? 'New group options ▾' : 'New group options ▸'; if (open) q('.title').focus(); });
    q('.title').placeholder = `Issue ${issues.pending.length + issues.recent.length + 1} (rename if you like)`;

    q('.ctx').innerHTML = `<b>${esc(shortUrl(context.url))}</b><br>` +
      `${context.viewport.width}×${context.viewport.height} @${context.dpr}x` +
      (context.selector ? `<br><code>${esc(context.selector)}</code>` : '') +
      (context.consoleErrors.length ? `<br><span class="warn">${context.consoleErrors.length} console error(s) in the last 60 s</span>` : '');

    // drawing state
    let tool = 'pen', color = '#E5484D';
    const shapes = []; let cur = null;
    const redraw = (skipCur) => {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0);
      for (const s of shapes) drawShape(s);
      if (cur && !skipCur) drawShape(cur);
    };
    const drawShape = (s) => {
      ctx.save();
      ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (s.t === 'rect') {
        ctx.strokeRect(s.x, s.y, s.w, s.h);
      } else if (s.t === 'arrow') {
        const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), hl = lw * 4;
        ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2 - hl * Math.cos(ang - Math.PI / 6), s.y2 - hl * Math.sin(ang - Math.PI / 6));
        ctx.lineTo(s.x2 - hl * Math.cos(ang + Math.PI / 6), s.y2 - hl * Math.sin(ang + Math.PI / 6));
        ctx.closePath(); ctx.fill();
      } else if (s.t === 'pen') {
        ctx.beginPath();
        s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      } else if (s.t === 'text') {
        ctx.font = `bold ${s.size}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
        ctx.textBaseline = 'top';
        ctx.lineWidth = Math.max(2, s.size / 5); ctx.strokeStyle = 'rgba(255,255,255,.92)';
        ctx.strokeText(s.text, s.x, s.y); ctx.fillText(s.text, s.x, s.y);
      }
      ctx.restore();
    };
    redraw();

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: Math.max(0, Math.min(W, (e.clientX - r.left) / f)), y: Math.max(0, Math.min(H, (e.clientY - r.top) / f)) };
    };

    // toolbar
    sh.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      tool = b.dataset.tool;
      sh.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
      hideTextInput();
    }));
    sh.querySelectorAll('.colors i').forEach((i) => i.addEventListener('click', () => {
      color = i.dataset.c;
      sh.querySelectorAll('.colors i').forEach((x) => x.classList.toggle('on', x === i));
      txtIn.style.color = color; txtIn.style.borderColor = color;
    }));
    q('[data-act=undo]').addEventListener('click', () => { shapes.pop(); redraw(); });
    q('[data-act=clear]').addEventListener('click', () => { shapes.length = 0; redraw(); });

    // text tool
    const txtIn = q('.txt-in');
    let txtAt = null;
    const showTextInput = (p, e) => {
      txtAt = p;
      const r = canvas.getBoundingClientRect(), wr = q('.cv-wrap').getBoundingClientRect();
      txtIn.hidden = false;
      txtIn.style.left = (r.left - wr.left + p.x * f) + 'px';
      txtIn.style.top = (r.top - wr.top + p.y * f) + 'px';
      txtIn.style.fontSize = Math.max(12, fontSize * f) + 'px';
      txtIn.value = '';
      setTimeout(() => txtIn.focus(), 0);
    };
    const commitText = () => {
      const text = txtIn.value.trim();
      if (text && txtAt) { shapes.push({ t: 'text', x: txtAt.x, y: txtAt.y, text, c: color, size: fontSize }); redraw(); }
      hideTextInput();
    };
    const hideTextInput = () => { txtIn.hidden = true; txtAt = null; };
    txtIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitText(); }
      else if (e.key === 'Escape') { e.preventDefault(); hideTextInput(); }
      e.stopPropagation();
    });
    txtIn.addEventListener('blur', () => { if (!txtIn.hidden) commitText(); });

    // pointer drawing
    let drawing = false;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = pos(e);
      if (tool === 'text') { if (!txtIn.hidden) commitText(); showTextInput(p, e); return; }
      drawing = true; canvas.setPointerCapture(e.pointerId);
      if (tool === 'rect') cur = { t: 'rect', x: p.x, y: p.y, w: 0, h: 0, c: color, _sx: p.x, _sy: p.y };
      else if (tool === 'arrow') cur = { t: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: color };
      else if (tool === 'pen') cur = { t: 'pen', pts: [[p.x, p.y]], c: color };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !cur) return;
      const p = pos(e);
      if (cur.t === 'rect') { cur.x = Math.min(cur._sx, p.x); cur.y = Math.min(cur._sy, p.y); cur.w = Math.abs(p.x - cur._sx); cur.h = Math.abs(p.y - cur._sy); }
      else if (cur.t === 'arrow') { cur.x2 = p.x; cur.y2 = p.y; }
      else if (cur.t === 'pen') cur.pts.push([p.x, p.y]);
      redraw();
    });
    const endDraw = () => {
      if (!drawing || !cur) return;
      drawing = false;
      const ok = (cur.t === 'rect' && cur.w > 2 && cur.h > 2) || (cur.t === 'arrow' && Math.hypot(cur.x2 - cur.x1, cur.y2 - cur.y1) > 4) || (cur.t === 'pen' && cur.pts.length > 1);
      if (ok) { delete cur._sx; delete cur._sy; shapes.push(cur); }
      cur = null; redraw();
    };
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);

    // dictation (only when connected to a project: the studio transcribes)
    const mic = q('.mic'), micStatus = q('.mic-status'), noteEl = q('.note');
    let micState = 'idle', micTimer = null, micT0 = 0;
    if (connection) mic.hidden = false;
    const micBar = q('.mic-bar');
    let workTimer = null;
    const setMicStatus = (text, working) => {
      micStatus.hidden = !text; micStatus.textContent = text || ''; micStatus.classList.toggle('working', !!working);
      micBar.classList.toggle('on', !!working);
      clearInterval(workTimer);
      if (working) { const t0 = Date.now(); workTimer = setInterval(() => { micStatus.textContent = `${text} ${Math.round((Date.now() - t0) / 1000)} s`; }, 500); }
    };
    // The note grows with its content (typing or dictation) up to 40vh, then scrolls.
    const growNote = () => { noteEl.style.height = 'auto'; noteEl.style.height = Math.min(noteEl.scrollHeight + 2, window.innerHeight * 0.4) + 'px'; };
    noteEl.addEventListener('input', growNote);
    const micLabel = (t) => { mic.querySelector('span').textContent = t; };
    const finishMic = () => { micState = 'idle'; mic.classList.remove('busy', 'rec'); micLabel('Dictate'); noteEl.disabled = false; setMicStatus(''); };
    mic.addEventListener('click', async () => {
      if (micState === 'idle') {
        micState = 'starting'; mic.classList.add('busy'); setMicStatus('Starting microphone…', true);
        const r = await chrome.runtime.sendMessage({ type: 'snap:mic-start' });
        mic.classList.remove('busy');
        if (!r || r.error) { micState = 'idle'; setMicStatus(r && r.error || 'Microphone unavailable'); return; }
        micState = 'rec'; mic.classList.add('rec'); micT0 = Date.now(); micLabel('Stop 0:00'); setMicStatus('');
        micTimer = setInterval(() => { const s = Math.round((Date.now() - micT0) / 1000); micLabel(`Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`); }, 500);
        setMicStatus('Listening… click Stop when done.');
      } else if (micState === 'rec') {
        micState = 'busy'; clearInterval(micTimer); mic.classList.remove('rec'); mic.classList.add('busy'); micLabel('Transcribing');
        noteEl.disabled = true;
        setMicStatus('Transcribing, the text will appear in the note…', true);
        const rec = await chrome.runtime.sendMessage({ type: 'snap:mic-stop' });
        if (!rec || rec.error) { finishMic(); setMicStatus(rec && rec.error || 'Recording failed'); return; }
        if (rec.bytes < 1500) { finishMic(); setMicStatus('Too short — nothing recorded.'); return; }
        const t = await chrome.runtime.sendMessage({ type: 'snap:transcribe', dataUrl: rec.dataUrl, format: rec.format });
        finishMic();
        if (!t || t.error) { setMicStatus('Transcription failed: ' + (t && t.error || 'no response')); return; }
        const text = (t.text || '').trim();
        if (!text) { setMicStatus('No speech recognised.'); return; }
        noteEl.value = (noteEl.value.trim() ? noteEl.value.replace(/\s+$/, '') + ' ' : '') + text;
        growNote();
        setMicStatus('');
        noteEl.focus();
        noteEl.setSelectionRange(noteEl.value.length, noteEl.value.length);
      }
    });

    // actions
    const close = () => { if (micState === 'rec') chrome.runtime.sendMessage({ type: 'snap:mic-cancel' }); window.removeEventListener('keydown', onKey, true); teardown(); busy = false; };
    let saving = false;
    const setBusyUi = (on, label) => { saving = on; btnA.disabled = btnB.disabled = on; if (label) btnA.textContent = label; };
    // act: 'local' (pending group), 'chat' / 'board' (new group sent now), 'add' (sent group).
    const save = async (act, o = {}) => {
      if (saving) return;
      const errEl = q('.err'); errEl.style.display = 'none';
      const c = choice();
      if (!txtIn.hidden) commitText();
      redraw(true);
      const png = canvas.toDataURL('image/png');
      const shot = { note: q('.note').value.trim(), context, vectors: shapes };
      const fail = (m) => { errEl.textContent = m; errEl.style.display = 'block'; setBusyUi(false); syncButtons(); };
      try {
        if (act === 'add') {
          setBusyUi(true, 'Sending…');
          const r = await chrome.runtime.sendMessage({ type: 'snap:add-to', issueId: c.issue.id, shot: { ...shot, png }, force: !!o.force });
          if (!r || r.error) return fail('Send failed: ' + (r && r.error || 'no response'));
          if (r.result === 'held') { setBusyUi(false); syncButtons(); showHint(`Held: <b>${esc(busyName || 'another chat')}</b> is working.<button type="button" data-force="1">Send anyway</button>`); return; }
          if (r.result === 'busy') return fail('That chat could not take the message right now. Try again in a moment.');
          close();
          toast(c.issue.link.kind === 'card' ? `Sent to card «${c.issue.title}»` : `Sent to AI: «${c.issue.title}»`);
          return;
        }
        // local save first (new or pending group)
        let issueId = null, newIssue = null;
        if (c.kind === 'pending') issueId = c.issue.id;
        else {
          const title = q('.title').value.trim() || '';
          newIssue = { title: title || `Issue ${issues.pending.length + issues.recent.length + 1}`, type: q('.type').value, priority: q('.prio').value, expected: q('.expected').value.trim() };
        }
        setBusyUi(true, act === 'local' ? 'Saving…' : 'Sending…');
        const res = await chrome.runtime.sendMessage({ type: 'snap:save', issueId, newIssue, png, shot });
        if (!res || res.error) return fail('Save failed: ' + (res && res.error || 'no response'));
        if (act === 'local') { close(); toast(c.kind === 'pending' ? `Added to #${c.issue.n}` : `Saved as pending · ${res.issueTitle}`); return; }
        const r = await chrome.runtime.sendMessage({ type: 'snap:send-issue', issueId: res.issueId, dest: act === 'board' ? 'board' : 'chat', mode: o.mode || 'queue' });
        if (!r || r.error) return fail((act === 'board' ? 'Card' : 'Chat') + ' failed (kept as pending): ' + (r && r.error || 'no response'));
        close();
        if (act === 'board') toast(`Sent to Board: «${r.link.title}»`);
        else toast(r.live.state === 'queued' ? `Sent to AI: «${r.link.title}» — starts when the project is free` : `Sent to AI: «${r.link.title}» — working`);
      } catch (e) { fail(String(e && e.message || e)); }
    };
    q('.cancel').addEventListener('click', close);
    btnA.addEventListener('click', () => save(btnA.dataset.act));
    btnB.addEventListener('click', () => save('board'));
    const onKey = (e) => {
      if (e.key === 'Escape') { if (!txtIn.hidden) { hideTextInput(); return; } close(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (e.shiftKey && !btnB.hidden) save('board'); else save(btnA.dataset.act); }
    };
    window.addEventListener('keydown', onKey, true);
    setTimeout(() => q('.note').focus(), 0);
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function shortUrl(u) { try { const x = new URL(u); return x.host + x.pathname + x.search; } catch { return u; } }
})();
