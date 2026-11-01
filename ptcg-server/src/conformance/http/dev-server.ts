import { conformanceSnapshotBackend } from '../conformance-store';
import { replayCheckpointMode } from '../replay-checkpoints';
import * as cluster from 'cluster';
import * as os from 'os';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { createConformanceApp } from './app';
import { buildCapabilities } from '../capabilities';
import { buildCardsForSet } from '../cards';
import { ServedFormat } from '../formats';
import { ClusterReadiness } from './cluster-readiness';

/**
 * DEV-ONLY launcher: mounts the real conformance app behind a request-logging
 * middleware so each hit is visible on stdout. Non-invasive — `app.ts`/`server.ts` are untouched.
 * Run: `TS_NODE_TRANSPILE_ONLY=1 npx ts-node src/conformance/http/dev-server.ts`
 *
 * The endpoints are stateless (each request replays from its own initialState), so the server
 * scales horizontally: CONFORMANCE_WORKERS=N forks N cluster workers sharing the port (node
 * round-robins connections). Default 1 (no cluster). Each worker loads the full card library.
 * CONFORMANCE_QUIET=1 skips request logging and sends compact JSON for bulk fuzzing.
 * Workers warm the catalog and all served formats before the initial cluster can listen.
 * CONFORMANCE_READY_FILE, when set, names an atomic snapshot of the current ready generation.
 * Startup and worker-failure messages remain visible.
 */
conformanceSnapshotBackend(); // Reject invalid backend configuration before forking/listening.
replayCheckpointMode();
const quiet = process.env.CONFORMANCE_QUIET === '1';
const workers = Number(process.env.CONFORMANCE_WORKERS) || 1;
let initializedAtMs: number;
function publishReadiness(snapshot: ReturnType<ClusterReadiness['snapshot']>): void {
  const readyFile = process.env.CONFORMANCE_READY_FILE;
  if (readyFile === undefined) { return; }
  fs.mkdirSync(path.dirname(readyFile), { recursive: true });
  const temporary = `${readyFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ primaryPid: process.pid, ...snapshot }));
  fs.renameSync(temporary, readyFile);
}
// ts-node's CJS interop: the cluster module IS the namespace object at runtime (old @types).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clusterApi = cluster as any;
if (workers > 1 && (clusterApi.isPrimary ?? clusterApi.isMaster)) {
  const n = Math.min(Math.floor(workers), os.cpus().length);
  const readiness = new ClusterReadiness(n);
  const publish = (): void => publishReadiness(readiness.snapshot());
  const fork = (): void => {
    const worker = clusterApi.fork();
    readiness.add(worker.id, worker.process.pid);
    publish();
    worker.on('message', (message: { type?: string; pid?: number } | null) => {
      if (message === null || typeof message !== 'object' || message.pid !== worker.process.pid) { return; }
      if (message.type === 'conformance:initialized') {
        for (const id of readiness.initialized(worker.id, worker.process.pid)) {
          const target = clusterApi.workers[id];
          if (target?.isConnected()) {
            // A child can exit between its warm-up message and this broadcast. Its exit
            // handler withdraws readiness and replaces it; a closed IPC pipe is not fatal.
            target.send({ type: 'conformance:listen' }, () => { /* exit handler owns recovery */ });
          }
        }
      } else if (message.type === 'conformance:listening') {
        if (readiness.listening(worker.id, worker.process.pid)) {
          // eslint-disable-next-line no-console
          console.log(`[conformance] ALL ${n} worker(s) initialized and listening`);
        }
      }
      publish();
    });
  };
  // eslint-disable-next-line no-console
  console.log(`[conformance] DEV cluster primary: forking ${n} worker(s)`);
  for (let i = 0; i < n; i++) {
    fork();
  }
  clusterApi.on('exit', (worker: { id: number; process: { pid: number } }, code: number) => {
    readiness.remove(worker.id);
    publish();
    // eslint-disable-next-line no-console
    console.log(`[conformance] worker ${worker.process.pid} exited (${code}) — forking replacement`);
    fork();
  });
} else {
  // Initialize before accepting connections: a persistent client pool must not be pinned to
  // whichever workers happen to finish loading their card/format data first.
  if (workers > 1) {
    let started = false;
    process.on('message', (message: { type?: string } | null) => {
      if (message !== null && typeof message === 'object' && message.type === 'conformance:listen' && !started) {
        started = true;
        startServer();
      }
    });
  }
  const capabilities = buildCapabilities();
  for (const format of capabilities.formats) {
    for (const setCode of Object.keys(capabilities.sets)) {
      buildCardsForSet(setCode, format as ServedFormat);
    }
  }
  initializedAtMs = Date.now();
  if (workers > 1) {
    process.send?.({ type: 'conformance:initialized', pid: process.pid });
  } else {
    startServer();
  }
}

function startServer(): void {
  const app = express();

  // The normal Express JSON writer is compact; avoid installing the debug wrapper in quiet mode.
  if (!quiet) {
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
  }

  app.use(createConformanceApp());

  const port = Number(process.env.CONFORMANCE_PORT) || 8090;
  app.listen(port, () => {
    if (workers > 1) { process.send?.({ type: 'conformance:listening', pid: process.pid }); }
    else {
      publishReadiness({ ready: true, expectedWorkers: 1, workers: [{ id: 0, pid: process.pid, initializedAtMs, listeningAtMs: Date.now() }] });
    }
  // eslint-disable-next-line no-console
    console.log(`[conformance] DEV server listening on http://localhost:${port} — request logging ${quiet ? 'OFF (compact JSON)' : 'ON'}`
    + (workers > 1 ? ` (worker ${process.pid})` : ''));
    // eslint-disable-next-line no-console
    console.log('[conformance] routes: POST /v1/step  GET /v1/capabilities  POST /v1/normalize');
  });
}
