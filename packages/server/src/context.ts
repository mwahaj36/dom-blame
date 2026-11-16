import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestTraceStore, SqlTraceEntry } from './types';

const als = new AsyncLocalStorage<RequestTraceStore>();
const traceHistory = new Map<string, RequestTraceStore>();

let maxHistory = 200;

export function setMaxStoredTraces(max: number): void {
  maxHistory = Math.max(10, max);
}

export function sanitizeParams(params: unknown[]): unknown[] {
  return params.slice(0, 20).map((p) => {
    if (p === null || p === undefined) return p;
    if (typeof p === 'string') return p.length > 120 ? `${p.slice(0, 117)}...` : p;
    if (typeof p === 'number' || typeof p === 'boolean') return p;
    if (Buffer.isBuffer(p)) return `[Buffer(${p.length})]`;
    return String(p);
  });
}

export function saveTrace(store: RequestTraceStore): void {
  traceHistory.set(store.traceId, store);
  while (traceHistory.size > maxHistory) {
    const oldestKey = traceHistory.keys().next().value;
    if (oldestKey !== undefined) traceHistory.delete(oldestKey);
    else break;
  }
}

export function runWithTrace<T>(
  traceId: string,
  meta: { method: string; path: string },
  fn: () => T
): T {
  const store: RequestTraceStore = {
    traceId,
    method: meta.method,
    path: meta.path,
    startedAt: Date.now(),
    queries: [],
  };
  saveTrace(store);
  return als.run(store, fn);
}

export function getCurrentTrace(): RequestTraceStore | undefined {
  return als.getStore();
}

export function getTraceById(traceId: string): RequestTraceStore | undefined {
  return traceHistory.get(traceId);
}

export function recordSqlQuery(entry: SqlTraceEntry): void {
  const store = als.getStore();
  if (!store) return;
  store.queries.push({
    sql: entry.sql.replace(/\s+/g, ' ').trim(),
    params: sanitizeParams(entry.params ?? []),
    rowCount: entry.rowCount ?? 0,
    durationMs: Math.round(entry.durationMs * 100) / 100,
    ...(entry.source ? { source: entry.source } : {}),
  });
}
