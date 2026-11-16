import http from 'node:http';
import type { BlameCapsule, OverfetchReport } from 'dom-blame';

export interface BridgeState {
  latestCapsule: BlameCapsule | null;
  capsules: BlameCapsule[];
  latestOverfetch: OverfetchReport | null;
  overfetchByUrl: Record<string, OverfetchReport>;
}

const MAX_CAPSULES = 50;

export class BlameBridgeStore {
  private capsules: BlameCapsule[] = [];
  private latestOverfetch: OverfetchReport | null = null;
  private overfetchByUrl = new Map<string, OverfetchReport>();

  pushCapsule(capsule: BlameCapsule): void {
    this.capsules.unshift(capsule);
    if (this.capsules.length > MAX_CAPSULES) this.capsules.pop();
  }

  pushOverfetch(report: OverfetchReport): void {
    this.latestOverfetch = report;
    if (report.pageUrl) {
      this.overfetchByUrl.set(report.pageUrl, report);
    }
  }

  snapshot(): BridgeState {
    return {
      latestCapsule: this.capsules[0] ?? null,
      capsules: [...this.capsules],
      latestOverfetch: this.latestOverfetch,
      overfetchByUrl: Object.fromEntries(this.overfetchByUrl.entries()),
    };
  }
}

export interface BridgeServerHandle {
  port: number;
  url: string;
  isClientFallback: boolean;
  getState: () => Promise<BridgeState>;
  close: () => Promise<void>;
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dom-blame-internal');
}

export async function startBridgeServer(
  store: BlameBridgeStore,
  port = Number(process.env.DOM_BLAME_BRIDGE_PORT || 4119)
): Promise<BridgeServerHandle> {
  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const path = (req.url ?? '/').split('?')[0];

    if (req.method === 'GET' && path === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET' && path === '/state') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(store.snapshot()));
      return;
    }

    if (req.method === 'POST' && path === '/capsule') {
      try {
        const body = (await readJsonBody(req)) as BlameCapsule;
        if (!body || typeof body !== 'object' || !body.capsuleId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid BlameCapsule payload' }));
          return;
        }
        store.pushCapsule(body);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, capsuleId: body.capsuleId }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid JSON' }));
      }
      return;
    }

    if (req.method === 'POST' && path === '/overfetch') {
      try {
        const body = (await readJsonBody(req)) as OverfetchReport;
        if (!body || typeof body !== 'object' || !Array.isArray(body.endpoints)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid OverfetchReport payload' }));
          return;
        }
        store.pushOverfetch(body);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, endpoints: body.totalEndpoints }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid JSON' }));
      }
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && port !== 0) {
        // Another dom-blame bridge is already running on this port; query it over HTTP
        const remoteUrl = `http://127.0.0.1:${port}`;
        resolve({
          port,
          url: remoteUrl,
          isClientFallback: true,
          async getState() {
            const resp = await fetch(`${remoteUrl}/state`);
            if (!resp.ok) throw new Error(`Bridge returned ${resp.status}`);
            return (await resp.json()) as BridgeState;
          },
          async close() {
            // No local server owned
          },
        });
        return;
      }
      reject(err);
    });

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://127.0.0.1:${boundPort}`;
      resolve({
        port: boundPort,
        url,
        isClientFallback: false,
        async getState() {
          return store.snapshot();
        },
        async close() {
          await new Promise<void>((resClose) => server.close(() => resClose()));
        },
      });
    });
  });
}
