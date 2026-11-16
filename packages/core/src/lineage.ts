import type {
  ElementInspection,
  FlattenedField,
  NetworkLineageMatch,
  NetworkRecord,
  PropertyMiss,
  SchemaDriftFinding,
  SqlQueryTrace,
} from './types';

const UNIT_SUFFIXES = new Set([
  'cents', 'cent', 'usd', 'eur', 'gbp', 'ms', 'sec', 'seconds', 'at', 'ts',
  'timestamp', 'date', 'id', 'str', 'num', 'count', 'total', 'flag', 'val', 'value', 'raw',
]);

const FALLBACK_TEXT_RE = /^(\$?0(\.0+)?|n\/a|na|none|null|undefined|unknown|free tier|—|-|\s*)$/i;

export function flattenJson(value: unknown, prefix = '$', schemaPrefix = '$', out: FlattenedField[] = []): FlattenedField[] {
  if (value === null || value === undefined) {
    if (prefix !== '$') {
      const key = prefix.split('.').pop() ?? prefix;
      out.push({ path: prefix, schemaKey: schemaPrefix, key, value, stringValue: String(value) });
    }
    return out;
  }

  if (typeof value !== 'object') {
    const key = prefix.split('.').pop()?.replace(/\[\d+\]$/, '') || prefix;
    out.push({
      path: prefix,
      schemaKey: schemaPrefix,
      key,
      value,
      stringValue: String(value),
    });
    return out;
  }

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, 60);
    for (let i = 0; i < limit; i++) {
      flattenJson(value[i], `${prefix}[${i}]`, `${schemaPrefix}[*]`, out);
    }
    return out;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    flattenJson(obj[k], `${prefix}.${k}`, `${schemaPrefix}.${k}`, out);
  }
  return out;
}

export function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function stripSuffixTokens(tokens: string[]): string[] {
  if (tokens.length <= 1) return tokens;
  const trimmed = [...tokens];
  while (trimmed.length > 1 && UNIT_SUFFIXES.has(trimmed[trimmed.length - 1])) {
    trimmed.pop();
  }
  return trimmed;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

export function scoreKeySimilarity(expectedKey: string, actualKey: string): { score: number; reason: string } {
  if (!expectedKey || !actualKey) return { score: 0, reason: '' };
  if (expectedKey === actualKey) return { score: 1, reason: 'exact key match' };

  const expTokens = tokenizeKey(expectedKey);
  const actTokens = tokenizeKey(actualKey);
  const expJoined = expTokens.join('_');
  const actJoined = actTokens.join('_');

  if (expJoined === actJoined) {
    return { score: 0.98, reason: `casing drift (${expectedKey} vs ${actualKey})` };
  }

  const expStem = stripSuffixTokens(expTokens).join('_');
  const actStem = stripSuffixTokens(actTokens).join('_');

  if (expStem === actStem && expStem.length >= 2) {
    return { score: 0.9, reason: `unit/suffix & casing drift (${expectedKey} vs ${actualKey})` };
  }

  // Abbreviation / prefix token overlap (e.g. subStatus vs subscription_status)
  if (expTokens.length === actTokens.length && expTokens.length > 1) {
    let prefixMatchCount = 0;
    for (let i = 0; i < expTokens.length; i++) {
      if (actTokens[i].startsWith(expTokens[i]) || expTokens[i].startsWith(actTokens[i])) {
        prefixMatchCount++;
      }
    }
    if (prefixMatchCount === expTokens.length) {
      return { score: 0.86, reason: `abbreviated token drift (${expectedKey} vs ${actualKey})` };
    }
  }

  // Jaccard token overlap
  const expSet = new Set(expStem.split('_'));
  const actSet = new Set(actStem.split('_'));
  let shared = 0;
  for (const t of expSet) {
    if (actSet.has(t)) shared++;
  }
  const union = new Set([...expSet, ...actSet]).size;
  const tokenJaccard = union > 0 ? shared / union : 0;

  const maxLen = Math.max(expJoined.length, actJoined.length);
  const levScore = maxLen > 0 ? 1 - levenshtein(expJoined, actJoined) / maxLen : 0;
  const stemMaxLen = Math.max(expStem.length, actStem.length);
  const stemLevScore = stemMaxLen > 0 ? 1 - levenshtein(expStem, actStem) / stemMaxLen : 0;

  const combined = Math.max(levScore, stemLevScore * 0.95, tokenJaccard * 0.88);
  if (combined >= 0.6) {
    return { score: Number(combined.toFixed(2)), reason: `fuzzy match (${expectedKey} ~ ${actualKey})` };
  }
  return { score: 0, reason: '' };
}

function parseNumericVariants(text: string): Set<number> {
  const nums = new Set<number>();
  if (FALLBACK_TEXT_RE.test(text)) return nums;
  const cleaned = text.replace(/[$,\s%]/g, '');
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return nums;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return nums;
  nums.add(parsed);
  if (text.includes('$') || text.includes('.')) {
    nums.add(Math.round(parsed * 100));
  }
  return nums;
}

function matchFieldValue(field: FlattenedField, candidateStrings: Set<string>, candidateNumbers: Set<number>): 'exact' | 'formatted' | null {
  if (field.value === null || field.value === undefined || field.stringValue === '') return null;
  if (typeof field.value === 'number' && (field.value === 0 || field.value === 1) && /^(is_|has_|can_|admin)/i.test(field.key)) {
    return null;
  }
  const s = field.stringValue.trim();
  if (s.length >= 1 && candidateStrings.has(s)) return 'exact';
  if (typeof field.value === 'number' && candidateNumbers.has(field.value)) return 'formatted';
  return null;
}

export function resolveElementLineage(
  inspection: ElementInspection,
  records: NetworkRecord[],
  propertyMisses: PropertyMiss[]
): {
  lineageMatches: NetworkLineageMatch[];
  schemaDrifts: SchemaDriftFinding[];
  sqlQueries: SqlQueryTrace[];
} {
  const candidateStrings = new Set<string>();
  const candidateNumbers = new Set<number>();

  if (inspection.text) {
    candidateStrings.add(inspection.text);
    for (const num of parseNumericVariants(inspection.text)) candidateNumbers.add(num);
  }
  for (const attrVal of Object.values(inspection.attributes)) {
    if (attrVal) {
      candidateStrings.add(attrVal);
      for (const num of parseNumericVariants(attrVal)) candidateNumbers.add(num);
    }
  }
  if (inspection.primaryComponent) {
    for (const [k, v] of Object.entries(inspection.primaryComponent.props)) {
      if (v === null || v === undefined || v === 'undefined' || k.startsWith('data-')) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        const str = String(v).trim();
        if (str && !FALLBACK_TEXT_RE.test(str)) {
          candidateStrings.add(str);
          if (typeof v === 'number') candidateNumbers.add(v);
        }
      }
    }
  }

  const lineageMatches: NetworkLineageMatch[] = [];
  const seenMatches = new Set<string>();

  // Search newest network records first
  for (let r = records.length - 1; r >= 0; r--) {
    const rec = records[r];
    for (let f = 0; f < rec.fields.length; f++) {
      const field = rec.fields[f];
      const matchType = matchFieldValue(field, candidateStrings, candidateNumbers);
      if (!matchType) continue;
      const dedupKey = `${rec.id}:${field.path}`;
      if (seenMatches.has(dedupKey)) continue;
      seenMatches.add(dedupKey);
      lineageMatches.push({
        traceId: rec.id,
        method: rec.method,
        url: rec.url,
        normalizedEndpoint: rec.normalizedEndpoint,
        status: rec.status,
        durationMs: rec.durationMs,
        jsonPath: field.path,
        key: field.key,
        value: field.value,
        matchType,
        sqlQueries: rec.sqlQueries,
      });
      if (lineageMatches.length >= 6) break;
    }
    if (lineageMatches.length >= 6) break;
  }

  // Collect candidate missing / undefined keys for schema-drift analysis
  const missingKeys: Array<{ key: string; preferredTraceId?: string }> = [];
  const seenMissing = new Set<string>();

  for (const frame of inspection.hierarchy) {
    for (const nullProp of frame.nullishProps) {
      if (!seenMissing.has(nullProp)) {
        seenMissing.add(nullProp);
        missingKeys.push({ key: nullProp });
      }
    }
  }
  for (const nullHost of inspection.nullishHostProps) {
    if (!seenMissing.has(nullHost)) {
      seenMissing.add(nullHost);
      missingKeys.push({ key: nullHost });
    }
  }

  const looksLikeFallback = FALLBACK_TEXT_RE.test(inspection.text);
  // Include runtime Proxy property misses (especially critical when component reads `data.mrrCents` directly)
  if (looksLikeFallback || lineageMatches.length === 0 || missingKeys.length > 0) {
    for (let i = propertyMisses.length - 1; i >= 0; i--) {
      const miss = propertyMisses[i];
      if (!seenMissing.has(miss.missingKey)) {
        seenMissing.add(miss.missingKey);
        missingKeys.push({ key: miss.missingKey, preferredTraceId: miss.traceId });
      }
    }
  }

  const schemaDrifts: SchemaDriftFinding[] = [];
  const seenDrifts = new Set<string>();

  for (const { key: expectedKey, preferredTraceId } of missingKeys) {
    let best: SchemaDriftFinding | null = null;
    for (let r = records.length - 1; r >= 0; r--) {
      const rec = records[r];
      if (preferredTraceId && rec.id !== preferredTraceId) continue;
      for (let f = 0; f < rec.fields.length; f++) {
        const field = rec.fields[f];
        if (field.value === undefined || field.value === null) continue;
        const { score, reason } = scoreKeySimilarity(expectedKey, field.key);
        if (score >= 0.6 && (!best || score > best.confidence)) {
          best = {
            expectedKey,
            actualKey: field.key,
            jsonPath: field.path,
            actualValue: field.value,
            endpoint: rec.normalizedEndpoint,
            traceId: rec.id,
            confidence: score,
            reason,
            sqlQueries: rec.sqlQueries,
          };
        }
      }
      if (best) break;
    }
    if (best) {
      const dKey = `${best.expectedKey}->${best.actualKey}`;
      if (!seenDrifts.has(dKey)) {
        seenDrifts.add(dKey);
        schemaDrifts.push(best);
      }
    }
  }

  // Gather correlated SQL queries across matched lineage and detected drifts
  const sqlQueries: SqlQueryTrace[] = [];
  const seenSql = new Set<string>();
  const addQueries = (queries: SqlQueryTrace[]) => {
    for (const q of queries) {
      const sig = `${q.sql}|${JSON.stringify(q.params)}`;
      if (!seenSql.has(sig)) {
        seenSql.add(sig);
        sqlQueries.push(q);
      }
    }
  };
  for (const m of lineageMatches) addQueries(m.sqlQueries);
  for (const d of schemaDrifts) addQueries(d.sqlQueries);

  return { lineageMatches, schemaDrifts, sqlQueries };
}
