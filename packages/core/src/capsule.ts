import type { BlameCapsule, OverfetchReport } from './types';

export function formatCapsuleMarkdown(capsule: BlameCapsule): string {
  const lines: string[] = [];
  const comp = capsule.element.primaryComponent;
  const loc = comp?.fileName
    ? `${comp.fileName}${comp.lineNumber ? `:${comp.lineNumber}` : ''}`
    : capsule.element.selector;

  lines.push(`# dom-blame Capsule (${capsule.capsuleId})`);
  lines.push(`- **DOM:** \`<${capsule.element.tagName}>\` "${capsule.element.text || '(empty)'}" (\`${capsule.element.selector}\`)`);
  lines.push(
    comp
      ? `- **Component:** \`<${comp.name} />\` (\`${loc}\`)`
      : `- **Element:** \`${capsule.element.selector}\` (non-React DOM node)`
  );

  if (capsule.schemaDrifts.length > 0) {
    lines.push('');
    lines.push('## Schema Drift Detected');
    for (const d of capsule.schemaDrifts) {
      lines.push(
        `- **Culprit:** Component read \`${d.expectedKey}\` (\`undefined\`), API \`${d.endpoint}\` returned \`${d.jsonPath}\` = \`${JSON.stringify(d.actualValue)}\` (${d.reason}, confidence ${Math.round(d.confidence * 100)}%)`
      );
    }
  }

  if (capsule.lineageMatches.length > 0) {
    lines.push('');
    lines.push('## HTTP JSON Lineage');
    for (const m of capsule.lineageMatches) {
      lines.push(
        `- \`${m.method} ${m.normalizedEndpoint}\` (${m.status}, ${m.durationMs}ms) -> \`${m.jsonPath}\` = \`${JSON.stringify(m.value)}\` (${m.matchType})`
      );
    }
  }

  if (capsule.sqlQueries.length > 0) {
    lines.push('');
    lines.push('## Correlated SQL Queries');
    for (const q of capsule.sqlQueries) {
      lines.push(`- \`${q.sql}\` (params: \`${JSON.stringify(q.params)}\`, rows: ${q.rowCount}, ${q.durationMs}ms)`);
    }
  }

  if (capsule.endpointOverfetch && capsule.endpointOverfetch.unrenderedList.length > 0) {
    const ep = capsule.endpointOverfetch;
    lines.push('');
    lines.push(
      `## Endpoint Overfetch (\`${ep.method} ${ep.endpoint}\` — ${Math.round(ep.overfetchRatio * 100)}% overfetched)`
    );
    const sensitive = ep.unrenderedList.filter((f) => f.sensitive);
    if (sensitive.length > 0) {
      lines.push(`- **Sensitive Unrendered Fields:** ${sensitive.map((f) => `\`${f.key}\``).join(', ')}`);
    }
  }

  return lines.join('\n');
}

export async function postToMcpBridge(
  bridgeUrl: string | null | undefined,
  path: '/capsule' | '/overfetch',
  payload: BlameCapsule | OverfetchReport,
  nativeFetch: typeof fetch
): Promise<void> {
  if (!bridgeUrl) return;
  try {
    const cleanBase = bridgeUrl.replace(/\/+$/, '');
    await nativeFetch(`${cleanBase}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dom-blame-internal': '1',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // MCP bridge is optional; ignore connection refused when not running
  }
}
