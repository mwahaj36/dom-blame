import Database from 'better-sqlite3';
import { instrumentBetterSqlite3 } from '@dom-blame/server';

export function createPlaygroundDb(dbPath = process.env.DB_PATH || ':memory:'): Database.Database {
  const db = instrumentBetterSqlite3(new Database(dbPath));

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      plan TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_name TEXT NOT NULL,
      mrr_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      stripe_sub_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      issued_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      salary_usd INTEGER NOT NULL,
      stripe_customer_id TEXT NOT NULL,
      personal_email TEXT NOT NULL,
      is_admin INTEGER NOT NULL,
      internal_notes TEXT NOT NULL,
      ssn_last4 TEXT NOT NULL,
      phone_number TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      status TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL
    );
  `);

  const userCount = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
  if (userCount === 0) {
    const insertUser = db.prepare('INSERT INTO users (name, email, plan, created_at) VALUES (?, ?, ?, ?)');
    const insertSub = db.prepare('INSERT INTO subscriptions (user_id, plan_name, mrr_cents, status, stripe_sub_id) VALUES (?, ?, ?, ?, ?)');
    const insertInv = db.prepare('INSERT INTO invoices (user_id, amount_cents, status, issued_at) VALUES (?, ?, ?, ?)');

    const accounts = [
      ['Northstar Labs', 'billing@northstar.io', 'scale', 49000, 'sub_1QxA01'],
      ['Kestrel Cloud', 'ops@kestrel.dev', 'pro', 29000, 'sub_1QxA02'],
      ['Boreal Robotics', 'finance@boreal.ai', 'scale', 49000, 'sub_1QxA03'],
      ['Trellis Data', 'team@trellis.co', 'starter', 9900, 'sub_1QxA04'],
      ['Verve Security', 'ap@vervesec.io', 'pro', 11100, 'sub_1QxA05'],
    ] as const;

    accounts.forEach(([name, email, plan, mrr, subId], idx) => {
      const uid = idx + 1;
      insertUser.run(name, email, plan, '2026-10-01T00:00:00Z');
      insertSub.run(uid, plan, mrr, 'active', subId);
      insertInv.run(uid, mrr, 'paid', '2026-11-01T00:00:00Z');
      insertInv.run(uid, mrr, 'paid', '2026-10-01T00:00:00Z');
    });

    const insertTeam = db.prepare(
      'INSERT INTO team_members (name, role, department, salary_usd, stripe_customer_id, personal_email, is_admin, internal_notes, ssn_last4, phone_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const members = [
      ['Alice Chen', 'Principal Engineer', 'Platform', 235000, 'cus_P9x101', 'alice.chen.home@gmail.com', 1, 'Key architecture owner; retention bonus due Q1', '4821', '+1-415-555-0142'],
      ['Marcus Vance', 'Staff Product Designer', 'Design Systems', 198000, 'cus_P9x102', 'mvance.personal@icloud.com', 0, 'Leading Shadow HUD design polish', '9104', '+1-415-555-0188'],
      ['Priya Nair', 'Head of Security', 'Infrastructure', 245000, 'cus_P9x103', 'priya.nair@proton.me', 1, 'Has production root KMS key custody', '7732', '+1-650-555-0119'],
      ['Devon Brooks', 'Solutions Engineer', 'Customer Ops', 162000, 'cus_P9x104', 'devon.brooks@hey.com', 0, 'Performance review scheduled Dec 12', '3390', '+1-212-555-0174'],
    ] as const;
    for (const m of members) insertTeam.run(...m);

    const insertOrder = db.prepare('INSERT INTO orders (customer_name, status, total_cents, created_at) VALUES (?, ?, ?, ?)');
    const insertItem = db.prepare('INSERT INTO order_items (order_id, sku, quantity, unit_price_cents) VALUES (?, ?, ?, ?)');
    for (let i = 1; i <= 6; i++) {
      insertOrder.run(`Enterprise Order #${100 + i}`, i % 2 === 0 ? 'fulfilled' : 'processing', 12000 * i, '2026-11-15T10:00:00Z');
      insertItem.run(i, `SKU-CORE-${i}`, 2, 6000 * i);
    }
  }

  return db;
}
