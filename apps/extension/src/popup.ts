interface OverfetchReportLike {
  pageUrl: string;
  totalEndpoints: number;
  overallOverfetchRatio: number;
  sensitiveFindingsCount: number;
  endpoints: Array<{ endpoint: string; overfetchRatio: number; sensitiveCount: number }>;
}

const dotEl = document.getElementById('status-dot') as HTMLElement;
const injectBtn = document.getElementById('btn-inject') as HTMLButtonElement;
const autoChk = document.getElementById('chk-auto') as HTMLInputElement;
const mEndpoints = document.getElementById('m-endpoints') as HTMLElement;
const mOverfetch = document.getElementById('m-overfetch') as HTMLElement;
const mLeaks = document.getElementById('m-leaks') as HTMLElement;
const drawerBtn = document.getElementById('btn-drawer') as HTMLButtonElement;
const snapBtn = document.getElementById('btn-snap') as HTMLButtonElement;
const snapPreview = document.getElementById('snap-preview') as HTMLElement;
const snapBody = document.getElementById('snap-body') as HTMLElement;
const copySnapBtn = document.getElementById('btn-copy-snap') as HTMLButtonElement;

let lastSnapJson = '';

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

async function sendTabCmd(tabId: number, type: string, active?: boolean) {
  await chrome.runtime.sendMessage({ type: 'ENSURE_INJECTED', tabId });
  return chrome.tabs.sendMessage(tabId, {
    channel: 'dom-blame-popup',
    type,
    active,
  }) as Promise<{
    ok: boolean;
    inspectMode?: boolean;
    report?: OverfetchReportLike;
    latestCapsule?: unknown;
  }>;
}

function updateMetrics(res: { inspectMode?: boolean; report?: OverfetchReportLike } | null) {
  if (!res?.report) return;
  const { report, inspectMode } = res;
  mEndpoints.textContent = String(report.totalEndpoints);
  mOverfetch.textContent = `${Math.round(report.overallOverfetchRatio * 100)}%`;
  mLeaks.textContent = String(report.sensitiveFindingsCount);
  dotEl.classList.toggle('active', Boolean(inspectMode));
  dotEl.classList.toggle('warn', report.sensitiveFindingsCount > 0);
  injectBtn.textContent = inspectMode ? 'Disable Inspect Mode' : 'Enable Inspect Mode';
}

async function initPopup() {
  const stored = await chrome.storage.local.get(['autoInject']);
  autoChk.checked = Boolean(stored.autoInject);

  const tabId = await getActiveTabId();
  if (!tabId) return;

  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      channel: 'dom-blame-popup',
      type: 'GET_SUMMARY',
    });
    updateMetrics(res);
  } catch {
    // Not yet injected on this tab
  }
}

injectBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  const res = await sendTabCmd(tabId, 'TOGGLE_INSPECT');
  updateMetrics(res);
});

autoChk.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({
    type: 'SET_AUTO_INJECT',
    enabled: autoChk.checked,
  });
});

drawerBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  const res = await sendTabCmd(tabId, 'OPEN_AUDIT_DRAWER');
  updateMetrics(res);
});

snapBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  const res = await sendTabCmd(tabId, 'SNAP_AUDIT_CARD');
  updateMetrics(res);
  if (res?.report) {
    lastSnapJson = JSON.stringify({ report: res.report, latestCapsule: res.latestCapsule }, null, 2);
    snapBody.textContent = lastSnapJson;
    snapPreview.classList.remove('hidden');
  }
});

copySnapBtn.addEventListener('click', async () => {
  if (!lastSnapJson) return;
  await navigator.clipboard.writeText(lastSnapJson);
  copySnapBtn.textContent = 'Copied';
  setTimeout(() => { copySnapBtn.textContent = 'Copy JSON'; }, 1200);
});

void initPopup();
