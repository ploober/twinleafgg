import * as express from 'express';
import { json } from 'body-parser';
import { handleStep, handleCapabilities, BadRequestError } from './handlers';

/**
 * A standalone Express app for the conformance API (design §5, M6): a pure function of the request
 * body, with no auth / DB / Core dependency (unlike the main backend controllers). It can run on its
 * own (see server.ts) or be mounted into the main `src/backend/app.ts` later.
 *
 * Routes:
 *  - POST /v1/step          { schemaVersion?, initialState, actions[] } → StepResponse
 *  - GET  /v1/capabilities  → CapabilitiesResponse
 */
export function createConformanceApp(): express.Application {
  const app = express();
  app.use(json({ limit: '8mb' })); // states/logs can be large; generous but bounded

  app.post('/v1/step', (req: express.Request, res: express.Response) => {
    try {
      res.json(handleStep(req.body));
    } catch (err) {
      if (err instanceof BadRequestError) {
        res.status(400).json({ error: { reasonCode: 'malformedRequest', message: err.message } });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: { reasonCode: 'internalError', message } });
      }
    }
  });

  app.get('/v1/capabilities', (_req: express.Request, res: express.Response) => {
    res.json(handleCapabilities());
  });

  return app;
}
