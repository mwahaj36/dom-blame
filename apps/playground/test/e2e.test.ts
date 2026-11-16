import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { initDomBlame } from 'dom-blame';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPlaygroundApp } from '../server/app';
import { createPlaygroundDb } from '../server/db';
import { App } from '../src/App';

function setupBrowserEnv(baseUrl: string) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: baseUrl,
    pretendToBeVisual: true,
  });
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.Element = dom.window.Element;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.XMLHttpRequest = dom.window.XMLHttpRequest;
  g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);

  // Route relative /api and /__dom_blame calls in jsdom to the real Express server
  const realNodeFetch = globalThis.fetch.bind(globalThis);
  g.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return realNodeFetch(`${baseUrl}${input}`, init);
    }
    if (input instanceof Request && input.url.startsWith('/')) {
      return realNodeFetch(new Request(`${baseUrl}${input.url}`, input), init);
    }
    return realNodeFetch(input, init);
  };

  return () => {
    g.fetch = realNodeFetch;
  };
}

test('full-stack playground verifies React Fiber, fetch x-dom-blame-id, SQLite correlation, drift, overfetch, and N+1', async () => {
  const db = createPlaygroundDb(':memory:');
  const app = createPlaygroundApp(db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const restoreFetch = setupBrowserEnv(baseUrl);

  const blame = initDomBlame({
    mcpBridgeUrl: null,
    showDock: true,
    enableKeyboard: false,
  });

  const rootEl = document.getElementById('root')!;
  const root = createRoot(rootEl);

  try {
    root.render(React.createElement(App));
    await new Promise((r) => setTimeout(r, 150));

    // Scenario A: 200 OK Schema Drift on $0.00 MRR card
    const mrrEl = document.querySelector('[data-testid="mrr-value"]')!;
    assert.equal(mrrEl.textContent, '$0.00');

    const mrrCapsule = await blame.inspectElement(mrrEl);
    assert.equal(mrrCapsule.element.primaryComponent?.name, 'RevenueCard');
    assert.equal(mrrCapsule.schemaDrifts.length, 1);
    assert.equal(mrrCapsule.schemaDrifts[0].expectedKey, 'mrrCents');
    assert.equal(mrrCapsule.schemaDrifts[0].actualKey, 'mrr_cents');
    assert.equal(mrrCapsule.schemaDrifts[0].actualValue, 148000);
    assert.ok(mrrCapsule.sqlQueries.some((q) => q.sql.includes('SUM(mrr_cents)')));

    // Scenario B: TeamDirectory exact lineage + SELECT * sensitive column overfetch
    const aliceEl = Array.from(document.querySelectorAll('.row-name')).find(
      (el) => el.textContent === 'Alice Chen'
    )!;
    assert.ok(aliceEl);

    const teamCapsule = await blame.inspectElement(aliceEl);
    assert.equal(teamCapsule.element.primaryComponent?.name, 'TeamDirectory');
    assert.equal(teamCapsule.lineageMatches[0]?.normalizedEndpoint, '/api/team');
    assert.equal(teamCapsule.lineageMatches[0]?.jsonPath, '$[0].name');
    assert.ok(teamCapsule.sqlQueries[0]?.sql.includes('SELECT * FROM team_members'));

    const report = blame.getOverfetchReport();
    const teamEp = report.endpoints.find((ep) => ep.endpoint === '/api/team')!;
    assert.ok(teamEp);
    const leakedKeys = teamEp.unrenderedList.map((f) => f.key);
    for (const expectedLeak of [
      'salary_usd',
      'stripe_customer_id',
      'personal_email',
      'is_admin',
      'internal_notes',
      'ssn_last4',
      'phone_number',
    ]) {
      assert.ok(leakedKeys.includes(expectedLeak), `Expected ${expectedLeak} to be flagged as unrendered`);
    }

    // Scenario C: Client N+1 storm & Backend SQL N+1 cascade
    (document.querySelector('[data-testid="btn-n-plus-one-orders"]') as HTMLButtonElement).click();
    (document.querySelector('[data-testid="btn-n-plus-one-sql"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 200));

    const updatedReport = blame.getOverfetchReport();
    assert.ok(
      updatedReport.requestStorms.some((s) => s.endpoint === 'GET /api/orders/:id/items' && s.count >= 6),
      'Should detect 6 sequential /api/orders/:id/items calls as N+1 storm'
    );

    const invRecord = blame.getNetworkRecords().find((r) => r.normalizedEndpoint === '/api/invoices/n-plus-one')!;
    assert.ok(invRecord, 'Should capture /api/invoices/n-plus-one record');
    assert.equal(invRecord.sqlQueries.length, 6, '1 users query + 5 per-user invoice queries = 6 SQL queries');
  } finally {
    root.unmount();
    blame.destroy();
    restoreFetch();
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});
