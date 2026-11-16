import { detectRequestStorms } from './network';
import type {
  EndpointAudit,
  FlattenedField,
  NetworkRecord,
  OverfetchField,
  OverfetchReport,
} from './types';

const SENSITIVE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /(password|passwd|pwd|secret|token|api_key|auth_)/i, reason: 'credential / auth secret' },
  { re: /(ssn|social_security|tax_id)/i, reason: 'government / tax identifier' },
  { re: /(stripe_|card_|bank_|billing|iban)/i, reason: 'payment / billing identifier' },
  { re: /(salary|compensation|wage|income)/i, reason: 'compensation / payroll data' },
  { re: /(email|phone|mobile|address|ip_address)/i, reason: 'PII / contact field' },
  { re: /(is_admin|admin|role|permission|scope)/i, reason: 'privilege / RBAC field' },
  { re: /(internal_|private_|admin_notes|notes)/i, reason: 'internal-only metadata' },
];

export function classifySensitivity(key: string): { sensitive: boolean; reason: string | null } {
  for (let i = 0; i < SENSITIVE_PATTERNS.length; i++) {
    if (SENSITIVE_PATTERNS[i].re.test(key)) {
      return { sensitive: true, reason: SENSITIVE_PATTERNS[i].reason };
    }
  }
  return { sensitive: false, reason: null };
}

interface DomCorpus {
  fullTextLower: string;
  exactTokens: Set<string>;
  numberValues: Set<number>;
}

function collectDomCorpus(rootEl: Element | null): DomCorpus {
  const exactTokens = new Set<string>();
  const numberValues = new Set<number>();
  if (!rootEl || typeof document === 'undefined') {
    return { fullTextLower: '', exactTokens, numberValues };
  }

  const chunks: string[] = [];
  const walker = document.createTreeWalker(rootEl, 5 /* SHOW_ELEMENT | SHOW_TEXT */);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === 1) {
      const el = node as Element;
      if (el.hasAttribute('data-dom-blame-host')) {
        // Skip our own Shadow DOM host
        node = walker.nextSibling() ?? walker.nextNode();
        continue;
      }
      const attrs = ['value', 'href', 'src', 'alt', 'title', 'aria-label', 'placeholder'];
      for (let i = 0; i < attrs.length; i++) {
        const v = el.getAttribute(attrs[i]);
        if (v) chunks.push(v);
      }
    } else if (node.nodeType === 3) {
      const parent = node.parentElement;
      if (parent && !parent.closest('[data-dom-blame-host]')) {
        const t = node.textContent?.trim();
        if (t) chunks.push(t);
      }
    }
    node = walker.nextNode();
  }

  const fullTextLower = chunks.join(' ').replace(/\s+/g, ' ').toLowerCase();
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    exactTokens.add(trimmed.toLowerCase());
    const words = trimmed.toLowerCase().split(/\s+/);
    for (const w of words) {
      if (w) exactTokens.add(w);
    }
    // Extract currency/numeric tokens like "$1,480.00" -> 1480 and 148000
    const numMatches = trimmed.match(/-?\$?\d[\d,]*(?:\.\d+)?/g);
    if (numMatches) {
      for (const m of numMatches) {
        const cleaned = m.replace(/[$,]/g, '');
        const parsed = Number.parseFloat(cleaned);
        if (Number.isFinite(parsed)) {
          numberValues.add(parsed);
          if (m.includes('$') || m.includes('.')) {
            numberValues.add(Math.round(parsed * 100));
          }
        }
      }
    }
  }

  return { fullTextLower, exactTokens, numberValues };
}

function isFieldRendered(field: FlattenedField, corpus: DomCorpus): boolean {
  const val = field.value;
  if (val === null || val === undefined || val === '') return false;
  if (typeof val === 'boolean') {
    return corpus.exactTokens.has(String(val));
  }
  if (typeof val === 'number') {
    // Avoid matching binary 0/1 flags against arbitrary counts/prices unless explicitly present
    if ((val === 0 || val === 1) && /^(is_|has_|can_|admin|flag)/i.test(field.key)) {
      return false;
    }
    return corpus.numberValues.has(val) || corpus.exactTokens.has(String(val));
  }
  const str = String(val).trim().toLowerCase();
  if (!str) return false;
  if (corpus.exactTokens.has(str)) return true;
  if (str.length >= 3 && corpus.fullTextLower.includes(str)) return true;
  return false;
}

export function auditPageOverfetch(
  records: NetworkRecord[],
  accessedPaths: Set<string>,
  rootEl?: Element | null
): OverfetchReport {
  const targetRoot = rootEl ?? (typeof document !== 'undefined' ? document.body : null);
  const corpus = collectDomCorpus(targetRoot);
  const storms = detectRequestStorms(records);
  const stormSet = new Set(storms.map((s) => s.endpoint));

  // Group records by normalized endpoint ("METHOD /path")
  const byEndpoint = new Map<string, NetworkRecord[]>();
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.fields.length === 0) continue;
    const epKey = `${r.method} ${r.normalizedEndpoint}`;
    const list = byEndpoint.get(epKey);
    if (list) list.push(r);
    else byEndpoint.set(epKey, [r]);
  }

  const endpoints: EndpointAudit[] = [];
  let totalSchemaFields = 0;
  let renderedSchemaFields = 0;
  let sensitiveFindingsCount = 0;

  for (const [epKey, epRecords] of byEndpoint.entries()) {
    const latest = epRecords[epRecords.length - 1];
    // Aggregate unique schema paths (e.g. $.[*].salary_usd) from the latest response
    const schemaGroups = new Map<string, { fields: FlattenedField[]; accessed: boolean }>();
    for (const f of latest.fields) {
      // Collapse array index in accessedPath check too
      const isAccessed = accessedPaths.has(`${latest.id}:${f.path}`);
      const existing = schemaGroups.get(f.schemaKey);
      if (existing) {
        existing.fields.push(f);
        if (isAccessed) existing.accessed = true;
      } else {
        schemaGroups.set(f.schemaKey, { fields: [f], accessed: isAccessed });
      }
    }

    let epRendered = 0;
    const unrenderedList: OverfetchField[] = [];
    let epSensitive = 0;

    for (const [, group] of schemaGroups.entries()) {
      const sample = group.fields[0];
      const rendered = group.fields.some((item) => isFieldRendered(item, corpus));
      if (rendered) {
        epRendered++;
      } else {
        const sens = classifySensitivity(sample.key);
        if (sens.sensitive) epSensitive++;
        unrenderedList.push({
          key: sample.key,
          samplePath: sample.path,
          sampleValue: sample.value,
          accessedInJs: group.accessed,
          renderedInDom: false,
          sensitive: sens.sensitive,
          sensitivityReason: sens.reason,
        });
      }
    }

    // Sort unrendered: sensitive first, then alphabetical
    unrenderedList.sort((a, b) => {
      if (a.sensitive !== b.sensitive) return a.sensitive ? -1 : 1;
      return a.key.localeCompare(b.key);
    });

    const total = schemaGroups.size;
    const unrendered = total - epRendered;
    const ratio = total > 0 ? Math.round((unrendered / total) * 1000) / 1000 : 0;
    const avgDuration = Math.round(
      (epRecords.reduce((s, r) => s + r.durationMs, 0) / epRecords.length) * 10
    ) / 10;

    totalSchemaFields += total;
    renderedSchemaFields += epRendered;
    sensitiveFindingsCount += epSensitive;

    endpoints.push({
      endpoint: latest.normalizedEndpoint,
      method: latest.method,
      status: latest.status,
      requestCount: epRecords.length,
      avgDurationMs: avgDuration,
      totalSchemaFields: total,
      renderedFields: epRendered,
      unrenderedFields: unrendered,
      overfetchRatio: ratio,
      sensitiveCount: epSensitive,
      nPlusOneSuspected: stormSet.has(epKey),
      unrenderedList,
      sqlQueryCount: latest.sqlQueries.length,
    });
  }

  endpoints.sort((a, b) => {
    if (a.sensitiveCount !== b.sensitiveCount) return b.sensitiveCount - a.sensitiveCount;
    return b.overfetchRatio - a.overfetchRatio;
  });

  const unrenderedSchemaFields = totalSchemaFields - renderedSchemaFields;
  const overallOverfetchRatio = totalSchemaFields > 0
    ? Math.round((unrenderedSchemaFields / totalSchemaFields) * 1000) / 1000
    : 0;

  return {
    pageUrl: typeof window !== 'undefined' ? window.location.href : 'http://localhost',
    capturedAt: Date.now(),
    totalEndpoints: endpoints.length,
    totalSchemaFields,
    renderedSchemaFields,
    unrenderedSchemaFields,
    overallOverfetchRatio,
    sensitiveFindingsCount,
    requestStorms: storms,
    endpoints,
  };
}
