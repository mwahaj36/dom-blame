import { formatCapsuleMarkdown } from './capsule';
import type { BlameCapsule, OverfetchReport } from './types';

const HUD_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: #ededed;
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.db-reticle {
  position: fixed;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 2147483640;
  border: 1.5px solid #3b82f6;
  background: rgba(59, 130, 246, 0.08);
  border-radius: 4px;
  opacity: 0;
  will-change: transform, width, height, opacity;
  transition: opacity 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.db-reticle.visible { opacity: 1; }
.db-pill {
  position: fixed;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 2147483641;
  background: rgba(15, 15, 16, 0.92);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(237, 237, 237, 0.14);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  color: #ededed;
  white-space: nowrap;
  display: none;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.db-pill.visible { display: flex; }
.db-pill-comp { color: #ededed; font-weight: 500; }
.db-pill-loc { color: #85858b; font-size: 11px; }

.db-dock {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483642;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px;
  background: rgba(15, 15, 16, 0.88);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(237, 237, 237, 0.12);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.db-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: #a1a1a6;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background-color 140ms cubic-bezier(0.22, 1, 0.36, 1), color 140ms, border-color 140ms, transform 100ms;
}
.db-btn:hover { background: rgba(237, 237, 237, 0.08); color: #ededed; }
.db-btn:active { transform: scale(0.97); }
.db-btn:focus-visible { outline: 2px solid #ededed; outline-offset: 1px; }
.db-btn.active {
  background: #ededed;
  color: #0f0f10;
}
.db-btn.secondary {
  background: #232325;
  border-color: rgba(237, 237, 237, 0.1);
  color: #ededed;
}
.db-btn.secondary:hover { background: #2c2c30; }
.db-dot {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: #4cc38a;
}
.db-dot.warn { background: #e5484d; }
.db-badge {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  background: rgba(229, 72, 77, 0.16);
  color: #f28b8e;
  border: 1px solid rgba(229, 72, 77, 0.3);
}
.db-badge.ok {
  background: rgba(76, 195, 138, 0.14);
  color: #6fd9a6;
  border-color: rgba(76, 195, 138, 0.28);
}

.db-popover {
  position: fixed;
  z-index: 2147483644;
  width: 430px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 32px);
  display: none;
  flex-direction: column;
  background: rgba(15, 15, 16, 0.92);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(237, 237, 237, 0.12);
  border-radius: 12px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.db-popover.open { display: flex; }
.db-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(237, 237, 237, 0.08);
  background: rgba(25, 25, 27, 0.72);
}
.db-title { font-size: 12px; font-weight: 600; color: #ededed; display: flex; align-items: center; gap: 8px; }
.db-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.db-layer {
  border: 1px solid rgba(237, 237, 237, 0.08);
  background: rgba(25, 25, 27, 0.7);
  border-radius: 8px;
  padding: 8px 10px;
}
.db-layer.alert {
  border-color: rgba(229, 72, 77, 0.42);
  background: rgba(229, 72, 77, 0.08);
}
.db-layer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 11px;
  color: #85858b;
}
.db-layer-name { font-weight: 600; color: #a1a1a6; }
.db-kv {
  font-size: 12px;
  color: #ededed;
  word-break: break-word;
}
.db-sub { font-size: 11px; color: #a1a1a6; margin-top: 3px; word-break: break-word; }
.db-code {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #0f0f10;
  border: 1px solid rgba(237, 237, 237, 0.08);
  font-size: 11px;
  color: #d4d4d8;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.db-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgba(237, 237, 237, 0.08);
  background: rgba(25, 25, 27, 0.72);
}

.db-drawer {
  position: fixed;
  top: 12px;
  right: 12px;
  bottom: 60px;
  width: 460px;
  max-width: calc(100vw - 24px);
  z-index: 2147483643;
  display: flex;
  flex-direction: column;
  background: rgba(15, 15, 16, 0.94);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(237, 237, 237, 0.12);
  border-radius: 12px;
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.65);
  transform: translate3d(110%, 0, 0);
  opacity: 0;
  pointer-events: none;
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
}
.db-drawer.open {
  transform: translate3d(0, 0, 0);
  opacity: 1;
  pointer-events: auto;
}
.db-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.db-stat {
  border: 1px solid rgba(237, 237, 237, 0.08);
  background: #19191b;
  border-radius: 8px;
  padding: 8px 10px;
}
.db-stat-label { font-size: 11px; color: #85858b; }
.db-stat-val { font-size: 18px; font-weight: 500; color: #ededed; margin-top: 2px; }
.db-bar {
  height: 4px;
  border-radius: 2px;
  background: #232325;
  overflow: hidden;
  margin: 6px 0;
}
.db-bar-fill { height: 100%; background: #e5484d; }
.db-bar-fill.ok { background: #4cc38a; }
.db-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.db-chip {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  border: 1px solid rgba(237, 237, 237, 0.1);
  background: #232325;
  color: #a1a1a6;
}
.db-chip.sensitive {
  border-color: rgba(229, 72, 77, 0.4);
  background: rgba(229, 72, 77, 0.14);
  color: #f28b8e;
}

.db-snap-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483645;
  background: rgba(0, 0, 0, 0.55);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.db-snap-overlay.open { display: flex; }
.db-snap-card {
  width: 560px;
  max-width: 100%;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background: #141415;
  border: 1px solid rgba(237, 237, 237, 0.16);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.75);
  overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .db-reticle, .db-drawer, .db-btn { transition: opacity 150ms ease !important; transform: none !important; }
}
@media (prefers-reduced-transparency: reduce) {
  .db-pill, .db-dock, .db-popover, .db-drawer { background: #141415; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface HudController {
  setInspectMode: (active: boolean) => void;
  isInspectMode: () => boolean;
  updateAuditSummary: (report: OverfetchReport) => void;
  toggleDrawer: (open?: boolean) => void;
  openSnapCard: (report: OverfetchReport, latestCapsule: BlameCapsule | null) => void;
  showCapsule: (capsule: BlameCapsule, anchorRect?: DOMRect) => void;
  destroy: () => void;
}

export function createHud(options: {
  showDock: boolean;
  enableKeyboard: boolean;
  onInspectElement: (target: Element) => Promise<BlameCapsule>;
  onGetOverfetchReport: () => OverfetchReport;
  onGetLatestCapsule: () => BlameCapsule | null;
}): HudController {
  const host = document.createElement('div');
  host.setAttribute('data-dom-blame-host', 'true');
  const shadow = host.attachShadow({ mode: 'open' });

  let styledWithSheet = false;
  try {
    if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in shadow) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(HUD_CSS);
      shadow.adoptedStyleSheets = [sheet];
      styledWithSheet = true;
    }
  } catch {
    styledWithSheet = false;
  }
  if (!styledWithSheet) {
    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    shadow.appendChild(style);
  }

  const reticle = el('div', 'db-reticle');
  const pill = el('div', 'db-pill');
  const pillComp = el('span', 'db-pill-comp mono');
  const pillLoc = el('span', 'db-pill-loc mono');
  pill.append(pillComp, pillLoc);

  const dock = el('div', 'db-dock');
  const dockDot = el('span', 'db-dot');
  const inspectBtn = el('button', 'db-btn', 'Inspect');
  inspectBtn.type = 'button';
  inspectBtn.prepend(dockDot);
  const auditBtn = el('button', 'db-btn secondary', 'Audit');
  auditBtn.type = 'button';
  const auditBadge = el('span', 'db-badge mono', '0');
  auditBtn.append(auditBadge);
  dock.append(inspectBtn, auditBtn);
  if (!options.showDock) dock.style.display = 'none';

  const popover = el('div', 'db-popover');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'dom-blame Inspector');

  const drawer = el('div', 'db-drawer');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', 'Payload Overfetch Audit');

  const snapOverlay = el('div', 'db-snap-overlay');
  const snapCard = el('div', 'db-snap-card');
  snapOverlay.appendChild(snapCard);

  shadow.append(reticle, pill, dock, popover, drawer, snapOverlay);
  const mountHost = () => {
    const target = document.documentElement || document.body;
    if (target && !host.isConnected) target.appendChild(host);
  };
  if (document.documentElement || document.body) {
    mountHost();
  } else {
    document.addEventListener('DOMContentLoaded', mountHost, { once: true });
  }

  let inspectActive = false;
  let altHeld = false;
  let hoveredEl: Element | null = null;
  let lastCapsule: BlameCapsule | null = null;
  let rafId = 0;

  // Critically damped spring state for targeting reticle
  const spring = {
    x: 0, y: 0, w: 0, h: 0,
    vx: 0, vy: 0, vw: 0, vh: 0,
    tx: 0, ty: 0, tw: 0, th: 0,
    initialized: false,
  };

  function stepSpring() {
    rafId = 0;
    if (!hoveredEl || (!inspectActive && !altHeld)) return;
    const rect = hoveredEl.getBoundingClientRect();
    spring.tx = rect.left;
    spring.ty = rect.top;
    spring.tw = rect.width;
    spring.th = rect.height;

    if (!spring.initialized) {
      spring.x = spring.tx;
      spring.y = spring.ty;
      spring.w = spring.tw;
      spring.h = spring.th;
      spring.initialized = true;
    } else {
      // Critically damped spring integration (stiffness = 0.34, damping = 0.52)
      const k = 0.34;
      const d = 0.52;
      spring.vx = (spring.vx + (spring.tx - spring.x) * k) * d;
      spring.vy = (spring.vy + (spring.ty - spring.y) * k) * d;
      spring.vw = (spring.vw + (spring.tw - spring.w) * k) * d;
      spring.vh = (spring.vh + (spring.th - spring.h) * k) * d;
      spring.x += spring.vx;
      spring.y += spring.vy;
      spring.w += spring.vw;
      spring.h += spring.vh;
    }

    reticle.style.transform = `translate3d(${Math.round(spring.x)}px, ${Math.round(spring.y)}px, 0)`;
    reticle.style.width = `${Math.max(4, Math.round(spring.w))}px`;
    reticle.style.height = `${Math.max(4, Math.round(spring.h))}px`;

    const pillTop = spring.y > 32 ? spring.y - 28 : spring.y + spring.h + 6;
    const pillLeft = Math.min(Math.max(8, spring.x), window.innerWidth - 260);
    pill.style.transform = `translate3d(${Math.round(pillLeft)}px, ${Math.round(pillTop)}px, 0)`;

    if (
      Math.abs(spring.tx - spring.x) > 0.4 ||
      Math.abs(spring.ty - spring.y) > 0.4 ||
      Math.abs(spring.tw - spring.w) > 0.4 ||
      Math.abs(spring.th - spring.h) > 0.4
    ) {
      rafId = requestAnimationFrame(stepSpring);
    }
  }

  function updatePillForElement(target: Element) {
    const fiberKey = Object.keys(target).find((k) => k.startsWith('__reactFiber$'));
    let label = `<${target.tagName.toLowerCase()}>`;
    let loc = '';
    if (fiberKey) {
      let cur = (target as unknown as Record<string, unknown>)[fiberKey] as {
        type?: { displayName?: string; name?: string; render?: { name?: string } } | string;
        return?: unknown;
        _debugSource?: { fileName?: string; lineNumber?: number };
        _debugStack?: { stack?: string };
      } | null;
      let guard = 0;
      while (cur && guard < 20) {
        if (typeof cur.type === 'function') {
          const fn = cur.type as { displayName?: string; name?: string };
          label = `<${fn.displayName || fn.name || 'Component'} />`;
          if (cur._debugSource?.fileName) {
            const base = cur._debugSource.fileName.split('/').pop();
            loc = `${base}:${cur._debugSource.lineNumber ?? ''}`;
          }
          break;
        }
        cur = cur.return as typeof cur;
        guard++;
      }
    }
    pillComp.textContent = label;
    pillLoc.textContent = loc;
  }

  function clearReticle() {
    hoveredEl = null;
    spring.initialized = false;
    reticle.classList.remove('visible');
    pill.classList.remove('visible');
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function setInspectMode(active: boolean) {
    inspectActive = active;
    inspectBtn.classList.toggle('active', active);
    if (!active && !altHeld) clearReticle();
  }

  function renderPopover(capsule: BlameCapsule, anchorRect?: DOMRect) {
    lastCapsule = capsule;
    popover.replaceChildren();

    const comp = capsule.element.primaryComponent;
    const compLabel = comp ? `<${comp.name} />` : `<${capsule.element.tagName}>`;

    const head = el('div', 'db-header');
    const title = el('div', 'db-title mono', compLabel);
    if (capsule.schemaDrifts.length > 0) {
      title.appendChild(el('span', 'db-badge', 'SCHEMA DRIFT'));
    } else if (capsule.lineageMatches.length > 0) {
      title.appendChild(el('span', 'db-badge ok', 'TRACED'));
    }
    const closeBtn = el('button', 'db-btn', 'Esc');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => popover.classList.remove('open'));
    head.append(title, closeBtn);

    const body = el('div', 'db-body');

    // Layer 1: DOM Node
    const l1 = el('div', 'db-layer');
    const l1h = el('div', 'db-layer-head');
    l1h.append(el('span', 'db-layer-name', '1. DOM Node'), el('span', 'mono', `<${capsule.element.tagName}>`));
    l1.append(
      l1h,
      el('div', 'db-kv', capsule.element.text ? `"${capsule.element.text}"` : '(empty text)'),
      el('div', 'db-sub mono', capsule.element.selector)
    );
    body.appendChild(l1);

    // Layer 2: Component & Schema Drift
    const l2 = el('div', capsule.schemaDrifts.length > 0 ? 'db-layer alert' : 'db-layer');
    const l2h = el('div', 'db-layer-head');
    const loc = comp?.fileName
      ? `${comp.fileName}${comp.lineNumber ? `:${comp.lineNumber}` : ''}`
      : comp
        ? 'React Fiber'
        : 'DOM fallback';
    l2h.append(el('span', 'db-layer-name', '2. Component'), el('span', 'mono', loc));
    l2.appendChild(l2h);

    if (comp) {
      const chain = capsule.element.hierarchy.slice(0, 4).map((f) => f.name).join(' < ');
      l2.appendChild(el('div', 'db-kv mono', chain));
      const propKeys = Object.keys(comp.props);
      if (propKeys.length > 0) {
        const pre = el('pre', 'db-code mono', JSON.stringify(comp.props, null, 2));
        l2.appendChild(pre);
      }
    } else {
      l2.appendChild(el('div', 'db-sub', 'No React Fiber found on this element.'));
    }

    for (const drift of capsule.schemaDrifts) {
      const msg = `Culprit: read "${drift.expectedKey}" (undefined), API returned "${drift.jsonPath}" = ${JSON.stringify(drift.actualValue)} (${drift.reason})`;
      l2.appendChild(el('div', 'db-sub', msg));
    }
    body.appendChild(l2);

    // Layer 3: HTTP JSON
    const l3 = el('div', 'db-layer');
    const l3h = el('div', 'db-layer-head');
    l3h.append(el('span', 'db-layer-name', '3. HTTP JSON'), el('span', 'mono', `${capsule.lineageMatches.length} match`));
    l3.appendChild(l3h);
    if (capsule.lineageMatches.length > 0) {
      for (const m of capsule.lineageMatches.slice(0, 3)) {
        l3.appendChild(
          el('div', 'db-kv mono', `${m.method} ${m.normalizedEndpoint} (${m.status}, ${m.durationMs}ms)`)
        );
        l3.appendChild(el('div', 'db-sub mono', `${m.jsonPath} = ${JSON.stringify(m.value)}`));
      }
    } else if (capsule.schemaDrifts.length > 0) {
      const d = capsule.schemaDrifts[0];
      l3.appendChild(el('div', 'db-kv mono', `${d.endpoint} -> ${d.jsonPath}`));
      l3.appendChild(el('div', 'db-sub mono', `value: ${JSON.stringify(d.actualValue)}`));
    } else {
      l3.appendChild(el('div', 'db-sub', 'No matching JSON field captured yet.'));
    }
    if (capsule.endpointOverfetch && capsule.endpointOverfetch.unrenderedFields > 0) {
      const ep = capsule.endpointOverfetch;
      l3.appendChild(
        el(
          'div',
          'db-sub mono',
          `Overfetch: ${ep.unrenderedFields}/${ep.totalSchemaFields} fields unrendered (${Math.round(ep.overfetchRatio * 100)}%)`
        )
      );
    }
    body.appendChild(l3);

    // Layer 4: SQL Queries
    const l4 = el('div', capsule.sqlQueries.length > 3 ? 'db-layer alert' : 'db-layer');
    const l4h = el('div', 'db-layer-head');
    l4h.append(
      el('span', 'db-layer-name', '4. SQL Query'),
      el('span', 'mono', `${capsule.sqlQueries.length} queries`)
    );
    l4.appendChild(l4h);
    if (capsule.sqlQueries.length > 0) {
      for (const q of capsule.sqlQueries.slice(0, 4)) {
        const qBox = el('pre', 'db-code mono', `${q.sql}\n-- ${q.rowCount} rows · ${q.durationMs}ms · params ${JSON.stringify(q.params)}`);
        l4.appendChild(qBox);
      }
      if (capsule.sqlQueries.length > 4) {
        l4.appendChild(el('div', 'db-sub mono', `+${capsule.sqlQueries.length - 4} more SQL queries (possible N+1)`));
      }
    } else {
      l4.appendChild(el('div', 'db-sub', 'No SQL trace attached (connect @dom-blame/server middleware).'));
    }
    body.appendChild(l4);

    // Footer actions
    const foot = el('div', 'db-footer');
    const copyBtn = el('button', 'db-btn active', 'Copy Blame Capsule');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', async () => {
      const md = formatCapsuleMarkdown(capsule);
      try {
        await navigator.clipboard.writeText(md);
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy Blame Capsule'; }, 1400);
      } catch {
        copyBtn.textContent = 'Clipboard blocked';
      }
    });
    const openAuditBtn = el('button', 'db-btn secondary', 'Audit Page');
    openAuditBtn.type = 'button';
    openAuditBtn.addEventListener('click', () => {
      renderDrawer(options.onGetOverfetchReport());
      drawer.classList.add('open');
    });
    foot.append(copyBtn, openAuditBtn);

    popover.append(head, body, foot);

    // Position inside viewport bounds near anchor element
    popover.classList.add('open');
    const pw = 430;
    const targetMaxH = Math.min(540, window.innerHeight - 72);
    let left = 24;
    let top = 24;
    if (anchorRect) {
      left = anchorRect.right + 12 + pw <= window.innerWidth
        ? anchorRect.right + 12
        : Math.max(12, anchorRect.left - pw - 12);
      if (left + pw > window.innerWidth - 12) left = Math.max(12, window.innerWidth - pw - 12);
      top = Math.min(Math.max(12, anchorRect.top), Math.max(12, window.innerHeight - targetMaxH - 60));
    }
    const availableHeight = Math.max(220, window.innerHeight - Math.round(top) - 60);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
    popover.style.maxHeight = `${Math.min(targetMaxH, availableHeight)}px`;
  }

  function renderDrawer(report: OverfetchReport) {
    drawer.replaceChildren();
    const head = el('div', 'db-header');
    head.appendChild(el('div', 'db-title', 'Payload Overfetch Audit'));
    const headerActions = el('div', 'db-title');
    const snapBtn = el('button', 'db-btn secondary', 'Snap Audit Card');
    snapBtn.type = 'button';
    snapBtn.addEventListener('click', () => openSnapCard(report, options.onGetLatestCapsule() ?? lastCapsule));
    const closeBtn = el('button', 'db-btn', 'Esc');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => drawer.classList.remove('open'));
    headerActions.append(snapBtn, closeBtn);
    head.appendChild(headerActions);

    const body = el('div', 'db-body');
    const stats = el('div', 'db-stats');
    const mkStat = (label: string, val: string) => {
      const card = el('div', 'db-stat');
      card.append(el('div', 'db-stat-label', label), el('div', 'db-stat-val mono', val));
      return card;
    };
    stats.append(
      mkStat('Overfetched', `${Math.round(report.overallOverfetchRatio * 100)}%`),
      mkStat('Wire / DOM', `${report.totalSchemaFields} / ${report.renderedSchemaFields}`),
      mkStat('Sensitive', `${report.sensitiveFindingsCount}`)
    );
    body.appendChild(stats);

    if (report.requestStorms.length > 0) {
      const stormBox = el('div', 'db-layer alert');
      stormBox.appendChild(el('div', 'db-layer-name', 'N+1 Request Storm Detected'));
      for (const s of report.requestStorms) {
        stormBox.appendChild(
          el('div', 'db-sub mono', `${s.endpoint} fired ${s.count}x in ${s.windowMs}ms (${s.totalDurationMs}ms total)`)
        );
      }
      body.appendChild(stormBox);
    }

    if (report.endpoints.length === 0) {
      body.appendChild(el('div', 'db-layer', 'No JSON API responses captured on this page yet.'));
    }

    for (const ep of report.endpoints) {
      const card = el('div', ep.sensitiveCount > 0 ? 'db-layer alert' : 'db-layer');
      const cardHead = el('div', 'db-layer-head');
      const kb = ep.payloadBytes > 0 ? ` · ${(ep.payloadBytes / 1024).toFixed(1)}KB` : '';
      cardHead.append(
        el('span', 'db-kv mono', `${ep.method} ${ep.endpoint}`),
        el('span', 'mono', `${ep.renderedFields}/${ep.totalSchemaFields} rendered${kb} · ${ep.avgDurationMs}ms`)
      );
      card.appendChild(cardHead);

      const bar = el('div', 'db-bar');
      const fill = el('div', ep.overfetchRatio > 0.5 ? 'db-bar-fill' : 'db-bar-fill ok');
      fill.style.width = `${Math.round(ep.overfetchRatio * 100)}%`;
      bar.appendChild(fill);
      card.appendChild(bar);

      if (ep.unrenderedList.length > 0) {
        const chips = el('div', 'db-chips');
        for (const f of ep.unrenderedList.slice(0, 14)) {
          const chip = el('span', f.sensitive ? 'db-chip sensitive mono' : 'db-chip mono', f.key);
          if (f.sensitivityReason) chip.title = f.sensitivityReason;
          chips.appendChild(chip);
        }
        card.appendChild(chips);
      }
      body.appendChild(card);
    }

    drawer.append(head, body);
  }

  function openSnapCard(report: OverfetchReport, latestCapsule: BlameCapsule | null) {
    snapCard.replaceChildren();
    const head = el('div', 'db-header');
    head.appendChild(el('div', 'db-title', 'dom-blame Audit Snapshot'));
    const closeBtn = el('button', 'db-btn', 'Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => snapOverlay.classList.remove('open'));
    head.appendChild(closeBtn);

    const body = el('div', 'db-body');
    const summary = el('div', 'db-stats');
    const addBox = (k: string, v: string) => {
      const s = el('div', 'db-stat');
      s.append(el('div', 'db-stat-label', k), el('div', 'db-stat-val mono', v));
      summary.appendChild(s);
    };
    addBox('Endpoints', `${report.totalEndpoints}`);
    addBox('Overfetch', `${Math.round(report.overallOverfetchRatio * 100)}%`);
    addBox('Sensitive Leaks', `${report.sensitiveFindingsCount}`);
    body.appendChild(summary);

    const sensitiveKeys: string[] = [];
    for (const ep of report.endpoints) {
      for (const f of ep.unrenderedList) {
        if (f.sensitive) sensitiveKeys.push(`${ep.endpoint}:${f.key}`);
      }
    }
    if (sensitiveKeys.length > 0) {
      const leakBox = el('div', 'db-layer alert');
      leakBox.appendChild(el('div', 'db-layer-name', 'Unrendered Sensitive Fields in Memory'));
      leakBox.appendChild(el('div', 'db-sub mono', sensitiveKeys.slice(0, 12).join(', ')));
      body.appendChild(leakBox);
    }
    if (latestCapsule?.schemaDrifts.length) {
      const d = latestCapsule.schemaDrifts[0];
      const driftBox = el('div', 'db-layer alert');
      driftBox.appendChild(el('div', 'db-layer-name', 'Schema Drift Culprit'));
      driftBox.appendChild(el('div', 'db-sub mono', `${d.expectedKey} (undefined) <- ${d.jsonPath} (${JSON.stringify(d.actualValue)})`));
      body.appendChild(driftBox);
    }

    const foot = el('div', 'db-footer');
    const copyJson = el('button', 'db-btn active', 'Copy Audit JSON');
    copyJson.type = 'button';
    copyJson.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify({ report, latestCapsule }, null, 2));
        copyJson.textContent = 'Copied';
        setTimeout(() => { copyJson.textContent = 'Copy Audit JSON'; }, 1400);
      } catch {
        copyJson.textContent = 'Clipboard blocked';
      }
    });
    foot.append(el('span', 'db-sub mono', report.pageUrl), copyJson);
    snapCard.append(head, body, foot);
    snapOverlay.classList.add('open');
  }

  inspectBtn.addEventListener('click', () => setInspectMode(!inspectActive));
  auditBtn.addEventListener('click', () => {
    const isOpen = drawer.classList.contains('open');
    if (!isOpen) renderDrawer(options.onGetOverfetchReport());
    drawer.classList.toggle('open', !isOpen);
  });

  const onPointerMove = (e: PointerEvent) => {
    altHeld = e.altKey;
    if (!inspectActive && !altHeld) {
      if (hoveredEl) clearReticle();
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === host || target.closest('[data-dom-blame-host]')) return;
    if (target !== hoveredEl) {
      hoveredEl = target;
      updatePillForElement(target);
      reticle.classList.add('visible');
      pill.classList.add('visible');
      if (!rafId) rafId = requestAnimationFrame(stepSpring);
    }
  };

  const onClick = async (e: MouseEvent) => {
    if (!inspectActive && !e.altKey) return;
    const path = e.composedPath();
    if (path.includes(host)) return;
    const target = (path[0] instanceof Element ? path[0] : document.elementFromPoint(e.clientX, e.clientY));
    if (!target || target === host) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = target.getBoundingClientRect();
    const capsule = await options.onInspectElement(target);
    renderPopover(capsule, rect);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Alt') {
      altHeld = true;
    } else if (e.key === 'Escape') {
      if (snapOverlay.classList.contains('open')) snapOverlay.classList.remove('open');
      else if (popover.classList.contains('open')) popover.classList.remove('open');
      else if (drawer.classList.contains('open')) drawer.classList.remove('open');
      else if (inspectActive) setInspectMode(false);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Alt') {
      altHeld = false;
      if (!inspectActive) clearReticle();
    }
  };

  if (options.enableKeyboard) {
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    window.addEventListener('click', onClick, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
  }

  return {
    setInspectMode,
    isInspectMode: () => inspectActive,
    updateAuditSummary(report: OverfetchReport) {
      const leaks = report.sensitiveFindingsCount;
      auditBadge.textContent = String(leaks);
      auditBadge.classList.toggle('ok', leaks === 0);
      dockDot.classList.toggle('warn', leaks > 0);
      if (drawer.classList.contains('open')) renderDrawer(report);
    },
    toggleDrawer(open?: boolean) {
      const next = open ?? !drawer.classList.contains('open');
      if (next) renderDrawer(options.onGetOverfetchReport());
      drawer.classList.toggle('open', next);
    },
    openSnapCard,
    showCapsule: renderPopover,
    destroy() {
      clearReticle();
      if (options.enableKeyboard) {
        window.removeEventListener('pointermove', onPointerMove, { capture: true });
        window.removeEventListener('click', onClick, { capture: true });
        window.removeEventListener('keydown', onKeyDown, { capture: true });
        window.removeEventListener('keyup', onKeyUp, { capture: true });
      }
      host.remove();
    },
  };
}
