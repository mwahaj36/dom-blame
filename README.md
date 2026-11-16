# `dom-blame`

> **`git blame` for live pixels.**
> `Alt + Click` any DOM element to trace its **React component prop $\leftarrow$ HTTP JSON field $\leftarrow$ SQL query**, and expose **unrendered JSON fields leaked over the network**.

See [PRODUCT.md](./PRODUCT.md) for the full product specification, architecture, and competitive analysis.

## Agent Skill

Install the `dom-blame` development skill directly into Antigravity, Claude Code, Cursor, or Codex CLI so your coding agent can wire up `@dom-blame/server` + `@dom-blame/mcp` and debug live UI/API/SQL bugs automatically:

```bash
npx skills add mwahaj36/dom-blame
```

Or copy [`.agents/skills/dom-blame`](./.agents/skills/dom-blame/SKILL.md) into your workspace's `.agents/skills/` (or `~/.gemini/antigravity/skills/` / `~/.claude/skills/`) directory.
