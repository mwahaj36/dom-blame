const flag = '__domBlameRelayInstalled';
const w = window as unknown as Record<string, boolean>;

if (!w[flag]) {
  w[flag] = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.channel !== 'dom-blame-popup') return false;

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onReply);
      sendResponse({ ok: false, error: 'Timed out waiting for dom-blame core' });
    }, 1500);

    function onReply(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== 'dom-blame-core') return;
      if (event.data.requestId && event.data.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', onReply);
      sendResponse({
        ok: true,
        inspectMode: event.data.inspectMode,
        report: event.data.report,
        latestCapsule: event.data.latestCapsule,
      });
    }

    window.addEventListener('message', onReply);
    window.postMessage(
      {
        source: 'dom-blame-relay',
        type: message.type,
        active: message.active,
        requestId,
      },
      '*'
    );
    return true;
  });
}
