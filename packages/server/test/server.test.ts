import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import {
  createPrismaExtension,
  domBlameMiddleware,
  instrumentBetterSqlite3,
  instrumentPg,
  traceQuery,
  withDomBlame,
} from '../src/index';

test('Express middleware correlates AsyncLocalStorage SQL traces via x-dom-blame-id', async () => {
  const app = express();
  app.use(domBlameMiddleware({ enabled: true }));

  // Mock better-sqlite3-compatible DB object to test real wrapper behavior
  const fakeDb = instrumentBetterSqlite3({
    prepare(sql: string) {
      return {
        all(..._params: unknown[]) {
          return [{ id: 1, name: 'Alice', mrr_cents: 148000 }];
        },
        get(..._params: unknown[]) {
          return { id: 1 };
        },
        run(..._params: unknown[]) {
          return { changes: 1 };
        },
      };
    },
  });

  app.get('/api/metrics', async (_req, res) => {
    const rows = fakeDb.prepare('SELECT mrr_cents FROM subscriptions WHERE status = ?').all('active');
    await traceQuery('SELECT COUNT(*) FROM invoices WHERE paid = ?', [1], async () => [{ c: 12 }]);
    res.json({ rows });
  });

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/metrics`, {
      headers: { 'x-dom-blame-id': 'db_test_trace_1' },
    });
    assert.equal(res.status, 200);
    const sqlHeader = res.headers.get('x-dom-blame-sql');
    assert.ok(sqlHeader, 'x-dom-blame-sql header should be present');
    const parsed = JSON.parse(sqlHeader) as Array<{ sql: string; params: unknown[]; rowCount: number }>;
    assert.equal(parsed.length, 2);
    assert.ok(parsed[0].sql.includes('SELECT mrr_cents FROM subscriptions'));
    assert.deepEqual(parsed[0].params, ['active']);
    assert.equal(parsed[0].rowCount, 1);

    // Verify /__dom_blame/trace/:id endpoint
    const traceRes = await fetch(`http://127.0.0.1:${port}/__dom_blame/trace/db_test_trace_1`);
    assert.equal(traceRes.status, 200);
    const traceJson = (await traceRes.json()) as { traceId: string; queries: unknown[] };
    assert.equal(traceJson.traceId, 'db_test_trace_1');
    assert.equal(traceJson.queries.length, 2);
  } finally {
    server.close();
  }
});

test('withDomBlame Next.js/Web wrapper and pg/Prisma hooks record queries', async () => {
  const pgMock = instrumentPg({
    async query(_sql: string, _vals?: unknown[]) {
      return { rowCount: 3, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    },
  });
  const prismaExt = createPrismaExtension();

  const handler = withDomBlame(
    async (_req: Request) => {
      await pgMock.query('SELECT * FROM team_members WHERE org_id = $1', [42]);
      await prismaExt.query.$allModels.$allOperations({
        model: 'User',
        operation: 'findMany',
        args: { take: 5 },
        query: async () => [{ id: 1 }, { id: 2 }],
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    },
    { enabled: true }
  );

  const req = new Request('http://localhost/api/pg-test', {
    headers: { 'x-dom-blame-id': 'db_web_1' },
  });
  const res = await handler(req);
  const sql = JSON.parse(res.headers.get('x-dom-blame-sql') || '[]') as Array<{ sql: string; rowCount: number }>;
  assert.equal(sql.length, 2);
  assert.ok(sql[0].sql.includes('SELECT * FROM team_members'));
  assert.equal(sql[0].rowCount, 3);
  assert.ok(sql[1].sql.includes('PRISMA User.findMany'));
  assert.equal(sql[1].rowCount, 2);
});
