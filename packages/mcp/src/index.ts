import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BlameBridgeStore, startBridgeServer } from './bridge';
import { createDomBlameMcpServer } from './server';

export { BlameBridgeStore, startBridgeServer } from './bridge';
export { createDomBlameMcpServer } from './server';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const store = new BlameBridgeStore();
  const bridge = await startBridgeServer(store);

  if (bridge.isClientFallback) {
    console.error(`[dom-blame-mcp] Connected to existing HTTP bridge at ${bridge.url}`);
  } else {
    console.error(`[dom-blame-mcp] HTTP bridge listening on ${bridge.url}`);
  }

  if (args.has('--bridge-only')) {
    console.error('[dom-blame-mcp] Running in --bridge-only mode');
    return;
  }

  const mcpServer = createDomBlameMcpServer(bridge);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[dom-blame-mcp] MCP stdio server ready');

  const shutdown = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirectRun =
  typeof process !== 'undefined' &&
  typeof process.argv[1] === 'string' &&
  (pathToFileURL(process.argv[1]).href === import.meta.url || process.argv[1].includes('dom-blame-mcp'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('[dom-blame-mcp] Fatal error:', err);
    process.exit(1);
  });
}
