import * as express from 'express';
import { json } from 'body-parser';
import { handleStep, handleCapabilities, handleCards, BadRequestError, UnsupportedSchemaVersionError } from './handlers';
import { UnknownSetError } from '../cards';
import { UnsupportedFormatError } from '../formats';

/**
 * A standalone Express app for the conformance API (design §5, M6): a pure function of the request
 * body, with no auth / DB / Core dependency (unlike the main backend controllers). It can run on its
 * own (see server.ts) or be mounted into the main `src/backend/app.ts` later.
 *
 * Routes (OpenAPI `conformance-api.yaml`):
 *  - POST /v1/step          { schemaVersion, initialState, actions[] } → StepResponse
 *  - GET  /v1/capabilities  → Capabilities
 *  - GET  /v1/cards/:set    → CardList (printed data of every implemented card in the set)
 *  - POST /v1/normalize     → 501 (optional; the runner normalizes in-process)
 *
 * The error body is the contract `Error` shape: `{ error: <string code>, message }`.
 */
export function createConformanceApp(): express.Application {
  const app = express();
  app.use(json({ limit: '8mb' })); // states/logs can be large; generous but bounded

  app.post('/v1/step', (req: express.Request, res: express.Response) => {
    try {
      res.json(handleStep(req.body));
    } catch (err) {
      if (err instanceof BadRequestError || err instanceof UnsupportedFormatError) {
        res.status(400).json({ error: 'malformedRequest', message: err.message });
      } else if (err instanceof UnsupportedSchemaVersionError) {
        res.status(400).json({ error: 'unsupportedSchemaVersion', message: err.message });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'engineFault', message });
      }
    }
  });

  app.get('/v1/capabilities', (_req: express.Request, res: express.Response) => {
    res.json(handleCapabilities());
  });

  app.get('/v1/cards/:setCode', (req: express.Request, res: express.Response) => {
    try {
      res.json(handleCards(req.params.setCode, req.query.format));
    } catch (err) {
      if (err instanceof UnsupportedFormatError) {
        res.status(400).json({ error: 'unsupportedFormat', message: err.message });
      } else if (err instanceof UnknownSetError) {
        res.status(404).json({ error: 'unknownSet', message: err.message });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'engineFault', message });
      }
    }
  });

  // Optional endpoint: this adapter does not normalize; the contract sanctions a 501 (the runner then
  // normalizes in-process).
  app.post('/v1/normalize', (_req: express.Request, res: express.Response) => {
    res.status(501).json({ error: 'notImplemented', message: 'normalize is not implemented; the runner normalizes in-process' });
  });

  return app;
}
