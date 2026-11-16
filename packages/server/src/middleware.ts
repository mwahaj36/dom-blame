import type { IncomingMessage, ServerResponse } from 'node:http';
import { getCurrentTrace, getTraceById, runWithTrace, setMaxStoredTraces } from './context';
import type { DomBlameServerOptions } from './types';

type NextFunction = (err?: unknown) => void;

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0];
  return undefined;
}

export function domBlameMiddleware(options: DomBlameServerOptions = {}) {
  const enabled = options.enabled ?? process.env.NODE_ENV !== 'production';
  const prefix = (options.traceRoutePrefix ?? '/__dom_blame/trace').replace(/\/+$/, '');
  const maxHeaderBytes = options.maxHeaderBytes ?? 4096;
  if (options.maxStoredTraces) setMaxStoredTraces(options.maxStoredTraces);

  return function domBlameHandler(req: IncomingMessage, res: ServerResponse, next: NextFunction): void {
    if (!enabled) {
      next();
      return;
    }

    const reqUrl = req.url ?? '/';
    const pathOnly = reqUrl.split('?')[0];

    // Built-in dev trace lookup endpoint: GET /__dom_blame/trace/:id
    if (req.method === 'GET' && pathOnly.startsWith(`${prefix}/`)) {
      const traceId = decodeURIComponent(pathOnly.slice(prefix.length + 1));
      const trace = getTraceById(traceId);
      res.statusCode = trace ? 200 : 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(trace ?? { error: 'Trace not found', traceId, queries: [] }));
      return;
    }

    const traceId = readHeader(req, 'x-dom-blame-id');
    if (!traceId) {
      next();
      return;
    }

    runWithTrace(traceId, { method: req.method ?? 'GET', path: pathOnly }, () => {
      let headersInjected = false;
      const injectTraceHeaders = () => {
        if (headersInjected || res.headersSent) return;
        headersInjected = true;
        const store = getCurrentTrace();
        if (!store) return;
        res.setHeader('x-dom-blame-trace-id', store.traceId);
        res.setHeader('x-dom-blame-trace-url', `${prefix}/${encodeURIComponent(store.traceId)}`);
        if (store.queries.length > 0) {
          const serialized = JSON.stringify(store.queries);
          if (Buffer.byteLength(serialized, 'utf8') <= maxHeaderBytes) {
            res.setHeader('x-dom-blame-sql', serialized);
          }
        }
      };

      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = ((statusCode: number, ...args: unknown[]) => {
        injectTraceHeaders();
        return (origWriteHead as (...a: unknown[]) => ServerResponse)(statusCode, ...args);
      }) as typeof res.writeHead;

      const origEnd = res.end.bind(res);
      res.end = ((...args: unknown[]) => {
        injectTraceHeaders();
        return (origEnd as (...a: unknown[]) => ServerResponse)(...args);
      }) as typeof res.end;

      next();
    });
  };
}

export function withDomBlame<TReq extends Request, TArgs extends unknown[]>(
  handler: (req: TReq, ...args: TArgs) => Promise<Response> | Response,
  options: DomBlameServerOptions = {}
) {
  const enabled = options.enabled ?? process.env.NODE_ENV !== 'production';
  const maxHeaderBytes = options.maxHeaderBytes ?? 4096;
  const prefix = (options.traceRoutePrefix ?? '/__dom_blame/trace').replace(/\/+$/, '');

  return async function wrappedHandler(req: TReq, ...args: TArgs): Promise<Response> {
    if (!enabled) return handler(req, ...args);

    const traceId = req.headers.get('x-dom-blame-id');
    if (!traceId) return handler(req, ...args);

    const urlPath = new URL(req.url, 'http://localhost').pathname;
    return runWithTrace(traceId, { method: req.method, path: urlPath }, async () => {
      const response = await handler(req, ...args);
      const store = getCurrentTrace();
      if (!store) return response;

      const headers = new Headers(response.headers);
      headers.set('x-dom-blame-trace-id', store.traceId);
      headers.set('x-dom-blame-trace-url', `${prefix}/${encodeURIComponent(store.traceId)}`);
      if (store.queries.length > 0) {
        const serialized = JSON.stringify(store.queries);
        if (serialized.length <= maxHeaderBytes) {
          headers.set('x-dom-blame-sql', serialized);
        }
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  };
}
