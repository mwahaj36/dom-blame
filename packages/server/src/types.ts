export interface SqlTraceEntry {
  sql: string;
  params: unknown[];
  rowCount: number;
  durationMs: number;
  source?: string;
}

export interface RequestTraceStore {
  traceId: string;
  method: string;
  path: string;
  startedAt: number;
  queries: SqlTraceEntry[];
}

export interface DomBlameServerOptions {
  enabled?: boolean;
  traceRoutePrefix?: string;
  maxHeaderBytes?: number;
  maxStoredTraces?: number;
}
