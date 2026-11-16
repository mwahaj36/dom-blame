import { useEffect, useState } from 'react';

interface MetricsResponse {
  // Note: backend returns mrr_cents, component intentionally reads mrrCents (silent 200 OK drift)
  mrrCents?: number;
  active_subscriptions?: number;
  paid_invoices?: number;
  currency?: string;
}

interface TeamMember {
  id: number;
  name: string;
  role: string;
  department: string;
}

interface OrderRow {
  id: number;
  customer_name: string;
  status: string;
  total_cents: number;
  itemsCount?: number;
}

interface InvoiceUserRow {
  id: number;
  name: string;
  plan: string;
  invoices: Array<{ id: number; amount_cents: number; status: string }>;
}

function RevenueCard({ metrics }: { metrics: MetricsResponse | null }) {
  // Bug: API returns mrr_cents while component reads mrrCents -> renders $0.00 with 200 OK
  const rawCents = metrics?.mrrCents;
  const formatted = typeof rawCents === 'number' ? `$${(rawCents / 100).toFixed(2)}` : '$0.00';

  return (
    <article className="card">
      <div className="card-label">Monthly Recurring Revenue</div>
      <div className="card-value mono" data-testid="mrr-value">
        {formatted}
      </div>
      <div className="card-meta mono">GET /api/metrics · status 200 OK</div>
    </article>
  );
}

function ActiveSubscriptionsCard({ count }: { count: number | undefined }) {
  return (
    <article className="card">
      <div className="card-label">Active Subscriptions</div>
      <div className="card-value mono" data-testid="active-subs-value">
        {count ?? 0}
      </div>
      <div className="card-meta mono">exact lineage match</div>
    </article>
  );
}

function PaidInvoicesCard({ count }: { count: number | undefined }) {
  return (
    <article className="card">
      <div className="card-label">Paid Invoices</div>
      <div className="card-value mono" data-testid="paid-invoices-value">
        {count ?? 0}
      </div>
      <div className="card-meta mono">exact lineage match</div>
    </article>
  );
}

function TeamDirectory({ members }: { members: TeamMember[] }) {
  return (
    <section className="card">
      <div className="section-head">
        <h2 className="section-title">Team Directory</h2>
        <span className="row-tag mono">GET /api/team</span>
      </div>
      <div className="list">
        {members.map((m) => (
          <div key={m.id} className="row" data-testid={`team-row-${m.id}`}>
            <div className="row-main">
              <span className="row-name">{m.name}</span>
              <span className="row-role">{m.role}</span>
            </div>
            <span className="row-tag">{m.department}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [invoiceUsers, setInvoiceUsers] = useState<InvoiceUserRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    fetch('/api/metrics')
      .then((r) => r.json())
      .then((data: MetricsResponse) => setMetrics(data))
      .catch(() => {});

    fetch('/api/team')
      .then((r) => r.json())
      .then((data: TeamMember[]) => setTeam(data))
      .catch(() => {});
  }, []);

  async function runClientNPlusOne() {
    setLoadingOrders(true);
    try {
      const list = (await fetch('/api/orders').then((r) => r.json())) as OrderRow[];
      const enriched: OrderRow[] = [];
      // Intentional N+1 sequential fetch loop for runtime storm detection
      for (const order of list) {
        const items = (await fetch(`/api/orders/${order.id}/items`).then((r) => r.json())) as unknown[];
        enriched.push({ ...order, itemsCount: items.length });
      }
      setOrders(enriched);
    } finally {
      setLoadingOrders(false);
    }
  }

  async function runBackendNPlusOne() {
    const rows = (await fetch('/api/invoices/n-plus-one').then((r) => r.json())) as InvoiceUserRow[];
    setInvoiceUsers(rows);
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1 className="title">Billing &amp; Operations Console</h1>
          <p className="subtitle">Live full-stack runtime verification surface</p>
        </div>
        <div className="kbd-hint">
          Hold <kbd className="mono">Alt</kbd> + Click any element to inspect lineage
        </div>
      </header>

      <section className="metrics-grid">
        <RevenueCard metrics={metrics} />
        <ActiveSubscriptionsCard count={metrics?.active_subscriptions} />
        <PaidInvoicesCard count={metrics?.paid_invoices} />
      </section>

      <div className="split">
        <TeamDirectory members={team} />

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Request &amp; SQL Cascades</h2>
            <div className="btn-group">
              <button
                type="button"
                className="btn"
                data-testid="btn-n-plus-one-orders"
                onClick={runClientNPlusOne}
                disabled={loadingOrders}
              >
                {loadingOrders ? 'Syncing...' : 'Filter Orders (N+1)'}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="btn-n-plus-one-sql"
                onClick={runBackendNPlusOne}
              >
                Load Invoices (SQL N+1)
              </button>
            </div>
          </div>

          <div className="list">
            {orders.map((o) => (
              <div key={o.id} className="row">
                <div className="row-main">
                  <span className="row-name">{o.customer_name}</span>
                  <span className="row-role mono">
                    {o.status} · {o.itemsCount ?? 0} line items
                  </span>
                </div>
                <span className="row-tag mono">${(o.total_cents / 100).toFixed(2)}</span>
              </div>
            ))}
            {invoiceUsers.map((u) => (
              <div key={`inv-${u.id}`} className="row">
                <div className="row-main">
                  <span className="row-name">{u.name}</span>
                  <span className="row-role mono">{u.plan}</span>
                </div>
                <span className="row-tag mono">{u.invoices.length} invoices</span>
              </div>
            ))}
            {orders.length === 0 && invoiceUsers.length === 0 && (
              <div className="row">
                <span className="row-role">Trigger an N+1 cascade above, then Alt+Click a row or open Audit.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
