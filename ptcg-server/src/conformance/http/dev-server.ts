import * as express from 'express';
import { createConformanceApp } from './app';

/**
 * DEV-ONLY launcher: mounts the real conformance app behind a request-logging
 * middleware so each hit is visible on stdout. Non-invasive — `app.ts`/`server.ts` are untouched.
 * Run: `TS_NODE_TRANSPILE_ONLY=1 npx ts-node src/conformance/http/dev-server.ts`
 */
const app = express();

app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const start = Date.now();
  let summary = '';
  res.json = (body: unknown): express.Response => {
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      summary = typeof b.status === 'string'
        ? `status=${b.status}` +
          (typeof b.applied === 'number' ? ` applied=${b.applied}` : '') +
          (b.reasonCode ? ` reasonCode=${String(b.reasonCode)}` : '') +
          (b.pending && typeof b.pending === 'object'
            ? ` pending.actor=${String((b.pending as Record<string, unknown>).actor)}`
            : '')
        : typeof b.error === 'string'
          ? `error=${b.error}` + (b.message ? `: ${String(b.message)}` : '')
          : '';
    }
    // Always pretty-print (2-space indent) regardless of the endpoint.
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(body, null, 2));
  };
  res.on('finish', () => {
    // eslint-disable-next-line no-console
    console.log(`[conformance] ${req.method} ${req.url} -> ${res.statusCode} ${summary} (${Date.now() - start}ms)`);
  });
  next();
});

app.use(createConformanceApp());

const port = Number(process.env.CONFORMANCE_PORT) || 8090;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[conformance] DEV server listening on http://localhost:${port} — request logging ON`);
  // eslint-disable-next-line no-console
  console.log('[conformance] routes: POST /v1/step  GET /v1/capabilities  POST /v1/normalize');
});
