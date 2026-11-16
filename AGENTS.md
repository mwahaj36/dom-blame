# `dom-blame` — Engineering & Design Rules (`AGENTS.md`)

`dom-blame` is a zero-config full-stack runtime lineage inspector (`DOM ← Component Prop ← HTTP JSON ← SQL`) and payload overfetch auditor.

## Engineering Standards

1. **Minimalism & Native Platform APIs (`ponytail`):**
   * Prefer native Web and Node APIs (`ShadowRoot`, `Proxy`, `WeakMap`, `PerformanceObserver`, `AsyncLocalStorage`) over external npm dependencies.
   * Keep the injectable browser script lightweight (`<15KB` gzipped) and zero-dependency.
   * Avoid unnecessary abstractions, wrapper classes, or speculative configuration options.

2. **UI Precision & Anti-Slop (`apple-design`, `impeccable`, `unslop`):**
   * All UI surfaces (the Shadow DOM inspector overlay, extension popup, and demo playground) must maintain clean, high-density developer ergonomics.
   * Avoid decorative gradients, excessive glow effects, emoji clutter, or generic marketing copy.
   * Use consistent spacing tokens, subtle `1px` borders, tabular monospace numerals (`font-variant-numeric: tabular-nums`), and responsive keyboard-first interactions.

3. **Framework & Protocol Best Practices (`mcp-builder`, `vercel-react-best-practices`):**
   * Follow MCP specification best practices for deterministic tool schemas and concise payload serialization.
   * Ensure React Fiber inspection works cleanly across React 18 and 19 without mutating host application state.

## Repository Hygiene
* Keep `ROADMAP.md` untracked (listed in `.gitignore`).
* Keep `PRODUCT.md` focused strictly on technical specification, problem scope, and architecture.
