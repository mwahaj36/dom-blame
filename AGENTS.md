# `dom-blame` — Agent Engineering & Design Rules (`AGENTS.md`)

You are working on **`dom-blame`** (`npx dom-blame`), a zero-config full-stack runtime lineage inspector (`DOM Pixel ← React Prop ← HTTP JSON Field ← SQL Query`) and unrendered payload leak detector (`LeakPeek`).

## Mandatory Skill Activation & Engineering Standards

Before writing code or designing UI components in this repository, adhere strictly to the installed skills in `.agents/skills/`:

1. **Code Minimalism (`ponytail`, `ponytail-review`, `ponytail-audit`):**
   * Act like the laziest senior engineer in the room: *the best code is the code you never wrote.*
   * Use native browser APIs (`ShadowRoot`, `Proxy`, `WeakMap`, `PerformanceObserver`, `CustomEvent`) instead of pulling in heavy npm runtime dependencies.
   * Keep the injectable browser runtime (`dom-blame` overlay + network interceptor) dependency-free and fast.

2. **Visual Craft & Anti-Slop (`apple-design`, `impeccable`, `unslop`):**
   * The `dom-blame` in-browser HUD overlay, Chrome Extension popup, and Demo Playground must look like a flagship Apple / Linear / Raycast developer tool.
   * **No AI UI Slop:** Never use generic purple-to-blue gradients, neon cyberpunk clutter, emoji soup, or sloppy spacing.
   * **Craft Details:** Use Shadow DOM encapsulation, translucent dark glass (`rgba(14, 14, 16, 0.88)` with `backdrop-filter: blur(16px)`), crisp `1px solid rgba(255, 255, 255, 0.08)` hairlines, monospace tabular numerals (`font-variant-numeric: tabular-nums`), and snappy spring-physics transitions (`cubic-bezier(0.22, 1, 0.36, 1)`).

3. **MCP & React Best Practices (`mcp-builder`, `react-best-practices`):**
   * Follow `mcp-builder` standards when implementing the `dom-blame` MCP server tools so Claude Code and Cursor can consume blame capsules deterministically.
   * Follow `react-best-practices` in the demo playground and React Fiber traversal utilities.

## Repository Rules
* **NEVER track or commit `ROADMAP.md`.** `ROADMAP.md` is strictly local and listed in `.gitignore`.
* Keep `PRODUCT.md` updated as the canonical product specification and competitive analysis.
