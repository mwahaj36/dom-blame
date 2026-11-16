import { auditPageOverfetch } from './auditor';
import { formatCapsuleMarkdown, postToMcpBridge } from './capsule';
import { inspectElementNode } from './fiber';
import { createHud } from './hud';
import { resolveElementLineage } from './lineage';
import { detectRequestStorms, installNetworkMonitor } from './network';
import type { BlameCapsule, DomBlameApi, DomBlameConfig, OverfetchReport } from './types';

export * from './types';
export { auditPageOverfetch, classifySensitivity } from './auditor';
export { formatCapsuleMarkdown } from './capsule';
export { buildSelector, inspectElementNode } from './fiber';
export { flattenJson, levenshtein, resolveElementLineage, scoreKeySimilarity } from './lineage';
export { detectRequestStorms, normalizeEndpoint } from './network';

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4119';

function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return true;
  const h = window.location.hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.local');
}

let activeInstance: DomBlameApi | null = null;

export function initDomBlame(userConfig: DomBlameConfig = {}): DomBlameApi {
  if (activeInstance) return activeInstance;

  const localHost = isLocalDevHost();
  const config: DomBlameConfig = {
    mcpBridgeUrl: userConfig.mcpBridgeUrl === undefined
      ? (localHost ? DEFAULT_BRIDGE_URL : null)
      : userConfig.mcpBridgeUrl,
    traceEndpointBase: userConfig.traceEndpointBase ?? '/__dom_blame/trace',
    showDock: userConfig.showDock ?? true,
    enableKeyboard: userConfig.enableKeyboard ?? true,
    maxNetworkRecords: userConfig.maxNetworkRecords ?? 100,
  };

  let latestCapsule: BlameCapsule | null = null;
  let auditTimer: ReturnType<typeof setTimeout> | null = null;
  let capsuleSeq = 0;

  const scheduleAudit = () => {
    if (auditTimer) clearTimeout(auditTimer);
    auditTimer = setTimeout(() => {
      const report = getOverfetchReport();
      hud?.updateAuditSummary(report);
      void postToMcpBridge(config.mcpBridgeUrl, '/overfetch', report, network.nativeFetch);
    }, 250);
  };

  const network = installNetworkMonitor(config, scheduleAudit);

  function getOverfetchReport(): OverfetchReport {
    return auditPageOverfetch(network.records, network.accessedPaths);
  }

  async function inspectElement(el: Element): Promise<BlameCapsule> {
    const elementInfo = inspectElementNode(el);
    let resolution = resolveElementLineage(elementInfo, network.records, network.propertyMisses);

    // Hydrate SQL traces lazily only when server advertised a trace URL or running on localhost
    const traceIdsToHydrate = new Set<string>();
    for (const m of resolution.lineageMatches) {
      if (m.sqlQueries.length === 0) traceIdsToHydrate.add(m.traceId);
    }
    for (const d of resolution.schemaDrifts) {
      if (d.sqlQueries.length === 0) traceIdsToHydrate.add(d.traceId);
    }
    if (traceIdsToHydrate.size > 0) {
      const candidates = network.records.filter(
        (r) => traceIdsToHydrate.has(r.id) && (Boolean(r.traceEndpointUrl) || localHost)
      );
      if (candidates.length > 0) {
        await Promise.all(candidates.map((r) => network.hydrateSqlTrace(r)));
        resolution = resolveElementLineage(elementInfo, network.records, network.propertyMisses);
      }
    }

    const report = getOverfetchReport();
    const matchedEp = resolution.lineageMatches[0]?.normalizedEndpoint
      ?? resolution.schemaDrifts[0]?.endpoint;
    const endpointOverfetch = matchedEp
      ? report.endpoints.find((ep) => ep.endpoint === matchedEp) ?? null
      : null;

    const capsule: BlameCapsule = {
      capsuleId: `cap_${Date.now().toString(36)}_${(++capsuleSeq).toString(36)}`,
      capturedAt: Date.now(),
      pageUrl: typeof window !== 'undefined' ? window.location.href : 'http://localhost',
      element: elementInfo,
      lineageMatches: resolution.lineageMatches,
      schemaDrifts: resolution.schemaDrifts,
      sqlQueries: resolution.sqlQueries,
      endpointOverfetch,
      requestStorms: detectRequestStorms(network.records),
    };

    latestCapsule = capsule;
    void postToMcpBridge(config.mcpBridgeUrl, '/capsule', capsule, network.nativeFetch);
    void postToMcpBridge(config.mcpBridgeUrl, '/overfetch', report, network.nativeFetch);
    return capsule;
  }

  const hud = typeof document !== 'undefined'
    ? createHud({
        showDock: config.showDock ?? true,
        enableKeyboard: config.enableKeyboard ?? true,
        onInspectElement: inspectElement,
        onGetOverfetchReport: getOverfetchReport,
        onGetLatestCapsule: () => latestCapsule,
      })
    : null;

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || !event.data || event.data.source !== 'dom-blame-relay') return;
    const { type, requestId } = event.data as { type: string; requestId?: string };
    if (type === 'TOGGLE_INSPECT') {
      hud?.setInspectMode(!hud.isInspectMode());
    } else if (type === 'SET_INSPECT') {
      hud?.setInspectMode(Boolean(event.data.active));
    } else if (type === 'OPEN_AUDIT_DRAWER') {
      hud?.toggleDrawer(true);
    } else if (type === 'SNAP_AUDIT_CARD') {
      hud?.openSnapCard(getOverfetchReport(), latestCapsule);
    }
    const report = getOverfetchReport();
    window.postMessage(
      {
        source: 'dom-blame-core',
        requestId,
        inspectMode: hud?.isInspectMode() ?? false,
        report,
        latestCapsule,
      },
      '*'
    );
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('message', onMessage);
  }

  const api: DomBlameApi = {
    destroy() {
      if (auditTimer) clearTimeout(auditTimer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('message', onMessage);
      }
      hud?.destroy();
      network.destroy();
      if (activeInstance === api) activeInstance = null;
    },
    setInspectMode(active: boolean) {
      hud?.setInspectMode(active);
    },
    isInspectMode() {
      return hud?.isInspectMode() ?? false;
    },
    toggleAuditDrawer(open?: boolean) {
      hud?.toggleDrawer(open);
    },
    openSnapAuditCard() {
      hud?.openSnapCard(getOverfetchReport(), latestCapsule);
    },
    inspectElement,
    getLatestCapsule: () => latestCapsule,
    getOverfetchReport,
    getNetworkRecords: () => [...network.records],
  };

  activeInstance = api;
  if (typeof window !== 'undefined') {
    (window as unknown as { __DOM_BLAME__?: DomBlameApi }).__DOM_BLAME__ = api;
  }
  return api;
}
