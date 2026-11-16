# `dom-blame` (`npx dom-blame`) — Product Specification & Market Analysis

> **`git blame` tells you which commit wrote a line of code.**
> **`dom-blame` tells you which Component, HTTP JSON field, and SQL query rendered a live pixel on screen—and what hidden data leaked along the way.**

---

## 1. The Core Problem We Are Solving

In the era of AI-assisted coding (Claude Code, Cursor, Lovable, Bolt, Windsurf), the engineering bottleneck has shifted from *writing code* to **diagnosing silent runtime bugs and hidden architectural slop**.

When a UI element renders the wrong value—or when a vibe-coded application ships to production—developers and founders hit three invisible walls:

1. **The "200 OK" Silent Bug (Schema & Lineage Drift):**
   * The browser console has `0` errors. The network tab says `200 OK`. Yet a dashboard card displays `$0.00` instead of `$1,450.00`, or `"Free Tier"` instead of `"Pro"`.
   * Why? Because the database column is `sub_status`, the API returned `subscription_tier`, and the React component checked `user.subscriptionStatus`.
   * Existing AI tools (BrowserTools MCP, Sentry) are blind to this because **no error was thrown**.

2. **Silent Payload Overfetching & Data Leaks (`LeakPeek` Engine):**
   * AI coding agents routinely write `SELECT * FROM users` or `prisma.user.findMany()` in backend routes and return the entire database object to the frontend, where the React component only renders `user.name` and `user.avatar`.
   * Meanwhile, `email`, `stripe_customer_id`, `role`, `internal_notes`, and feature flags sit silently inside the browser's network memory—visible to anyone who opens DevTools.

3. **Request Storms & N+1 Cascades:**
   * A single user click triggers 14 duplicate `fetch()` calls or 30 sequential SQL queries due to unoptimized `useEffect` hooks and missing query batching.

---

## 2. What `dom-blame` Does

`dom-blame` is a zero-config, full-stack runtime lineage and payload auditing tool with a craft-grade in-browser HUD (`Alt + Hover` / `Alt + Click`).

It operates in **Two Modes**:

### Mode 1: Local Full-Stack Dev Mode (`npx dom-blame`)
For developers and AI coding agents (via MCP) running locally:
* **Pixel-to-SQL Blame Chain:** Hold `Alt` and click any DOM element (`<Badge>$0.00</Badge>`). `dom-blame` traces the exact causal chain backwards:
  * **DOM Layer:** Text node `"$0.00"` inside `<RevenueCard />` (`src/components/RevenueCard.tsx:42`)
  * **React State/Prop Layer:** Prop `data.totalRevenue` evaluated to `undefined` (fell back to `"$0.00"`)
  * **Network JSON Layer:** `GET /api/metrics` (`200 OK`, `18ms`) returned `{ "total_revenue_cents": 145000 }` -> **🚨 Flagged: Key Mismatch (`totalRevenue` vs `total_revenue_cents`)**
  * **Database / SQL Layer:** Correlated via `x-dom-blame-id` header to `SELECT SUM(amount_cents) AS total_revenue_cents FROM invoices WHERE org_id = $1` (`2.4ms`, 1 row).
* **1-Click "Send Blame Capsule to AI" (MCP Server):** Exports the deterministic full-stack trace directly into Claude Code or Cursor so the agent fixes the exact mismatch in one turn without guessing.

### Mode 2: Live Site Audit / Chrome Extension Mode ("The Client Magnet")
Works on **any live production website** without backend installation:
* **Unrendered JSON Leak Detector (`LeakPeek`):** Compares every JSON field received over `fetch`/`XHR` against the actual text and attributes rendered in the live DOM.
  * Highlights UI cards with a badge: **`2 fields rendered | 🚨 14 unrendered fields exposed in network payload (stripe_id, email, is_admin...)`**
* **Click-to-Waterfall Blame:** Click any button on a live site and see every redundant API call, payload size bloat, and React re-render burst triggered by that interaction.
* **1-Click "Audit Card" Export:** Generates a sleek, Apple/Linear-grade visual diagnostic card ready to share in a 15-second GIF or founder audit report.

---

## 3. Competitive Landscape & Market Analysis

| Competitor | What They Do Well | Where They Stop (Our Wedge) |
| :--- | :--- | :--- |
| **React Grab** (`npx grab`) | Fast `Cmd+C` on a DOM element to grab the React component file path (`Card.tsx:42`). | **100% blind to Network & Backend.** If the bug is in the API JSON key or SQL query, React Grab points the AI at the wrong layer (the React component). |
| **Stagewise** | Browser toolbar to select DOM elements and prompt an IDE agent for CSS/UI tweaks. | Built for visual styling/layout tweaks, not data lineage, API overfetching, or backend SQL debugging. |
| **react-data-xray (RDX)** | Dev-only React library that maps a screen value to its `fetch` JSON path. | Clunky name, stops at the frontend `fetch` boundary (no SQL/Backend bridge, no MCP server, no unrendered PII/overfetch leak detector, no live-site extension mode for auditing external apps). |
| **BrowserTools MCP** | Streams Chrome console errors and raw network logs to Cursor/Claude. | **Only useful when an exception (`500` or `console.error`) occurs.** Completely useless on silent `"200 OK"` bugs where the wrong value rendered or hidden fields leaked. |
| **Sentry Spotlight** | Local OpenTelemetry sidecar for traces and logs. | Heavy SDK configuration required across stack; trace-list UI instead of point-and-click pixel blame; cannot audit external production sites. |

### Why `dom-blame` Wins
1. **Instant Mental Model:** Everyone knows `git blame`. "`dom-blame` is `git blame` for live pixels" requires zero explanation on Hacker News, Reddit, or X.
2. **Traces Values & Leaks, Not Just Errors:** Catches silent schema drift (`camelCase` vs `snake_case`) and overfetched/leaked JSON fields even when every HTTP status is `200 OK`.
3. **Dual Engine (DevTool + Outbound Client Engine):** Serves open-source developers locally via `npx dom-blame` + MCP, while serving solo consultants/agencies externally via the Live Audit Extension.

---

## 4. Design & Engineering Principles (Powered by Installed Skills)

Even though `dom-blame` is a developer tool, **visual craft is our #1 distribution moat**. A developer tool goes viral on X and Reddit when the 15-second screen recording looks like an Apple/Linear product rather than a clunky 1998 DevTools tab.

* **`ponytail` Philosophy (Code Minimalism):**
  * The core injected script must be zero-dependency, vanilla TypeScript/JS, under `<15KB` gzipped, using native Web APIs (`ShadowRoot`, `Proxy`, `PerformanceObserver`, React internal `__reactFiber$`).
* **`apple-design` + `impeccable` + `unslop` Philosophy (Visual Craft):**
  * The floating HUD overlay, targeting reticle, and exported "Audit Cards" must use crisp spring physics, translucent glassmorphism (`backdrop-filter: blur(16px)`), tabular monospace numbers (`font-variant-numeric: tabular-nums`), subtle 1px borders, and high-contrast semantic badges—zero generic AI purple gradients or visual clutter.
