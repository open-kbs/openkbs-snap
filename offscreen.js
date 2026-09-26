// Offscreen document: records microphone audio for dictation. Runs under the
// extension origin, so the mic permission is granted once (mic-permission.html)
// and works on every page, regardless of the page's own permissions policy.
let rec = null, chunks = [], stream = null, mime = '';

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'mic:start') { start().then(() => send({ ok: true })).catch((e) => send({ error: e.name === 'NotAllowedError' ? 'permission' : (e.message || String(e)) })); return true; }
  if (msg.type === 'mic:stop') { stop().then((r) => send(r)).catch((e) => send({ error: e.message || String(e) })); return true; }
  if (msg.type === 'mic:cancel') { cancel(); send({ ok: true }); }
});

async function start() {
  if (rec) cancel();
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(250);
}

function stop() {
  return new Promise((resolve, reject) => {
    if (!rec) return reject(new Error('not recording'));
    const r = rec;
    r.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: r.mimeType || mime || 'audio/webm' });
        const format = /ogg/.test(blob.type) ? 'ogg' : /mp4/.test(blob.type) ? 'mp4' : 'webm';
        const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
        resolve({ dataUrl, format, bytes: blob.size });
      } catch (e) { reject(e); }
      finally { cleanup(); }
    };
    r.stop();
  });
}

function cancel() { try { rec && rec.state !== 'inactive' && rec.stop(); } catch {} cleanup(); }
function cleanup() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; rec = null; chunks = []; }
