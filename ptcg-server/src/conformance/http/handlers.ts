import { step } from '../driver';
import { resolveFormat, UnsupportedFormatError } from '../formats';
import { StepResponse, NeutralState, NeutralAction, NeutralCardList, SCHEMA_VERSION } from '../neutral-types';
import { buildCapabilities, CapabilitiesResponse } from '../capabilities';
import { buildCardsForSet } from '../cards';

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
  resolveFormat(initialState.format); // CF-85: an unadvertised format is a malformed request (400)
  if (initialState.phase === 'setup') {
    assertPreDeal(initialState);
  }
  return step(initialState, actions);
}

/**
 * CF-84: the ONLY `phase: setup` initialState is the pre-deal state — `turn: 0`, `firstPlayer: null`,
 * and for each player an empty board, hand, prizes, discard, Lost Zone and staging zone, with `deck` the
 * ordered deck list. Mid-setup positions are reached by replaying actions from it, never imported.
 */
function assertPreDeal(s: StepRequestBody['initialState']): void {
  const bad = (why: string) => { throw new BadRequestError(`phase "setup" initialState must be the pre-deal state (CF-84): ${why}`); };
  if (s.turn !== 0) { bad('turn must be 0'); }
  if (s.firstPlayer !== null) { bad('firstPlayer must be null'); }
  if (s.stadium) { bad('stadium must be null'); }
  for (const id of ['A', 'B'] as const) {
    const p = s.players?.[id];
    if (!p) { bad(`players.${id} is required`); }
    if (p.active) { bad(`players.${id}.active must be null`); }
    for (const zone of ['bench', 'hand', 'prizes', 'discard', 'lostZone', 'resolving'] as const) {
      if ((p[zone] ?? []).length > 0) { bad(`players.${id}.${zone} must be empty`); }
    }
    if (!Array.isArray(p.deck) || p.deck.length === 0) { bad(`players.${id}.deck must list the deck`); }
  }
}

/** The `GET /v1/capabilities` payload. */
export function handleCapabilities(): CapabilitiesResponse {
  return buildCapabilities();
}

/** The `GET /v1/cards/{setCode}` payload. Throws `UnknownSetError` (→ 404) for an unimplemented set. */
export function handleCards(setCode: string, format?: unknown): NeutralCardList {
  if (format === undefined || format === null) {
    // TA-649: `format` is a required query parameter here (CF-85); the absent-means-standard bridge is for boards only
    throw new UnsupportedFormatError('format is required on GET /v1/cards/{setCode} (CF-85)');
  }
  return buildCardsForSet(setCode, resolveFormat(format));
}
