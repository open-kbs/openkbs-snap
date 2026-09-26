const msg = (t, cls) => { const m = document.getElementById('msg'); m.textContent = t; m.className = 'msg ' + (cls || ''); };
document.getElementById('ask').addEventListener('click', async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    msg('Microphone allowed. You can close this tab and press the mic button again.', 'ok');
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    msg(e.name === 'NotAllowedError' ? 'Access was blocked. Click the lock/camera icon in the address bar to allow it, then try again.' : (e.message || String(e)), 'err');
  }
});
