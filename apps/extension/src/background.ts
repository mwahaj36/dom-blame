const MAIN_SCRIPT_ID = 'dom-blame-main-world';
const RELAY_SCRIPT_ID = 'dom-blame-isolated-relay';

async function setAutoInject(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ autoInject: enabled });
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: [MAIN_SCRIPT_ID, RELAY_SCRIPT_ID],
    });
  } catch {
    // Ignore if not previously registered
  }

  if (enabled) {
    await chrome.scripting.registerContentScripts([
      {
        id: MAIN_SCRIPT_ID,
        matches: ['<all_urls>'],
        js: ['dom-blame.iife.js'],
        runAt: 'document_start',
        world: 'MAIN',
      },
      {
        id: RELAY_SCRIPT_ID,
        matches: ['<all_urls>'],
        js: ['relay.js'],
        runAt: 'document_start',
        world: 'ISOLATED',
      },
    ]);
  }
}

async function ensureInjected(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['dom-blame.iife.js'],
    world: 'MAIN',
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['relay.js'],
    world: 'ISOLATED',
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ENSURE_INJECTED' && typeof message.tabId === 'number') {
    ensureInjected(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (message?.type === 'SET_AUTO_INJECT') {
    setAutoInject(Boolean(message.enabled))
      .then(() => sendResponse({ ok: true, enabled: Boolean(message.enabled) }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  return false;
});
