---
name: dom-blame
description: >-
  Instrument and use dom-blame during full-stack React, Next.js, or Express
  development to trace any clicked DOM element back through its React Fiber
  component, HTTP JSON field (including casing/unit schema drift), and
  backend SQL queries via MCP, or audit pages for unrendered PII overfetching
  and N+1 request storms. Activate when debugging mismatched UI data, wiring
  @dom-blame/server or @dom-blame/mcp, or running an overfetch audit.
---

# `dom-blame` Full-Stack Dev & MCP Debugging Workflow

Use `dom-blame` to connect live browser pixels directly to component code, API JSON payloads, and backend SQL traces while building React/Next.js/Express apps.

---

## 1. Wire `dom-blame` Into a Local Dev App (4 Layers + MCP)

Keep instrumentation dev-only (`NODE_ENV !== 'production'`).

### 1. Install Dev Packages

```bash
npm install -D dom-blame @dom-blame/server @dom-blame/mcp
```

### Browser Client (`dom-blame`)

Call `initDomBlame()` once in the client entry (before app renders so initial boot fetches are intercepted):

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

> Or sideload the prebuilt MV3 extension from `apps/extension/dist` (or GitHub Releases `dom-blame-extension-v1.0.0.zip`) in `chrome://extensions` with **Auto-inject on load** enabled if you cannot modify client code yet.

### Backend Middleware & SQL Hooks (`@dom-blame/server`)

1. **Express / Connect:**
   ```ts
   import { domBlameMiddleware, instrumentBetterSqlite3, instrumentPg } from '@dom-blame/server';

   // Dev-only by default (enabled: process.env.NODE_ENV !== 'production')
   app.use(domBlameMiddleware());

   // Instrument your DB handle once on startup:
   const db = instrumentBetterSqlite3(sqliteDb); // better-sqlite3
   // OR: const pool = instrumentPg(pgPool);     // node-postgres (pg)
   // OR: prisma.$extends(createPrismaExtension());
   ```

2. **Next.js App Router / Web Request Handlers:**
   ```ts
   import { withDomBlame } from '@dom-blame/server';

   export const GET = withDomBlame(async (req) => {
     // DB queries run inside AsyncLocalStorage trace automatically
     return Response.json(data);
   });
   ```

> For custom query builders or ORMs, wrap individual calls with `traceQuery(sql, params, async () => ...)`.

### MCP Server (`@dom-blame/mcp`)

Configure your coding agent's MCP config (Cursor, Claude Code, Antigravity) to run `@dom-blame/mcp`:

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

*(If running only the HTTP collector without MCP stdio, start with `--bridge-only`; the bridge listens on `http://127.0.0.1:4119` by default.)*

---

## 2. AI-Assisted Debugging Loop (When Fixing Bugs)

1. Have the user hold `Alt + Click` (or click **Inspect**) on the broken UI element in Chrome.
2. Call MCP tool **`get_latest_blame_capsule`**:
   - Inspect `element.primaryComponent` (`fileName`, `lineNumber`, `props`) to jump straight to the React component.
   - Check `schemaDrifts` immediately for silent 200 OK mismatches (e.g., UI read `mrrCents` -> `undefined`, API returned `$.mrr_cents` = `148000`).
   - Check `lineageMatches` for the exact HTTP endpoint + JSONPath driving that node.
3. Call MCP tool **`get_sql_queries_for_element`** (with `capsule_id` or `endpoint`) to inspect correlated backend SQL, bound params, row counts, durations, and server-side N+1 loops.
4. Before finalizing a feature or PR, call MCP tool **`list_overfetched_endpoints`** (`sensitive_only: true` or `min_overfetch_ratio: 0.5`) to spot:
   - Sensitive unrendered fields sitting in browser memory (`personal_email`, `ssn_last4`, `stripe_customer_id`, `password_hash`, `is_admin`, `internal_notes`).
   - Frontend N+1 request storms (>= 4 calls to the same endpoint within 2000ms).

---

## 3. Verification Checklist

After wiring `dom-blame` into a project:

1. Check `GET http://127.0.0.1:4119/health` returns `200 OK` when the MCP server/bridge is active.
2. Confirm browser API requests carry `x-dom-blame-id` in DevTools Network headers and dev server responses return `x-dom-blame-sql` or `x-dom-blame-trace-url`.
3. `Alt + Click` any data-driven UI element and verify **get_latest_blame_capsule** returns all 4 populated layers (`DOM Node`, `Component`, `HTTP JSON`, `SQL Query`).
