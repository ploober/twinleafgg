import * as http from 'http';
import { createConformanceApp } from './app';

/**
 * Start the standalone conformance HTTP server (design §5, M6). Independent of the main backend, so
 * the cross-engine harness can talk to it over a socket without bringing up auth/DB/Core. The
 * harness can equally call the driver / handlers in-process; this is the cross-process option.
 */
export function startServer(port: number): http.Server {
  const app = createConformanceApp();
  return app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[conformance] listening on http://localhost:${port} (POST /v1/step, GET /v1/capabilities)`);
  });
}

// Runnable entry: `node output/conformance/http/server.js` (after `npm run compile`), or via ts-node.
// Port from CONFORMANCE_PORT, default 8090.
if (require.main === module) {
  const port = Number(process.env.CONFORMANCE_PORT) || 8090;
  startServer(port);
}
