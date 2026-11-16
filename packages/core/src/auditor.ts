import { tokenizeKey } from './lineage';
import { detectRequestStorms } from './network';
import type {
  EndpointAudit,
  FlattenedField,
  NetworkRecord,
  OverfetchField,
  OverfetchReport,
} from './types';

const EXACT_OR_COMPOUND_RULES: Array<{ tokens?: Set<string>; re?: RegExp; reason: string }> = [
  {
    tokens: new Set(['password', 'passwd', 'pwd', 'secret', 'apikey', 'jwt']),
    re: /(?:^|_)(password_hash|api_key|secret_key|private_key|access_token|refresh_token|auth_token|session_token|bearer_token|auth_providers|has_password|has_totp|temp_clone_token)(?:$|_)/i,
    reason: 'credential / auth secret',
  },
  {
    tokens: new Set(['ssn', 'ein']),
    re: /(?:^|_)(social_security|tax_id|ssn_last4)(?:$|_)/i,
    reason: 'government / tax identifier',
  },
  {
    tokens: new Set(['iban']),
    re: /(?:^|_)(stripe_customer_id|stripe_subscription_id|card_last4|card_number|cvv|bank_account|routing_number|billing_address)(?:$|_)/i,
    reason: 'payment / billing identifier',
  },
  {
    tokens: new Set(['salary', 'compensation', 'wage']),
    re: /(?:^|_)(salary_usd|annual_income)(?:$|_)/i,
    reason: 'compensation / payroll data',
  },
  {
    tokens: new Set(['email', 'phone', 'mobile']),
    re: /(?:^|_)(personal_email|user_email|contact_email|support_email|work_email|email_from|phone_number|mobile_number|ip_address|client_ip|user_ip|home_address|street_address|shipping_address)(?:$|_)/i,
    reason: 'PII / contact field',
  },
  {
    tokens: new Set(['permissions']),
    re: /(?:^|_)(is_admin|is_superuser|organization_permissions)(?:$|_)/i,
    reason: 'privilege / RBAC field',
  },
  {
    re: /(?:^|_)(internal_notes|admin_notes|private_notes|staff_notes)(?:$|_)/i,
    reason: 'internal-only metadata',
  },
];

const HARMLESS_SUFFIX_RE = /(?:_TEXT|_TITLE|_LABEL|_DESCRIPTION|_REQUIRED|_PLACEHOLDER|Description|_URL|_NAME|_ENABLED|_VERIFIED|_SENT_AT)$/i;

export function classifySensitivity(key: string): { sensitive: boolean; reason: string | null } {
  // Ignore CSS custom properties, UI copy/translation keys, and URL/boolean metadata
  if (key.startsWith('--')) return { sensitive: false, reason: null };
  if (HARMLESS_SUFFIX_RE.test(key)) return { sensitive: false, reason: null };

  const tokens = tokenizeKey(key);
  const snake = tokens.join('_');
  if (HARMLESS_SUFFIX_RE.test(snake)) return { sensitive: false, reason: null };

  // Avoid flagging generic multi-token metadata like email_from_name, email_banner_url, phone_verified
  const isSingleEmailOrPhone = snake === 'email' || snake === 'phone' || snake === 'mobile';

  for (let i = 0; i < EXACT_OR_COMPOUND_RULES.length; i++) {
    const rule = EXACT_OR_COMPOUND_RULES[i];
    if (rule.re && rule.re.test(snake)) {
      return { sensitive: true, reason: rule.reason };
    }
    if (rule.tokens) {
      for (let j = 0; j < tokens.length; j++) {
        const tok = tokens[j];
        if ((tok === 'email' || tok === 'phone' || tok === 'mobile') && !isSingleEmailOrPhone) {
          continue;
        }
        if (rule.tokens.has(tok)) {
          return { sensitive: true, reason: rule.reason };
        }
      }
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
  let totalPayloadBytes = 0;

  for (const [epKey, epRecords] of byEndpoint.entries()) {
    const latest = epRecords[epRecords.length - 1];
    // Aggregate unique schema paths (e.g. $.[*].salary_usd) from the latest response
    const schemaGroups = new Map<string, { fields: FlattenedField[]; accessed: boolean }>();
    for (const f of latest.fields) {
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
    let epNonNullSensitive = 0;

    for (const [, group] of schemaGroups.entries()) {
      const sample = group.fields.find(
        (item) => item.value !== null && item.value !== undefined && item.value !== ''
      ) ?? group.fields[0];
      const rendered = group.fields.some((item) => isFieldRendered(item, corpus));
      if (rendered) {
        epRendered++;
      } else {
        const sens = classifySensitivity(sample.key);
        const isPopulated = sample.value !== null && sample.value !== undefined && sample.value !== '';
        if (sens.sensitive) {
          epSensitive++;
          if (isPopulated) epNonNullSensitive++;
        }
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

    // Sort unrendered: populated sensitive first, then nullish sensitive, then alphabetical
    unrenderedList.sort((a, b) => {
      if (a.sensitive !== b.sensitive) return a.sensitive ? -1 : 1;
      if (a.sensitive && b.sensitive) {
        const aPop = a.sampleValue !== null && a.sampleValue !== undefined && a.sampleValue !== '';
        const bPop = b.sampleValue !== null && b.sampleValue !== undefined && b.sampleValue !== '';
        if (aPop !== bPop) return aPop ? -1 : 1;
      }
      return a.key.localeCompare(b.key);
    });

    const total = schemaGroups.size;
    const unrendered = total - epRendered;
    const ratio = total > 0 ? Math.round((unrendered / total) * 1000) / 1000 : 0;
    const avgDuration = Math.round(
      (epRecords.reduce((s, r) => s + r.durationMs, 0) / epRecords.length) * 10
    ) / 10;
    const epBytes = epRecords.reduce((s, r) => s + (r.payloadBytes || 0), 0);

    totalSchemaFields += total;
    renderedSchemaFields += epRendered;
    sensitiveFindingsCount += epSensitive;
    totalPayloadBytes += epBytes;

    endpoints.push({
      endpoint: latest.normalizedEndpoint,
      method: latest.method,
      status: latest.status,
      requestCount: epRecords.length,
      avgDurationMs: avgDuration,
      payloadBytes: epBytes,
      totalSchemaFields: total,
      renderedFields: epRendered,
      unrenderedFields: unrendered,
      overfetchRatio: ratio,
      sensitiveCount: epSensitive,
      nonNullSensitiveCount: epNonNullSensitive,
      nPlusOneSuspected: stormSet.has(epKey),
      unrenderedList,
      sqlQueryCount: latest.sqlQueries.length,
    });
  }

  endpoints.sort((a, b) => {
    if (a.nonNullSensitiveCount !== b.nonNullSensitiveCount) return b.nonNullSensitiveCount - a.nonNullSensitiveCount;
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
    totalPayloadBytes,
    totalSchemaFields,
    renderedSchemaFields,
    unrenderedSchemaFields,
    overallOverfetchRatio,
    sensitiveFindingsCount,
    requestStorms: storms,
    endpoints,
  };
}
