import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  auditPageOverfetch,
  initDomBlame,
  inspectElementNode,
  levenshtein,
  scoreKeySimilarity,
} from '../src/index';

function setupDom(url = 'http://localhost:3000/dashboard') {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url,
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
  g.Headers = dom.window.Headers ?? Headers;
  g.Request = dom.window.Request ?? Request;
  g.Response = dom.window.Response ?? Response;
  g.XMLHttpRequest = dom.window.XMLHttpRequest;
  g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  return dom;
}

test('fuzzy key matcher detects camelCase <-> snake_case and unit suffix drift', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  const mrr = scoreKeySimilarity('mrrCents', 'mrr_cents');
  assert.ok(mrr.score >= 0.95);

  const rev = scoreKeySimilarity('totalRevenue', 'total_revenue_cents');
  assert.ok(rev.score >= 0.85);

  const sub = scoreKeySimilarity('subStatus', 'subscription_status');
  assert.ok(sub.score >= 0.8);

  const unrelated = scoreKeySimilarity('userAvatar', 'invoice_total');
  assert.equal(unrelated.score, 0);
});

test('extracts real React 19 Fiber hierarchy, props, and DOM fallback', async () => {
  setupDom();
  const rootEl = document.getElementById('root')!;

  function MetricBadge({ label, mrrCents }: { label: string; mrrCents?: number }) {
    const formatted = typeof mrrCents === 'number' ? `$${(mrrCents / 100).toFixed(2)}` : '$0.00';
    return React.createElement(
      'div',
      { 'data-testid': 'metric-card' },
      React.createElement('span', { className: 'label' }, label),
      React.createElement('strong', { 'data-testid': 'metric-value' }, formatted)
    );
  }

  function Dashboard() {
    return React.createElement(MetricBadge, { label: 'Monthly Recurring Revenue', mrrCents: undefined });
  }

  const root = createRoot(rootEl);
  root.render(React.createElement(Dashboard));
  await new Promise((r) => setTimeout(r, 40));

  const valueEl = document.querySelector('[data-testid="metric-value"]')!;
  const inspected = inspectElementNode(valueEl);

  assert.equal(inspected.framework, 'react');
  assert.equal(inspected.text, '$0.00');
  assert.ok(inspected.hierarchy.some((f) => f.name === 'MetricBadge'));
  assert.ok(inspected.hierarchy.some((f) => f.name === 'Dashboard'));
  const badgeFrame = inspected.hierarchy.find((f) => f.name === 'MetricBadge')!;
  assert.equal(badgeFrame.props.label, 'Monthly Recurring Revenue');
  assert.ok(badgeFrame.nullishProps.includes('mrrCents'));

  // Non-React plain DOM element fallback
  const plain = document.createElement('p');
  plain.id = 'plain-note';
  plain.textContent = 'Static footer';
  document.body.appendChild(plain);
  const plainInspected = inspectElementNode(plain);
  assert.equal(plainInspected.framework, 'dom');
  assert.equal(plainInspected.selector, 'p#plain-note');

  root.unmount();
});

test('fetch interceptor, Proxy read-tracking, schema drift, SQL correlation, and overfetch audit', async () => {
  setupDom('http://localhost:3000/');
  let capturedHeaderId: string | null = null;

  (globalThis as Record<string, unknown>).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    capturedHeaderId = headers.get('x-dom-blame-id');

    if (url.includes('/api/metrics')) {
      return new Response(
        JSON.stringify({ mrr_cents: 148000, active_subscriptions: 24 }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-dom-blame-sql': JSON.stringify([
              {
                sql: 'SELECT SUM(mrr_cents) AS mrr_cents, COUNT(*) AS active_subscriptions FROM subscriptions WHERE status = ?',
                params: ['active'],
                rowCount: 1,
                durationMs: 0.7,
              },
            ]),
          },
        }
      );
    }

    if (url.includes('/api/team')) {
      return new Response(
        JSON.stringify([
          {
            id: 1,
            name: 'Alice Chen',
            role: 'Principal Engineer',
            salary_usd: 215000,
            stripe_customer_id: 'cus_Q9x1234',
            personal_email: 'alice.private@gmail.com',
            is_admin: 1,
            internal_notes: 'Top performer, Q4 promo candidate',
          },
        ]),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-dom-blame-sql': JSON.stringify([
              { sql: 'SELECT * FROM team_members ORDER BY id ASC', params: [], rowCount: 1, durationMs: 0.4 },
            ]),
          },
        }
      );
    }

    return new Response('{}', { status: 404 });
  };

  const blame = initDomBlame({ mcpBridgeUrl: null, showDock: true, enableKeyboard: true });

  // Verify ShadowRoot host was mounted
  const host = document.querySelector('[data-dom-blame-host]');
  assert.ok(host?.shadowRoot, 'ShadowRoot should be mounted in open mode');

  // Render React component that fetches /api/metrics and reads data.mrrCents (drift!)
  // and fetches /api/team and only renders name + role (overfetch!)
  const rootEl = document.getElementById('root')!;
  function App() {
    const [metrics, setMetrics] = React.useState<Record<string, unknown> | null>(null);
    const [team, setTeam] = React.useState<Array<Record<string, unknown>>>([]);

    React.useEffect(() => {
      fetch('/api/metrics').then((r) => r.json()).then(setMetrics);
      fetch('/api/team').then((r) => r.json()).then(setTeam);
    }, []);

    const mrrCents = (metrics as { mrrCents?: number } | null)?.mrrCents;
    const formatted = typeof mrrCents === 'number' ? `$${(mrrCents / 100).toFixed(2)}` : '$0.00';

    return React.createElement(
      'main',
      null,
      React.createElement('div', { 'data-testid': 'mrr-readout' }, formatted),
      React.createElement(
        'ul',
        null,
        team.map((m) =>
          React.createElement(
            'li',
            { key: String(m.id) },
            React.createElement('span', null, String(m.name)),
            React.createElement('span', null, String(m.role))
          )
        )
      )
    );
  }

  const root = createRoot(rootEl);
  root.render(React.createElement(App));
  await new Promise((r) => setTimeout(r, 80));

  assert.ok(capturedHeaderId?.startsWith('db_'), 'x-dom-blame-id should be injected on same-origin fetch');

  // Inspect the drifted $0.00 readout
  const mrrNode = document.querySelector('[data-testid="mrr-readout"]')!;
  const capsule = await blame.inspectElement(mrrNode);

  assert.equal(capsule.schemaDrifts.length, 1);
  assert.equal(capsule.schemaDrifts[0].expectedKey, 'mrrCents');
  assert.equal(capsule.schemaDrifts[0].actualKey, 'mrr_cents');
  assert.equal(capsule.schemaDrifts[0].actualValue, 148000);
  assert.equal(capsule.sqlQueries.length, 1);
  assert.ok(capsule.sqlQueries[0].sql.includes('SUM(mrr_cents)'));

  // Inspect the rendered team member name -> exact 4-layer lineage
  const aliceNode = Array.from(document.querySelectorAll('span')).find((s) => s.textContent === 'Alice Chen')!;
  const aliceCapsule = await blame.inspectElement(aliceNode);
  assert.equal(aliceCapsule.lineageMatches[0]?.normalizedEndpoint, '/api/team');
  assert.equal(aliceCapsule.lineageMatches[0]?.jsonPath, '$[0].name');
  assert.ok(aliceCapsule.sqlQueries[0]?.sql.includes('SELECT * FROM team_members'));

  // Run Overfetch Audit
  const report = blame.getOverfetchReport();
  const teamAudit = report.endpoints.find((ep) => ep.endpoint === '/api/team')!;
  assert.ok(teamAudit, 'Team endpoint should be in overfetch report');
  assert.ok(teamAudit.overfetchRatio > 0.6);
  const unrenderedKeys = teamAudit.unrenderedList.map((f) => f.key);
  assert.ok(unrenderedKeys.includes('salary_usd'));
  assert.ok(unrenderedKeys.includes('stripe_customer_id'));
  assert.ok(unrenderedKeys.includes('personal_email'));
  assert.ok(unrenderedKeys.includes('internal_notes'));
  assert.ok(teamAudit.sensitiveCount >= 4);

  // Also ensure direct auditPageOverfetch works
  const directReport = auditPageOverfetch(blame.getNetworkRecords(), new Set());
  assert.equal(directReport.totalEndpoints, report.totalEndpoints);

  root.unmount();
  blame.destroy();
});
