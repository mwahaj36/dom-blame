import { initDomBlame } from './index';
import type { DomBlameConfig } from './types';

export * from './index';

if (typeof window !== 'undefined') {
  const globalCfg = (window as unknown as { __DOM_BLAME_CONFIG__?: DomBlameConfig }).__DOM_BLAME_CONFIG__;
  const scriptEl = typeof document !== 'undefined' ? document.currentScript : null;
  const bridgeAttr = scriptEl?.getAttribute('data-mcp-bridge');
  const config: DomBlameConfig = {
    ...globalCfg,
    ...(bridgeAttr !== null && bridgeAttr !== undefined
      ? { mcpBridgeUrl: bridgeAttr === 'off' ? null : bridgeAttr }
      : {}),
  };
  initDomBlame(config);
}
