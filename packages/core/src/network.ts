import { flattenJson } from './lineage';
import type { DomBlameConfig, NetworkRecord, PropertyMiss, RequestStormAlert, SqlQueryTrace } from './types';

interface XhrMeta {
  method: string;
  url: string;
  normalizedEndpoint: string;
  sameOrigin: boolean;
  skip: boolean;
  traceId: string;
  startTime: number;
}

const IGNORED_MISS_KEYS = new Set([
  'then', 'catch', 'finally', 'toJSON', 'valueOf', 'toString', 'constructor',
  '$$typeof', 'nodeType', 'length', 'prototype', '__proto__', 'asymmetricMatch',
  'nodeName', 'tagName', 'ownerDocument', 'defaultView',
]);

export function normalizeEndpoint(rawUrl: string): string {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
    const u = new URL(rawUrl, base);
    const normalizedPath = u.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
      .replace(/\/\d+(?=\/|$)/g, '/:id');
    return normalizedPath;
  } catch {
    return rawUrl.split('?')[0];
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function parseSqlHeader(headerVal: string | null): SqlQueryTrace[] {
  if (!headerVal) return [];
  try {
    const decoded = headerVal.startsWith('%') || headerVal.includes('%5B')
      ? decodeURIComponent(headerVal)
      : headerVal;
    const parsed = JSON.parse(decoded);
    return Array.isArray(parsed) ? (parsed as SqlQueryTrace[]) : [];
  } catch {
    return [];
  }
}

export function createJsonTracker(
  accessedPaths: Set<string>,
  propertyMisses: PropertyMiss[]
) {
  const proxyCache = new WeakMap<object, object>();

  function wrap<T>(value: T, meta: { traceId: string; endpoint: string; path: string }): T {
    if (!Array.isArray(value) && !isPlainObject(value)) return value;
    const obj = value as unknown as object;
    const cached = proxyCache.get(obj);
    if (cached) return cached as T;

    const proxy = new Proxy(obj, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);

        const val = Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && !IGNORED_MISS_KEYS.has(prop) && !prop.startsWith('__')) {
          if (Object.prototype.hasOwnProperty.call(target, prop)) {
            const childPath = Array.isArray(target) ? `${meta.path}[${prop}]` : `${meta.path}.${prop}`;
            accessedPaths.add(`${meta.traceId}:${childPath}`);
            if (Array.isArray(val) || isPlainObject(val)) {
              return wrap(val, { ...meta, path: childPath });
            }
          } else if (!(prop in target) && !Array.isArray(target)) {
            propertyMisses.push({
              traceId: meta.traceId,
              endpoint: meta.endpoint,
              basePath: meta.path,
              missingKey: prop,
              targetKeys: Object.keys(target).slice(0, 24),
              timestamp: Date.now(),
            });
            if (propertyMisses.length > 200) propertyMisses.shift();
          }
        }
        return val;
      },
    });

    proxyCache.set(obj, proxy);
    return proxy as T;
  }

  return wrap;
}

export function detectRequestStorms(records: NetworkRecord[], windowMs = 2000): RequestStormAlert[] {
  const buckets = new Map<string, NetworkRecord[]>();
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const key = `${r.method} ${r.normalizedEndpoint}`;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }

  const alerts: RequestStormAlert[] = [];
  for (const [endpoint, list] of buckets.entries()) {
    if (list.length < 4) continue;
    let start = 0;
    let bestCount = 0;
    let bestSpan = 0;
    let bestDuration = 0;
    for (let end = 0; end < list.length; end++) {
      while (list[end].timestamp - list[start].timestamp > windowMs) start++;
      const count = end - start + 1;
      if (count > bestCount) {
        bestCount = count;
        bestSpan = Math.max(1, list[end].timestamp - list[start].timestamp);
        bestDuration = list.slice(start, end + 1).reduce((sum, item) => sum + item.durationMs, 0);
      }
    }
    if (bestCount >= 4) {
      alerts.push({
        endpoint,
        count: bestCount,
        windowMs: Math.round(bestSpan),
        totalDurationMs: Math.round(bestDuration * 10) / 10,
      });
    }
  }
  return alerts.sort((a, b) => b.count - a.count);
}

export interface NetworkMonitor {
  records: NetworkRecord[];
  accessedPaths: Set<string>;
  propertyMisses: PropertyMiss[];
  nativeFetch: typeof fetch;
  hydrateSqlTrace: (record: NetworkRecord) => Promise<SqlQueryTrace[]>;
  destroy: () => void;
}

export function installNetworkMonitor(
  config: DomBlameConfig,
  onUpdate?: () => void
): NetworkMonitor {
  const maxRecords = config.maxNetworkRecords ?? 100;
  const records: NetworkRecord[] = [];
  const accessedPaths = new Set<string>();
  const propertyMisses: PropertyMiss[] = [];
  const wrapJson = createJsonTracker(accessedPaths, propertyMisses);

  const g = globalThis as typeof globalThis & {
    fetch: typeof fetch;
    XMLHttpRequest?: typeof XMLHttpRequest;
  };

  const nativeFetch = g.fetch.bind(globalThis);
  let seq = 0;
  let destroyed = false;

  const isSameOrigin = (rawUrl: string): boolean => {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
      const href = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
      return new URL(rawUrl, href).origin === origin;
    } catch {
      return false;
    }
  };

  const shouldSkipUrl = (rawUrl: string): boolean => {
    if (rawUrl.includes('/__dom_blame/')) return true;
    if (config.mcpBridgeUrl && rawUrl.startsWith(config.mcpBridgeUrl)) return true;
    return false;
  };

  const pushRecord = (rec: NetworkRecord) => {
    records.push(rec);
    if (records.length > maxRecords) records.shift();
    onUpdate?.();
  };

  const patchedFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    const initHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (destroyed || shouldSkipUrl(urlStr) || initHeaders.has('x-dom-blame-internal')) {
      return nativeFetch(input, init);
    }

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const sameOrigin = isSameOrigin(urlStr);
    const traceId = `db_${Date.now().toString(36)}_${(++seq).toString(36)}`;

    let nextInput = input;
    let nextInit = init;

    if (sameOrigin) {
      initHeaders.set('x-dom-blame-id', traceId);
      if (input instanceof Request) {
        nextInput = new Request(input, { headers: initHeaders });
      } else {
        nextInit = { ...init, headers: initHeaders };
      }
    }

    const startTime = performance.now();
    const response = await nativeFetch(nextInput, nextInit);
    const durationMs = Math.round((performance.now() - startTime) * 10) / 10;

    const sqlHeader = response.headers.get('x-dom-blame-sql');
    const traceEndpointUrl = response.headers.get('x-dom-blame-trace-url') ?? undefined;
    const sqlQueries = parseSqlHeader(sqlHeader);
    const contentType = response.headers.get('content-type') ?? '';
    const normEndpoint = normalizeEndpoint(urlStr);

    let record: NetworkRecord | null = null;
    if (contentType.toLowerCase().includes('json')) {
      try {
        const cloned = response.clone();
        const rawJson = await cloned.json();
        record = {
          id: traceId,
          method,
          url: urlStr,
          normalizedEndpoint: normEndpoint,
          status: response.status,
          durationMs,
          timestamp: Date.now(),
          fields: flattenJson(rawJson),
          sqlQueries,
          rawJson,
          traceEndpointUrl,
        };
        pushRecord(record);
      } catch {
        // Non-parseable JSON body
      }

      // Wrap response.json() so caller receives read-tracked Proxy
      const origJson = response.json.bind(response);
      Object.defineProperty(response, 'json', {
        configurable: true,
        value: async () => {
          const data = await origJson();
          return wrapJson(data, { traceId, endpoint: normEndpoint, path: '$' });
        },
      });
    } else {
      pushRecord({
        id: traceId,
        method,
        url: urlStr,
        normalizedEndpoint: normEndpoint,
        status: response.status,
        durationMs,
        timestamp: Date.now(),
        fields: [],
        sqlQueries,
        rawJson: null,
        traceEndpointUrl,
      });
    }

    return response;
  };

  g.fetch = patchedFetch;

  // Patch XMLHttpRequest if available
  const XHR = g.XMLHttpRequest;
  const origOpen = XHR?.prototype.open;
  const origSend = XHR?.prototype.send;
  const xhrWeakMap = new WeakMap<XMLHttpRequest, XhrMeta>();

  if (XHR && origOpen && origSend) {
    XHR.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      const urlStr = typeof url === 'string' ? url : url.toString();
      xhrWeakMap.set(this, {
        method: method.toUpperCase(),
        url: urlStr,
        normalizedEndpoint: normalizeEndpoint(urlStr),
        sameOrigin: isSameOrigin(urlStr),
        skip: destroyed || shouldSkipUrl(urlStr),
        traceId: `db_${Date.now().toString(36)}_${(++seq).toString(36)}`,
        startTime: 0,
      });
      return origOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
    };

    XHR.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = xhrWeakMap.get(this);
      if (meta && !meta.skip) {
        meta.startTime = performance.now();
        if (meta.sameOrigin) {
          try {
            this.setRequestHeader('x-dom-blame-id', meta.traceId);
          } catch {
            // ignore if state invalid
          }
        }
        this.addEventListener('loadend', () => {
          const durationMs = Math.round((performance.now() - meta.startTime) * 10) / 10;
          const ct = this.getResponseHeader('content-type') ?? '';
          const sqlHeader = this.getResponseHeader('x-dom-blame-sql');
          const traceEndpointUrl = this.getResponseHeader('x-dom-blame-trace-url') ?? undefined;
          let rawJson: unknown = null;
          if (ct.includes('json') || this.responseType === 'json') {
            try {
              rawJson = this.responseType === 'json'
                ? this.response
                : JSON.parse(this.responseText || 'null');
            } catch {
              rawJson = null;
            }
          }
          pushRecord({
            id: meta.traceId,
            method: meta.method,
            url: meta.url,
            normalizedEndpoint: meta.normalizedEndpoint,
            status: this.status,
            durationMs,
            timestamp: Date.now(),
            fields: rawJson !== null ? flattenJson(rawJson) : [],
            sqlQueries: parseSqlHeader(sqlHeader),
            rawJson,
            traceEndpointUrl,
          });
        }, { once: true });
      }
      return origSend.call(this, body);
    };
  }

  async function hydrateSqlTrace(record: NetworkRecord): Promise<SqlQueryTrace[]> {
    if (record.sqlQueries.length > 0) return record.sqlQueries;
    const base = config.traceEndpointBase ?? '/__dom_blame/trace';
    const targetUrl = record.traceEndpointUrl ?? `${base}/${encodeURIComponent(record.id)}`;
    try {
      const res = await nativeFetch(targetUrl, {
        headers: { 'x-dom-blame-internal': '1' },
      });
      if (!res.ok) return [];
      const data = await res.json() as { queries?: SqlQueryTrace[] };
      if (Array.isArray(data?.queries)) {
        record.sqlQueries = data.queries;
      }
      return record.sqlQueries;
    } catch {
      return [];
    }
  }

  function destroy() {
    destroyed = true;
    if (g.fetch === patchedFetch) {
      g.fetch = nativeFetch;
    }
    if (XHR && origOpen && origSend) {
      XHR.prototype.open = origOpen;
      XHR.prototype.send = origSend;
    }
  }

  return {
    records,
    accessedPaths,
    propertyMisses,
    nativeFetch,
    hydrateSqlTrace,
    destroy,
  };
}
