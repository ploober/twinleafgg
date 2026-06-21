import { step } from '../driver';
import { StepResponse, NeutralState, NeutralAction, SCHEMA_VERSION } from '../neutral-types';
import { buildCapabilities, CapabilitiesResponse } from '../capabilities';

/**
 * Framework-agnostic request handlers for the conformance HTTP layer (design §5, M6). Kept pure so
 * they can be driven in-process by tests (and the cross-engine harness) without a socket — the thin
 * Express binding in app.ts just adapts req/res to these.
 *
 * Separation of concerns:
 *  - a structurally **malformed request** throws `BadRequestError` → the binding answers 400;
 *  - a **valid request with an illegal action** is NOT an error — `step()` returns a normal envelope
 *    with `status:'invalidAction'` + `rejection` (HTTP 200);
 *  - an unexpected throw from `step()` (adapter/contract bug) propagates → the binding answers 500.
 */

/** A structurally invalid request body (missing or wrong-typed fields). Maps to HTTP 400 `malformedRequest`. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** A well-formed request whose `schemaVersion` this engine does not speak. Maps to HTTP 400 `unsupportedSchemaVersion`. */
export class UnsupportedSchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSchemaVersionError';
  }
}

interface StepRequestBody {
  schemaVersion?: string;
  initialState: NeutralState;
  actions: NeutralAction[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Validate the `POST /v1/step` body shape, then replay it. Throws BadRequestError on bad shape. */
export function handleStep(body: unknown): StepResponse {
  if (!isObject(body)) {
    throw new BadRequestError('request body must be a JSON object');
  }
  if (typeof body.schemaVersion !== 'string') {
    throw new BadRequestError('`schemaVersion` is required and must be a string');
  }
  if (body.schemaVersion !== SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(
      `unsupported schemaVersion "${body.schemaVersion}" (this engine speaks "${SCHEMA_VERSION}")`
    );
  }
  if (!isObject(body.initialState)) {
    throw new BadRequestError('`initialState` is required and must be an object');
  }
  if (!Array.isArray(body.actions)) {
    throw new BadRequestError('`actions` is required and must be an array');
  }
  const { initialState, actions } = body as unknown as StepRequestBody;
  return step(initialState, actions);
}

/** The `GET /v1/capabilities` payload. */
export function handleCapabilities(): CapabilitiesResponse {
  return buildCapabilities();
}
