<p>
  <img src="./assets/icon.svg" width="48" height="48" alt="dom-blame icon" />
</p>

# `dom-blame`

[![npm version](https://img.shields.io/npm/v/dom-blame)](https://www.npmjs.com/package/dom-blame)
[![@dom-blame/mcp](https://img.shields.io/npm/v/@dom-blame/mcp?label=%40dom-blame%2Fmcp)](https://www.npmjs.com/package/@dom-blame/mcp)
[![license](https://img.shields.io/github/license/mwahaj36/dom-blame)](./LICENSE)
[![release](https://img.shields.io/github/v/release/mwahaj36/dom-blame)](https://github.com/mwahaj36/dom-blame/releases/tag/v1.0.0)

> **`git blame` for live pixels.**
> `Alt + Click` any DOM element to trace its **React component prop $\leftarrow$ HTTP JSON field $\leftarrow$ SQL query**, catch silent `200 OK` schema drift, and expose unrendered JSON fields leaked in browser memory.

---

## Why `dom-blame`

When a UI widget silently renders `$0.00` instead of `$1,480.00`, DevTools only shows each layer in isolation. `dom-blame` correlates all four runtime layers into a single inspectable **Blame Capsule** and streams it straight into your AI coding agent over MCP:

1. **Layer 1 — DOM Node:** Tag, visible text, generated selector, and rendered media/attribute corpus.
2. **Layer 2 — React Fiber & Schema Drift:** Component hierarchy (`_debugSource` file/line in dev builds), props, and live `Proxy` miss-tracking (`read "mrrCents" (undefined), API returned "$.mrr_cents" = 148000`).
3. **Layer 3 — HTTP JSON & Overfetch Audit:** `fetch` / `XHR` payload lineage, Wire vs. DOM overfetch ratio, unrendered sensitive fields (`personal_email`, `ssn_last4`, `stripe_customer_id`, `password_hash`, `is_admin`, `internal_notes`), N+1 request storm detection, and exportable PNG / JSON audit cards.
4. **Layer 4 — SQL Queries (Local Dev / Staging):** `AsyncLocalStorage` middleware (`x-dom-blame-id`) correlating exact SQL queries, bound parameters, row counts, and query timings from Express / Next.js + SQLite / Postgres / Prisma.

---

## Quickstart (Full-Stack App + MCP)

### 1. Install dev packages

```bash
npm install -D dom-blame @dom-blame/server @dom-blame/mcp
```

### 2. Enable client HUD (dev only)

Call `initDomBlame()` once in your client entry before mounting so initial API calls are captured:

```ts
import { initDomBlame } from 'dom-blame';

if (process.env.NODE_ENV !== 'production') {
  initDomBlame({
    showDock: true,
    enableKeyboard: true,
    mcpBridgeUrl: 'http://127.0.0.1:4119',
  });
}
```

### 3. Correlate backend SQL (`@dom-blame/server`)

Middleware is disabled automatically when `NODE_ENV === 'production'`.

**Express / Connect:**

```ts
import { domBlameMiddleware, instrumentBetterSqlite3, instrumentPg } from '@dom-blame/server';

app.use(domBlameMiddleware());

// Instrument your DB client once on startup:
const db = instrumentBetterSqlite3(sqliteDb);
// Or Postgres: const pool = instrumentPg(pgPool);
// Or Prisma: const prisma = new PrismaClient().$extends(createPrismaExtension());
```

**Next.js App Router / Fetch Handlers:**

```ts
import { withDomBlame } from '@dom-blame/server';

export const GET = withDomBlame(async (req) => {
  return Response.json(data);
});
```

### 4. Connect MCP to Claude Code / Cursor / Antigravity

Add `@dom-blame/mcp` to your MCP config:

```json
{
  "mcpServers": {
    "dom-blame": {
      "command": "npx",
      "args": ["-y", "@dom-blame/mcp"]
    }
  }
}
```

Available MCP tools:
- `get_latest_blame_capsule` — Full 4-layer lineage + `schemaDrifts` for the element you `Alt + Click`ed.
- `list_overfetched_endpoints` — Wire vs. DOM ratios, unrendered sensitive fields, and N+1 request storms.
- `get_sql_queries_for_element` — Exact backend SQL queries, parameters, and timings linked to a capsule or endpoint.

---

## Chrome Extension (Sideload)

The Chrome Manifest V3 extension lets you inspect Layers 1–3 on any site without editing app source code. It is distributed as a sideloadable bundle rather than via the Chrome Web Store.

### Option A: Download prebuilt release zip
1. Download `dom-blame-extension-v1.0.0.zip` from the [GitHub Releases](https://github.com/mwahaj36/dom-blame/releases) page and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder (`dist`).
5. Click the `dom-blame` toolbar icon to enable **Inspect**, **Audit**, or **Auto-inject on load** (captures initial page-load API calls).

### Option B: Build from source
```bash
git clone https://github.com/mwahaj36/dom-blame.git
cd dom-blame
corepack pnpm install
corepack pnpm build
```
Then load `apps/extension/dist` via **Load unpacked** in `chrome://extensions`.

> **Security note:** Layer 4 SQL trace hydration and MCP bridge posts (`127.0.0.1:4119`) are restricted to localhost/local dev hosts and never fire from external production sites.

---

## Agent Skill

Install the `dom-blame` development skill directly into Antigravity, Claude Code, Cursor, or Codex CLI:

```bash
npx skills add mwahaj36/dom-blame
```

Or copy [`.agents/skills/dom-blame`](./.agents/skills/dom-blame/SKILL.md) into your workspace's `.agents/skills/` (or `~/.gemini/antigravity/skills/` / `~/.claude/skills/`) directory.

---

## Verify Locally (Playground)

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
```

See [PRODUCT.md](./PRODUCT.md) for architecture details and [LICENSE](./LICENSE) (MIT).
