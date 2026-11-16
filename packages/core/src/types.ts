export interface SqlQueryTrace {
  sql: string;
  params: unknown[];
  rowCount: number;
  durationMs: number;
  source?: string;
}

export interface FlattenedField {
  path: string;
  key: string;
  schemaKey: string;
  value: unknown;
  stringValue: string;
}

export interface NetworkRecord {
  id: string;
  method: string;
  url: string;
  normalizedEndpoint: string;
  status: number;
  durationMs: number;
  timestamp: number;
  payloadBytes: number;
  isThirdParty: boolean;
  fields: FlattenedField[];
  sqlQueries: SqlQueryTrace[];
  rawJson: unknown;
  traceEndpointUrl?: string;
}

export interface PropertyMiss {
  traceId: string;
  endpoint: string;
  basePath: string;
  missingKey: string;
  targetKeys: string[];
  timestamp: number;
}

export interface ComponentFrame {
  name: string;
  fileName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  props: Record<string, unknown>;
  nullishProps: string[];
  stateValues: unknown[];
}

export interface ElementInspection {
  tagName: string;
  selector: string;
  text: string;
  attributes: Record<string, string>;
  framework: 'react' | 'dom';
  primaryComponent: ComponentFrame | null;
  hierarchy: ComponentFrame[];
  hostProps: Record<string, unknown>;
  nullishHostProps: string[];
}

export interface NetworkLineageMatch {
  traceId: string;
  method: string;
  url: string;
  normalizedEndpoint: string;
  status: number;
  durationMs: number;
  jsonPath: string;
  key: string;
  value: unknown;
  matchType: 'exact' | 'formatted' | 'prop';
  sqlQueries: SqlQueryTrace[];
}

export interface SchemaDriftFinding {
  expectedKey: string;
  actualKey: string;
  jsonPath: string;
  actualValue: unknown;
  endpoint: string;
  traceId: string;
  confidence: number;
  reason: string;
  sqlQueries: SqlQueryTrace[];
}

export interface RequestStormAlert {
  endpoint: string;
  count: number;
  windowMs: number;
  totalDurationMs: number;
}

export interface OverfetchField {
  key: string;
  samplePath: string;
  sampleValue: unknown;
  accessedInJs: boolean;
  renderedInDom: boolean;
  sensitive: boolean;
  sensitivityReason: string | null;
}

export interface EndpointAudit {
  endpoint: string;
  method: string;
  status: number;
  requestCount: number;
  avgDurationMs: number;
  payloadBytes: number;
  totalSchemaFields: number;
  renderedFields: number;
  unrenderedFields: number;
  overfetchRatio: number;
  sensitiveCount: number;
  nonNullSensitiveCount: number;
  nPlusOneSuspected: boolean;
  unrenderedList: OverfetchField[];
  sqlQueryCount: number;
}

export interface OverfetchReport {
  pageUrl: string;
  capturedAt: number;
  totalEndpoints: number;
  totalPayloadBytes: number;
  totalSchemaFields: number;
  renderedSchemaFields: number;
  unrenderedSchemaFields: number;
  overallOverfetchRatio: number;
  sensitiveFindingsCount: number;
  requestStorms: RequestStormAlert[];
  endpoints: EndpointAudit[];
}

export interface BlameCapsule {
  capsuleId: string;
  capturedAt: number;
  pageUrl: string;
  element: ElementInspection;
  lineageMatches: NetworkLineageMatch[];
  schemaDrifts: SchemaDriftFinding[];
  sqlQueries: SqlQueryTrace[];
  endpointOverfetch: EndpointAudit | null;
  requestStorms: RequestStormAlert[];
}

export interface DomBlameConfig {
  mcpBridgeUrl?: string | null;
  traceEndpointBase?: string;
  showDock?: boolean;
  enableKeyboard?: boolean;
  maxNetworkRecords?: number;
}

export interface DomBlameApi {
  destroy: () => void;
  setInspectMode: (active: boolean) => void;
  isInspectMode: () => boolean;
  toggleAuditDrawer: (open?: boolean) => void;
  openSnapAuditCard: () => void;
  inspectElement: (el: Element) => Promise<BlameCapsule>;
  getLatestCapsule: () => BlameCapsule | null;
  getOverfetchReport: () => OverfetchReport;
  getNetworkRecords: () => NetworkRecord[];
}
