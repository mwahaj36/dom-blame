# `dom-blame` — Product Specification & Architecture

> **`git blame` tells you which commit wrote a line of code.**
> **`dom-blame` tells you which Component, HTTP JSON field, and SQL query rendered a live DOM element—and which network fields were fetched but never rendered.**

---

## 1. Problem Statement

Modern full-stack applications suffer from three categories of runtime defects that traditional error trackers and static linters cannot catch because **no exception is thrown (`200 OK`, `0` console errors)**:

1. **Silent Schema & Lineage Drift:**
   * A UI element displays a fallback value (`$0.00`, `N/A`, or `"Free Tier"`) even though the database and API returned valid data.
   * Typical cause: naming or structural drift across layers (e.g., Postgres returns `sub_status`, the API serializes `subscription_tier`, and the React component reads `user.subscriptionStatus`).
   * Because the HTTP status is `200 OK` and `undefined` renders silently in JSX, error monitors never trigger.

2. **Payload Overfetching & Unrendered Field Exposure:**
   * Backend routes routinely return full ORM entities (`SELECT *` or `findMany()`) while the UI component only consumes 2–3 properties.
   * Sensitive or internal fields (`email`, `stripe_customer_id`, `role`, `internal_notes`, feature flags) are serialized over the wire into browser memory despite never being rendered in the DOM.

3. **Interaction-Triggered Request Storms (N+1 Cascades):**
   * A single user interaction or component mount triggers redundant `fetch`/`XHR` calls or sequential SQL queries due to unbatched effects or cache key mismatches.

---

## 2. Solution Overview

`dom-blame` is a zero-config runtime lineage inspector and payload auditor. Holding `Alt` and clicking any element in the browser traces the exact data lineage of that element from the pixel on screen back to the database query.

### Core Capabilities

#### 1. Full-Stack Data Lineage (`Pixel ← Prop ← JSON ← SQL`)
When inspecting a DOM node (`Alt + Click`), `dom-blame` resolves:
* **DOM & Component Layer:** Extracts the owning component hierarchy, source file path, line number, and live props/state via framework internals (`__reactFiber$`).
* **Network JSON Layer:** Matches the rendered value (or `undefined` prop) against captured `fetch`/`XHR` JSON payloads. If a prop evaluated to `undefined`, fuzzy key matching identifies candidate fields in the JSON response (e.g., flagging `totalRevenue` vs `total_revenue_cents`).
* **Database / SQL Layer:** Correlates the HTTP request via an injected `x-dom-blame-id` header with backend middleware to display the exact SQL statements, row counts, and execution times that produced the payload.

#### 2. Payload Overfetch & Exposure Auditing
* Compares all JSON properties received across `fetch`/`XHR` responses against values actually read by components or rendered into the DOM.
* Reports the **Overfetch Ratio** per endpoint and flags unrendered fields sitting in client memory.

#### 3. MCP Integration for Coding Agents
* Exposes structured runtime blame capsules over the Model Context Protocol (MCP), allowing local coding agents to read the exact `DOM -> Prop -> JSON -> SQL` mismatch directly rather than guessing from static source files.

---

## 3. Ecosystem Comparison

| Tool | Primary Focus | Architectural Limitation |
| :--- | :--- | :--- |
| **React Grab** (`npx grab`) | Copies React component file path (`Card.tsx:42`) from a clicked DOM element. | **Frontend-only.** Stops at the component file; cannot see whether an incorrect value came from an API key mismatch or a bad SQL query. |
| **Stagewise** | Browser toolbar for selecting DOM elements to prompt UI/CSS edits. | Designed for layout and styling adjustments rather than runtime data lineage or payload auditing. |
| **react-data-xray (RDX)** | Maps rendered text in React to `fetch` JSON paths. | Stops at the client network boundary (no backend/SQL correlation, no schema-drift fuzzy matching on `undefined` props, no MCP server, and requires bundler installation). |
| **BrowserTools MCP** | Streams Chrome console logs and raw network tabs to an IDE agent. | **Exception-driven.** Does not trace silent `200 OK` data mismatches or correlate specific DOM nodes to specific JSON fields and SQL queries. |
| **Sentry Spotlight** | Local OpenTelemetry sidecar for development traces and logs. | Requires multi-layer OpenTelemetry SDK instrumentation and presents a chronological trace table rather than direct DOM element inspection. |

---

## 4. Technical & Design Principles

* **Zero-Dependency Runtime:** The browser inspector and network interceptor are written in vanilla TypeScript using native Web APIs (`ShadowRoot`, `Proxy`, `WeakMap`, `PerformanceObserver`) with zero runtime dependencies and `<15KB` gzipped footprint.
* **Strict Style Isolation:** The in-browser inspector renders inside a closed/isolated `ShadowRoot` so host application styles never bleed into the inspector, and inspector styles never affect page layout.
* **High-Precision UI:** Built for fast developer ergonomics—keyboard-first navigation, crisp `1px` structural borders, tabular monospace metrics (`font-variant-numeric: tabular-nums`), and clear visual hierarchy across the 4-layer stack trace.
