import type { ComponentFrame, ElementInspection } from './types';

interface FiberLike {
  tag?: number;
  type?: unknown;
  elementType?: unknown;
  return?: FiberLike | null;
  memoizedProps?: Record<string, unknown> | null;
  memoizedState?: unknown;
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
  _debugStack?: { stack?: string } | null;
  _debugOwner?: FiberLike | null;
}

const SKIP_PROPS = new Set(['children', 'key', 'ref', 'style', 'className', 'dangerouslySetInnerHTML']);
const IGNORED_STACK_RE = /(react-dom|react\.development|react\.production|scheduler|node_modules\/react|jsx-dev-runtime|jsx-runtime)/i;

function getReactKey(el: Element, prefix: string): string | null {
  const keys = Object.keys(el);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].startsWith(prefix)) return keys[i];
  }
  return null;
}

function findFiberOnElement(el: Element): { fiber: FiberLike | null; hostProps: Record<string, unknown> } {
  let cur: Element | null = el;
  let hostProps: Record<string, unknown> = {};
  const propsKey = getReactKey(el, '__reactProps$');
  if (propsKey) {
    const raw = (el as unknown as Record<string, unknown>)[propsKey];
    if (raw && typeof raw === 'object') hostProps = raw as Record<string, unknown>;
  }
  while (cur) {
    const fKey = getReactKey(cur, '__reactFiber$') ?? getReactKey(cur, '__reactInternalInstance$');
    if (fKey) {
      return { fiber: (cur as unknown as Record<string, unknown>)[fKey] as FiberLike, hostProps };
    }
    cur = cur.parentElement;
  }
  return { fiber: null, hostProps };
}

function sanitizeValue(val: unknown, depth = 0): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') return val.length > 160 ? `${val.slice(0, 157)}...` : val;
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (typeof val === 'function') return '[Function]';
  if (typeof val === 'symbol' || typeof val === 'bigint') return String(val);
  if (depth >= 2) return Array.isArray(val) ? `[Array(${val.length})]` : '[Object]';
  if (typeof Element !== 'undefined' && val instanceof Element) return `<${val.tagName.toLowerCase()}>`;
  if (Array.isArray(val)) return val.slice(0, 8).map((item) => sanitizeValue(item, depth + 1));
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if ('$$typeof' in obj) return '[ReactElement]';
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (let i = 0; i < Math.min(keys.length, 16); i++) {
      const k = keys[i];
      if (k.startsWith('_')) continue;
      out[k] = sanitizeValue(obj[k], depth + 1);
    }
    return out;
  }
  return String(val);
}

function snapshotProps(raw: Record<string, unknown> | null | undefined): {
  props: Record<string, unknown>;
  nullishProps: string[];
} {
  const props: Record<string, unknown> = {};
  const nullishProps: string[] = [];
  if (!raw || typeof raw !== 'object') return { props, nullishProps };
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (SKIP_PROPS.has(k) || k.startsWith('on')) continue;
    const v = raw[k];
    if (v === undefined || v === null) {
      nullishProps.push(k);
      props[k] = v === undefined ? 'undefined' : null;
    } else {
      props[k] = sanitizeValue(v, 0);
    }
  }
  return { props, nullishProps };
}

function extractHookState(memoizedState: unknown): unknown[] {
  const values: unknown[] = [];
  let node = memoizedState as { memoizedState?: unknown; next?: unknown; queue?: unknown } | null;
  let guard = 0;
  // Function component hooks store a linked list of { memoizedState, queue, next }
  while (node && typeof node === 'object' && guard < 16) {
    if ('next' in node || 'queue' in node) {
      if (node.memoizedState !== undefined && typeof node.memoizedState !== 'function') {
        const sanitized = sanitizeValue(node.memoizedState, 0);
        if (sanitized !== '[ReactElement]') values.push(sanitized);
      }
      node = (node.next as typeof node) ?? null;
    } else {
      values.push(sanitizeValue(node, 0));
      break;
    }
    guard++;
  }
  return values;
}

function cleanSourcePath(rawPath: string): string {
  try {
    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
      const u = new URL(rawPath);
      return u.pathname.replace(/^\/+/, '');
    }
  } catch {
    // ignore malformed URL
  }
  return rawPath.replace(/^file:\/\//, '').split('?')[0];
}

function parseDebugStack(stack: string | undefined | null): {
  fileName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
} {
  if (!stack) return { fileName: null, lineNumber: null, columnNumber: null };
  const lines = stack.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('Error') || IGNORED_STACK_RE.test(line)) continue;
    // Matches Chrome/V8 "at Comp (http://.../src/App.tsx:42:15)" or Firefox "Comp@http://.../src/App.tsx:42:15"
    const match = line.match(/(?:\(|@|^at\s+)([^\s()]+?):(\d+):(\d+)\)?$/);
    if (match) {
      return {
        fileName: cleanSourcePath(match[1]),
        lineNumber: Number.parseInt(match[2], 10),
        columnNumber: Number.parseInt(match[3], 10),
      };
    }
  }
  return { fileName: null, lineNumber: null, columnNumber: null };
}

function resolveComponentName(type: unknown): string | null {
  if (!type) return null;
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || 'Anonymous';
  }
  if (typeof type === 'object') {
    const obj = type as { displayName?: string; render?: { displayName?: string; name?: string }; type?: unknown };
    if (obj.displayName) return obj.displayName;
    if (obj.render) return obj.render.displayName || obj.render.name || 'ForwardRef';
    if (obj.type) return resolveComponentName(obj.type);
  }
  return null;
}

function extractDebugLocation(fiber: FiberLike): {
  fileName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
} {
  if (fiber._debugSource?.fileName) {
    return {
      fileName: cleanSourcePath(fiber._debugSource.fileName),
      lineNumber: fiber._debugSource.lineNumber ?? null,
      columnNumber: fiber._debugSource.columnNumber ?? null,
    };
  }
  const ownStack = parseDebugStack(fiber._debugStack?.stack);
  if (ownStack.fileName) return ownStack;
  if (fiber._debugOwner?._debugStack?.stack) {
    return parseDebugStack(fiber._debugOwner._debugStack.stack);
  }
  return { fileName: null, lineNumber: null, columnNumber: null };
}

export function buildSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < 4) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`${seg}#${cur.id}`);
      break;
    }
    const testId = cur.getAttribute('data-testid');
    if (testId) {
      parts.unshift(`${seg}[data-testid="${testId}"]`);
      break;
    }
    const cls = typeof cur.className === 'string'
      ? cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      : [];
    if (cls.length) seg += `.${cls.join('.')}`;
    parts.unshift(seg);
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

function getElementText(el: Element): string {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (trimmed) return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  return '';
}

function getElementAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  const wanted = ['id', 'data-testid', 'data-source', 'name', 'href', 'src', 'alt', 'title', 'aria-label', 'value'];
  for (let i = 0; i < wanted.length; i++) {
    const k = wanted[i];
    const v = el.getAttribute(k);
    if (v !== null && v !== '') attrs[k] = v;
  }
  return attrs;
}

export function inspectElementNode(el: Element): ElementInspection {
  const { fiber, hostProps: rawHostProps } = findFiberOnElement(el);
  const { props: hostProps, nullishProps: nullishHostProps } = snapshotProps(rawHostProps);
  const hierarchy: ComponentFrame[] = [];

  let cur = fiber;
  let guard = 0;
  while (cur && guard < 40) {
    const name = resolveComponentName(cur.type);
    if (name && !name.startsWith('__') && name !== 'Fragment' && name !== 'Suspense') {
      const loc = extractDebugLocation(cur);
      const { props, nullishProps } = snapshotProps(cur.memoizedProps);
      const stateValues = extractHookState(cur.memoizedState);
      hierarchy.push({
        name,
        fileName: loc.fileName ?? el.getAttribute('data-source'),
        lineNumber: loc.lineNumber,
        columnNumber: loc.columnNumber,
        props,
        nullishProps,
        stateValues,
      });
    }
    cur = cur.return ?? null;
    guard++;
  }

  return {
    tagName: el.tagName.toLowerCase(),
    selector: buildSelector(el),
    text: getElementText(el),
    attributes: getElementAttributes(el),
    framework: hierarchy.length > 0 ? 'react' : 'dom',
    primaryComponent: hierarchy[0] ?? null,
    hierarchy,
    hostProps,
    nullishHostProps,
  };
}
