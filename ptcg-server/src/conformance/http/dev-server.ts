import * as cluster from 'cluster';
import * as os from 'os';
import * as express from 'express';
import { createConformanceApp } from './app';

/**
 * DEV-ONLY launcher: mounts the real conformance app behind a request-logging
 * middleware so each hit is visible on stdout. Non-invasive — `app.ts`/`server.ts` are untouched.
 * Run: `TS_NODE_TRANSPILE_ONLY=1 npx ts-node src/conformance/http/dev-server.ts`
 *
 * The endpoints are stateless (each request replays from its own initialState), so the server
 * scales horizontally: CONFORMANCE_WORKERS=N forks N cluster workers sharing the port (node
 * round-robins connections). Default 1 (no cluster). Each worker loads the full card library.
 */
const workers = Number(process.env.CONFORMANCE_WORKERS) || 1;
// ts-node's CJS interop: the cluster module IS the namespace object at runtime (old @types).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clusterApi = cluster as any;
if (workers > 1 && (clusterApi.isPrimary ?? clusterApi.isMaster)) {
  const n = Math.min(workers, os.cpus().length);
  // eslint-disable-next-line no-console
  console.log(`[conformance] DEV cluster primary: forking ${n} worker(s)`);
  for (let i = 0; i < n; i++) {
    clusterApi.fork();
  }
  clusterApi.on('exit', (worker: { process: { pid: number } }, code: number) => {
    // eslint-disable-next-line no-console
    console.log(`[conformance] worker ${worker.process.pid} exited (${code}) — forking replacement`);
    clusterApi.fork();
  });
} else {
  startServer();
}

function startServer(): void {
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
  console.log(`[conformance] DEV server listening on http://localhost:${port} — request logging ON`
    + (workers > 1 ? ` (worker ${process.pid})` : ''));
  // eslint-disable-next-line no-console
  console.log('[conformance] routes: POST /v1/step  GET /v1/capabilities  POST /v1/normalize');
});
}
