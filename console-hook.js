// Runs in the page's MAIN world at document_start. Buffers uncaught errors and
// unhandled rejections so a capture can attach "what went wrong in the last minute".
(() => {
  if (window.__openkbsSnapHook) return;
  window.__openkbsSnapHook = true;
  const buf = [];
  const fmt = (a) => {
    try {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') return JSON.stringify(a);
      return String(a);
    } catch { return String(a); }
  };
  const push = (level, msg) => {
    buf.push({ t: Date.now(), level, msg: String(msg).slice(0, 500) });
    if (buf.length > 100) buf.shift();
  };
  // console.error/warn are deliberately NOT wrapped: a wrapper sits in the call
  // stack of every message a page logs, and Chrome then files the page's own
  // warnings under this extension's errors (chrome://extensions) on every site.
  window.addEventListener('error', (e) => push('error', `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => push('error', 'Unhandled rejection: ' + fmt(e.reason)));
  window.addEventListener('openkbs-snap:get-errors', () => {
    window.dispatchEvent(new CustomEvent('openkbs-snap:errors', { detail: JSON.stringify(buf) }));
  });
})();
