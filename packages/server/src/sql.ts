import { performance } from 'node:perf_hooks';
import { recordSqlQuery } from './context';

interface SqliteStatementLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all: (...params: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (...params: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (...params: any[]) => any;
}

export interface BetterSqlite3Like {
  prepare: (sql: string) => SqliteStatementLike;
}

const INSTRUMENTED_FLAG = Symbol('domBlameInstrumented');

function flattenArgList(args: unknown[]): unknown[] {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

export function instrumentBetterSqlite3<T extends BetterSqlite3Like>(db: T): T {
  const tagged = db as T & { [INSTRUMENTED_FLAG]?: boolean };
  if (tagged[INSTRUMENTED_FLAG]) return db;
  tagged[INSTRUMENTED_FLAG] = true;

  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const stmt = origPrepare(sql);

    const origAll = stmt.all.bind(stmt);
    stmt.all = (...args: unknown[]) => {
      const t0 = performance.now();
      const rows = origAll(...args);
      recordSqlQuery({
        sql,
        params: flattenArgList(args),
        rowCount: Array.isArray(rows) ? rows.length : 0,
        durationMs: performance.now() - t0,
        source: 'better-sqlite3',
      });
      return rows;
    };

    const origGet = stmt.get.bind(stmt);
    stmt.get = (...args: unknown[]) => {
      const t0 = performance.now();
      const row = origGet(...args);
      recordSqlQuery({
        sql,
        params: flattenArgList(args),
        rowCount: row !== undefined ? 1 : 0,
        durationMs: performance.now() - t0,
        source: 'better-sqlite3',
      });
      return row;
    };

    const origRun = stmt.run.bind(stmt);
    stmt.run = (...args: unknown[]) => {
      const t0 = performance.now();
      const info = origRun(...args);
      recordSqlQuery({
        sql,
        params: flattenArgList(args),
        rowCount: typeof info?.changes === 'number' ? info.changes : 0,
        durationMs: performance.now() - t0,
        source: 'better-sqlite3',
      });
      return info;
    };

    return stmt;
  };

  return db;
}

export interface PgQueryableLike {
  query: (...args: unknown[]) => Promise<{ rowCount?: number | null; rows?: unknown[] }> | void;
}

export function instrumentPg<T extends PgQueryableLike>(client: T): T {
  const tagged = client as T & { [INSTRUMENTED_FLAG]?: boolean };
  if (tagged[INSTRUMENTED_FLAG]) return client;
  tagged[INSTRUMENTED_FLAG] = true;

  const origQuery = client.query.bind(client);
  client.query = (...args: unknown[]) => {
    const first = args[0];
    const sql = typeof first === 'string'
      ? first
      : (first && typeof first === 'object' && 'text' in first ? String((first as { text: unknown }).text) : 'SQL');
    const params = Array.isArray(args[1])
      ? args[1]
      : (first && typeof first === 'object' && 'values' in first && Array.isArray((first as { values?: unknown }).values)
          ? (first as { values: unknown[] }).values
          : []);

    const t0 = performance.now();
    const res = origQuery(...args);
    if (res && typeof (res as Promise<unknown>).then === 'function') {
      return (res as Promise<{ rowCount?: number | null; rows?: unknown[] }>).then((result) => {
        recordSqlQuery({
          sql,
          params,
          rowCount: result?.rowCount ?? result?.rows?.length ?? 0,
          durationMs: performance.now() - t0,
          source: 'pg',
        });
        return result;
      });
    }
    return res;
  };

  return client;
}

export function createPrismaExtension() {
  return {
    name: 'dom-blame',
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const t0 = performance.now();
          const result = await query(args);
          const rowCount = Array.isArray(result) ? result.length : result ? 1 : 0;
          recordSqlQuery({
            sql: `PRISMA ${model}.${operation}(${JSON.stringify(args ?? {})})`,
            params: [],
            rowCount,
            durationMs: performance.now() - t0,
            source: 'prisma',
          });
          return result;
        },
      },
    },
  };
}

export async function traceQuery<T>(
  sql: string,
  params: unknown[],
  fn: () => Promise<T> | T,
  source = 'custom'
): Promise<T> {
  const t0 = performance.now();
  const result = await fn();
  const rowCount = Array.isArray(result) ? result.length : result ? 1 : 0;
  recordSqlQuery({
    sql,
    params,
    rowCount,
    durationMs: performance.now() - t0,
    source,
  });
  return result;
}
