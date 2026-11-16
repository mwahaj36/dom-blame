import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { BlameCapsule, OverfetchReport } from 'dom-blame';
import { BlameBridgeStore, createDomBlameMcpServer, startBridgeServer } from '../src/index';

test('MCP server exposes 3 tools and serves live capsules & overfetch reports over HTTP bridge', async () => {
  const store = new BlameBridgeStore();
  const bridge = await startBridgeServer(store, 0);

  const sampleCapsule: BlameCapsule = {
    capsuleId: 'cap_test_1',
    capturedAt: Date.now(),
    pageUrl: 'http://localhost:5173/',
    element: {
      tagName: 'div',
      selector: 'div[data-testid="mrr-value"]',
      text: '$0.00',
      attributes: { 'data-testid': 'mrr-value' },
      framework: 'react',
      primaryComponent: {
        name: 'RevenueCard',
        fileName: 'src/App.tsx',
        lineNumber: 42,
        columnNumber: 8,
        props: { title: 'MRR', mrrCents: 'undefined' },
        nullishProps: ['mrrCents'],
        stateValues: [],
      },
      hierarchy: [],
      hostProps: {},
      nullishHostProps: [],
    },
    lineageMatches: [],
    schemaDrifts: [
      {
        expectedKey: 'mrrCents',
        actualKey: 'mrr_cents',
        jsonPath: '$.mrr_cents',
        actualValue: 148000,
        endpoint: '/api/metrics',
        traceId: 'db_1',
        confidence: 0.98,
        reason: 'casing drift (mrrCents vs mrr_cents)',
        sqlQueries: [
          {
            sql: 'SELECT SUM(mrr_cents) AS mrr_cents FROM subscriptions WHERE status = ?',
            params: ['active'],
            rowCount: 1,
            durationMs: 0.6,
          },
        ],
      },
    ],
    sqlQueries: [
      {
        sql: 'SELECT SUM(mrr_cents) AS mrr_cents FROM subscriptions WHERE status = ?',
        params: ['active'],
        rowCount: 1,
        durationMs: 0.6,
      },
    ],
    endpointOverfetch: null,
    requestStorms: [],
  };

  const sampleOverfetch: OverfetchReport = {
    pageUrl: 'http://localhost:5173/',
    capturedAt: Date.now(),
    totalEndpoints: 1,
    totalPayloadBytes: 512,
    totalSchemaFields: 7,
    renderedSchemaFields: 2,
    unrenderedSchemaFields: 5,
    overallOverfetchRatio: 0.714,
    sensitiveFindingsCount: 5,
    requestStorms: [],
    endpoints: [
      {
        endpoint: '/api/team',
        method: 'GET',
        status: 200,
        requestCount: 1,
        avgDurationMs: 2.4,
        payloadBytes: 512,
        totalSchemaFields: 7,
        renderedFields: 2,
        unrenderedFields: 5,
        overfetchRatio: 0.714,
        sensitiveCount: 5,
        nonNullSensitiveCount: 5,
        nPlusOneSuspected: false,
        sqlQueryCount: 1,
        unrenderedList: [
          {
            key: 'salary_usd',
            samplePath: '$[0].salary_usd',
            sampleValue: 215000,
            accessedInJs: false,
            renderedInDom: false,
            sensitive: true,
            sensitivityReason: 'compensation / payroll data',
          },
        ],
      },
    ],
  };

  try {
    // Post live browser state to HTTP bridge
    const capRes = await fetch(`${bridge.url}/capsule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleCapsule),
    });
    assert.equal(capRes.status, 200);

    const ovRes = await fetch(`${bridge.url}/overfetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleOverfetch),
    });
    assert.equal(ovRes.status, 200);

    // Connect MCP client over InMemoryTransport
    const mcpServer = createDomBlameMcpServer(bridge);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'get_latest_blame_capsule',
      'get_sql_queries_for_element',
      'list_overfetched_endpoints',
    ]);

    const capTool = await client.callTool({
      name: 'get_latest_blame_capsule',
      arguments: { response_format: 'json' },
    });
    const capText = (capTool.content as Array<{ type: string; text: string }>)[0].text;
    assert.ok(capText.includes('mrr_cents'));
    assert.ok(capText.includes('RevenueCard'));

    const ovTool = await client.callTool({
      name: 'list_overfetched_endpoints',
      arguments: { sensitive_only: true, response_format: 'markdown' },
    });
    const ovText = (ovTool.content as Array<{ type: string; text: string }>)[0].text;
    assert.ok(ovText.includes('/api/team'));
    assert.ok(ovText.includes('salary_usd'));

    const sqlTool = await client.callTool({
      name: 'get_sql_queries_for_element',
      arguments: { response_format: 'json' },
    });
    const sqlText = (sqlTool.content as Array<{ type: string; text: string }>)[0].text;
    assert.ok(sqlText.includes('SELECT SUM(mrr_cents)'));

    await client.close();
  } finally {
    await bridge.close();
  }
});
