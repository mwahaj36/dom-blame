import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { domBlameMiddleware } from '@dom-blame/server';
import type Database from 'better-sqlite3';
import express from 'express';
import { createPlaygroundDb } from './db';

export function createPlaygroundApp(db: Database.Database = createPlaygroundDb()): express.Express {
  const app = express();
  app.use(express.json());
  app.use(domBlameMiddleware({ enabled: true }));

  // Scenario A: 200 OK snake_case vs camelCase schema drift (mrr_cents vs mrrCents)
  app.get('/api/metrics', (_req, res) => {
    const subStats = db
      .prepare('SELECT COALESCE(SUM(mrr_cents), 0) AS mrr_cents, COUNT(*) AS active_subscriptions FROM subscriptions WHERE status = ?')
      .get('active') as { mrr_cents: number; active_subscriptions: number };

    const invStats = db
      .prepare('SELECT COUNT(*) AS paid_invoices, COALESCE(SUM(amount_cents), 0) AS total_billed_cents FROM invoices WHERE status = ?')
      .get('paid') as { paid_invoices: number; total_billed_cents: number };

    res.json({
      mrr_cents: subStats.mrr_cents,
      active_subscriptions: subStats.active_subscriptions,
      paid_invoices: invStats.paid_invoices,
      total_billed_cents: invStats.total_billed_cents,
      currency: 'USD',
    });
  });

  // Scenario B: SELECT * overfetch exposing unrendered sensitive columns
  app.get('/api/team', (_req, res) => {
    const members = db.prepare('SELECT * FROM team_members ORDER BY id ASC').all();
    res.json(members);
  });

  // Scenario C1: Orders + per-order items endpoints for client N+1 storm
  app.get('/api/orders', (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null;
    const orders = status
      ? db.prepare('SELECT id, customer_name, status, total_cents, created_at FROM orders WHERE status = ? ORDER BY id ASC').all(status)
      : db.prepare('SELECT id, customer_name, status, total_cents, created_at FROM orders ORDER BY id ASC').all();
    res.json(orders);
  });

  app.get('/api/orders/:id/items', (req, res) => {
    const orderId = Number.parseInt(req.params.id, 10);
    const items = db
      .prepare('SELECT id, order_id, sku, quantity, unit_price_cents FROM order_items WHERE order_id = ?')
      .all(orderId);
    res.json(items);
  });

  // Scenario C2: Backend N+1 sequential SQL queries inside a single request
  app.get('/api/invoices/n-plus-one', (_req, res) => {
    const users = db.prepare('SELECT id, name, plan FROM users ORDER BY id ASC').all() as Array<{
      id: number;
      name: string;
      plan: string;
    }>;
    const stmt = db.prepare('SELECT id, amount_cents, status, issued_at FROM invoices WHERE user_id = ?');
    const detailed = users.map((u) => ({
      id: u.id,
      name: u.name,
      plan: u.plan,
      invoices: stmt.all(u.id),
    }));
    res.json(detailed);
  });

  // Serve built client in production / static mode if present
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidateDirs = [
    path.resolve(__dirname, '../client'),
    path.resolve(__dirname, '../dist/client'),
  ];
  const clientDir = candidateDirs.find((dir) => fs.existsSync(dir));
  if (clientDir) {
    app.use(express.static(clientDir));
  }

  return app;
}
