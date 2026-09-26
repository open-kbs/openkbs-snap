importScripts('lib/store.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'open-panel', title: 'Open Snap panel', contexts: ['action'] });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  refreshBadge();
});

chrome.action.onClicked.addListener((tab) => startCapture(tab));
chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'capture') startCapture(tab);
  if (cmd === 'open-panel') openPanel(tab);
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open-panel') openPanel(tab);
});

async function openPanel(tab) {
  try {
    if (tab && tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) { console.warn('sidePanel.open failed', e); }
}

async function startCapture(tab) {
  if (!tab || !tab.id) return;
  if (!/^https?:|^file:/.test(tab.url || '')) {
    console.warn('Snap: cannot capture this page', tab.url);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'snap:start' });
  } catch {
    // Content script not present (extension installed after the page loaded). Inject and retry.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'snap:start' });
  }
}

async function refreshBadge() {
  const s = await snapGetSession();
  const n = snapShotCount(s);
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });
}

chrome.storage.onChanged.addListener((changes) => { if (changes.session) refreshBadge(); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'snap:capture') {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((e) => sendResponse({ error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'snap:issues') {
    snapGetSession().then((s) => sendResponse({
      issues: s.issues.map((i, idx) => ({ id: i.id, n: idx + 1, title: i.title, shots: i.shots.length })),
    }));
    return true;
  }
  if (msg.type === 'snap:save') {
    snapSaveShot(msg).then(sendResponse).catch((e) => sendResponse({ error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'snap:capture-active') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
      .then((tabs) => startCapture(tabs[0]))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: String(e && e.message || e) }));
    return true;
  }
});
