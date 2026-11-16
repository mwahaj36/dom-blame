import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatCapsuleMarkdown } from 'dom-blame';
import { z } from 'zod';
import type { BridgeHandle } from './types';

export const CHARACTER_LIMIT = 25000;

const ResponseFormatSchema = z
  .enum(['markdown', 'json'])
  .default('markdown')
  .describe("Output format: 'markdown' for concise human-readable text or 'json' for structured data");

function clampOutput(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return `${text.slice(0, CHARACTER_LIMIT - 80)}\n\n...[truncated at ${CHARACTER_LIMIT} chars; use filters or smaller limit]`;
}

export function createDomBlameMcpServer(bridge: BridgeHandle): McpServer {
  const server = new McpServer({
    name: 'dom-blame-mcp-server',
    version: '1.0.0',
  });

  server.registerTool(
    'get_latest_blame_capsule',
    {
      title: 'Get Latest Blame Capsule',
      description: `Retrieve the most recent DOM element blame capsule captured when the developer Alt+Clicked an element in the browser.

Returns the full 4-layer runtime lineage (DOM Node <- Component Prop <- HTTP JSON Path <- SQL Query), plus any detected schema drift (e.g. camelCase vs snake_case mismatch) and endpoint overfetch context.

Args:
  - index (number): 0-based history offset (0 = latest capsule, default: 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
      inputSchema: {
        index: z.number().int().min(0).max(49).default(0).describe('0-based index into recent pinned blame capsules'),
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ index, response_format }) => {
      const state = await bridge.getState();
      const capsule = state.capsules[index];
      if (!capsule) {
        return {
          content: [
            {
              type: 'text',
              text:
                state.capsules.length === 0
                  ? 'No blame capsules captured yet. Hold Alt and click any DOM element in the browser with dom-blame active.'
                  : `No capsule at index ${index}. Available capsules: ${state.capsules.length} (indices 0..${state.capsules.length - 1}).`,
            },
          ],
        };
      }

      const text = response_format === 'json'
        ? JSON.stringify(capsule, null, 2)
        : formatCapsuleMarkdown(capsule);

      return {
        content: [{ type: 'text', text: clampOutput(text) }],
        structuredContent: capsule as unknown as Record<string, unknown>,
      };
    }
  );

  server.registerTool(
    'list_overfetched_endpoints',
    {
      title: 'List Overfetched Endpoints',
      description: `List API endpoints captured in the active browser session along with their Payload Overfetch Ratio, unrendered fields sitting in browser memory, sensitive field exposures (email, stripe_*, salary_usd, is_admin, internal_notes, etc.), and N+1 request storm alerts.

Args:
  - min_overfetch_ratio (number): Filter endpoints with overfetchRatio >= threshold (0..1, default: 0)
  - sensitive_only (boolean): Return only endpoints with sensitive unrendered fields (default: false)
  - page_url (string): Optional exact page URL to inspect instead of latest report
  - limit (number): Max endpoints to return (1..50, default: 20)
  - offset (number): Pagination offset (default: 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
      inputSchema: {
        min_overfetch_ratio: z.number().min(0).max(1).default(0).describe('Minimum overfetch ratio (0 to 1)'),
        sensitive_only: z.boolean().default(false).describe('Filter to endpoints exposing sensitive unrendered fields'),
        page_url: z.string().optional().describe('Specific page URL to inspect'),
        limit: z.number().int().min(1).max(50).default(20).describe('Maximum endpoints to return'),
        offset: z.number().int().min(0).default(0).describe('Offset for pagination'),
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ min_overfetch_ratio, sensitive_only, page_url, limit, offset, response_format }) => {
      const state = await bridge.getState();
      const report = page_url ? state.overfetchByUrl[page_url] ?? null : state.latestOverfetch;

      if (!report) {
        return {
          content: [
            {
              type: 'text',
              text: 'No overfetch audit report received yet. Load or interact with a page running dom-blame.',
            },
          ],
        };
      }

      const filtered = report.endpoints.filter((ep) => {
        if (ep.overfetchRatio < min_overfetch_ratio) return false;
        if (sensitive_only && ep.sensitiveCount === 0) return false;
        return true;
      });
      const items = filtered.slice(offset, offset + limit);
      const output = {
        pageUrl: report.pageUrl,
        total: filtered.length,
        count: items.length,
        offset,
        has_more: filtered.length > offset + items.length,
        overallOverfetchRatio: report.overallOverfetchRatio,
        sensitiveFindingsCount: report.sensitiveFindingsCount,
        requestStorms: report.requestStorms,
        endpoints: items,
      };

      let text: string;
      if (response_format === 'json') {
        text = JSON.stringify(output, null, 2);
      } else {
        const lines = [
          `# Overfetch Report (${report.pageUrl})`,
          `- Overall Overfetch: ${Math.round(report.overallOverfetchRatio * 100)}% (${report.renderedSchemaFields}/${report.totalSchemaFields} schema fields rendered)`,
          `- Sensitive Unrendered Fields: ${report.sensitiveFindingsCount}`,
          '',
        ];
        if (report.requestStorms.length > 0) {
          lines.push('## N+1 Request Storms');
          for (const s of report.requestStorms) {
            lines.push(`- \`${s.endpoint}\`: ${s.count} requests in ${s.windowMs}ms (${s.totalDurationMs}ms total)`);
          }
          lines.push('');
        }
        for (const ep of items) {
          lines.push(
            `## \`${ep.method} ${ep.endpoint}\` — ${Math.round(ep.overfetchRatio * 100)}% overfetched (${ep.renderedFields}/${ep.totalSchemaFields} rendered)`
          );
          if (ep.unrenderedList.length > 0) {
            const sensitive = ep.unrenderedList.filter((f) => f.sensitive).map((f) => `${f.key} (${f.sensitivityReason})`);
            const other = ep.unrenderedList.filter((f) => !f.sensitive).map((f) => f.key);
            if (sensitive.length > 0) lines.push(`- **Sensitive Unrendered:** ${sensitive.join(', ')}`);
            if (other.length > 0) lines.push(`- **Other Unrendered:** ${other.join(', ')}`);
          }
          lines.push('');
        }
        text = lines.join('\n');
      }

      return {
        content: [{ type: 'text', text: clampOutput(text) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );

  server.registerTool(
    'get_sql_queries_for_element',
    {
      title: 'Get SQL Queries For Element',
      description: `Return all correlated backend SQL queries, bound parameters, row counts, and execution timings (ms) for a pinned DOM element blame capsule or filtered by API endpoint.

Args:
  - capsule_id (string): Optional capsuleId to look up (defaults to latest pinned capsule)
  - endpoint (string): Optional normalized endpoint path (e.g. '/api/metrics') to filter SQL traces
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
      inputSchema: {
        capsule_id: z.string().optional().describe('Specific capsuleId to inspect; defaults to latest'),
        endpoint: z.string().optional().describe('Filter SQL queries to a specific normalized endpoint'),
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ capsule_id, endpoint, response_format }) => {
      const state = await bridge.getState();
      const capsule = capsule_id
        ? state.capsules.find((c) => c.capsuleId === capsule_id) ?? null
        : state.latestCapsule;

      if (!capsule) {
        return {
          content: [
            {
              type: 'text',
              text: capsule_id
                ? `Capsule "${capsule_id}" not found in active session.`
                : 'No blame capsules captured yet. Alt+Click an element in the browser first.',
            },
          ],
        };
      }

      let queries = capsule.sqlQueries;
      if (endpoint) {
        const fromMatches = capsule.lineageMatches
          .filter((m) => m.normalizedEndpoint === endpoint)
          .flatMap((m) => m.sqlQueries);
        const fromDrifts = capsule.schemaDrifts
          .filter((d) => d.endpoint === endpoint)
          .flatMap((d) => d.sqlQueries);
        queries = [...fromMatches, ...fromDrifts];
      }

      const totalMs = Math.round(queries.reduce((s, q) => s + q.durationMs, 0) * 100) / 100;
      const output = {
        capsuleId: capsule.capsuleId,
        component: capsule.element.primaryComponent?.name ?? null,
        selector: capsule.element.selector,
        queryCount: queries.length,
        totalDurationMs: totalMs,
        nPlusOneWarning: queries.length > 3,
        queries,
      };

      const text = response_format === 'json'
        ? JSON.stringify(output, null, 2)
        : [
            `# SQL Queries for \`${output.component ? `<${output.component} />` : output.selector}\` (${queries.length} queries, ${totalMs}ms)`,
            ...(queries.length === 0
              ? ['- No SQL queries recorded for this element. Ensure `@dom-blame/server` middleware is attached.']
              : queries.map(
                  (q, idx) =>
                    `${idx + 1}. \`${q.sql}\` — **${q.rowCount} rows**, **${q.durationMs}ms**, params: \`${JSON.stringify(q.params)}\``
                )),
          ].join('\n');

      return {
        content: [{ type: 'text', text: clampOutput(text) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );

  return server;
}
