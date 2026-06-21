import * as http from 'http';
import { createConformanceApp } from '../http/app';
import { startServer } from '../http/server';
import { handleCapabilities } from '../http/handlers';
import { step } from '../driver';
import { SCHEMA_VERSION, NeutralAction } from '../neutral-types';
import { materializeNeutral, stepToNeutralActions } from './support/scenario-runner';

/**
 * End-to-end HTTP smoke test for the conformance API (design §5 / impl §5). The M6 specs cover the
 * pure handlers in-process and a couple of `POST /v1/step` socket round-trips; this complements them
 * by exercising the service the way the cross-engine harness will — over a real socket — and pins the
 * gaps: `GET /v1/capabilities` over the wire, the illegal-action contract (a 200 envelope, NOT a 4xx),
 * a non-trivial drive matching in-process `step()` byte-for-byte through JSON, the `startServer` entry
 * point, content types, and unknown-route handling.
 */

const L = 'Lightning Energy SVE';
const W = 'Water Energy SVE';

// A real drive (Raichu KOs nothing, deals 40, auto-ends the turn → B's menu): a non-trivial envelope
// (damage, events, a pending menu, two full player projections) to round-trip over the wire.
const DRIVE_STATE = materializeNeutral({
  turn: 2,
  players: {
    A: { active: { card: 'Raichu SIT', energy: [L] }, deck: [W, W] },
    B: { active: { card: 'Ralts SIT' }, deck: [W, W] },
  },
});
const DRIVE_ACTIONS = stepToNeutralActions([{ kind: 'attack', name: 'Ambushing Spark' }]);

// Same board WITHOUT energy → the attack is illegal (notEnoughEnergy).
const ILLEGAL_STATE = materializeNeutral({
  turn: 2,
  players: {
    A: { active: { card: 'Raichu SIT' }, deck: [W] },
    B: { active: { card: 'Ralts SIT' }, deck: [W] },
  },
});
const ILLEGAL_ACTIONS: NeutralAction[] = [{ actor: 'A', type: 'declareAttack', source: 'A-act-s0', name: 'Ambushing Spark' }];

/** The wire-observable form of a value (what actually crosses the socket: undefined keys dropped). */
const overWire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe('Conformance — HTTP smoke (end-to-end over a real socket)', () => {
  let server: http.Server;

  beforeAll(done => { server = createConformanceApp().listen(0, done); });
  afterAll(done => { server.close(() => done()); });

  it('GET /v1/capabilities serves the capabilities payload as JSON', async () => {
    const res = await request(server, 'GET', '/v1/capabilities');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json.schemaVersion).toBe(SCHEMA_VERSION);
    expect(res.json.engine).toBe('twinleaf');
    expect(typeof res.json.version).toBe('string');
    expect(Array.isArray(res.json.implementedCards)).toBe(true);
    expect(res.json.implementedCards.length).toBeGreaterThan(0);
    expect(Array.isArray(res.json.supportedSets)).toBe(true);
    // wire payload matches the in-process handler (no field lost in routing/serialization)
    expect(res.json).toEqual(overWire(handleCapabilities()));
  });

  it('POST /v1/step round-trips a non-trivial drive identically to in-process step()', async () => {
    const res = await request(server, 'POST', '/v1/step',
      { schemaVersion: SCHEMA_VERSION, initialState: DRIVE_STATE, actions: DRIVE_ACTIONS });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // the whole envelope (status/applied/events/pending/state) survives the wire unchanged
    expect(res.json).toEqual(overWire(step(DRIVE_STATE, DRIVE_ACTIONS)));
    // sanity on the projected result
    expect(res.json.status).toBe('awaitingAction');
    expect(res.json.state.players.B.active.damage).toBe(40);
    expect(res.json.state.activePlayer).toBe('B');
  });

  it('POST /v1/step with a valid board but an ILLEGAL action is 200 + invalidAction (not a 4xx)', async () => {
    const res = await request(server, 'POST', '/v1/step',
      { schemaVersion: SCHEMA_VERSION, initialState: ILLEGAL_STATE, actions: ILLEGAL_ACTIONS });
    expect(res.status).toBe(200); // an illegal action is a normal envelope, not an HTTP error
    expect(res.json.status).toBe('invalidAction');
    expect(res.json.reasonCode).toBe('INSUFFICIENT_ENERGY');
    expect(res.json.index).toBe(0);
    expect(res.json.nativeReason.source).toBe('twinleaf:GameMessage');
    expect(res.json).toEqual(overWire(step(ILLEGAL_STATE, ILLEGAL_ACTIONS)));
  });

  it('an unknown route is 404', async () => {
    const res = await request(server, 'GET', '/v1/nope');
    expect(res.status).toBe(404);
  });

  it('startServer boots a listening service that answers requests', async () => {
    const srv = startServer(0);
    try {
      const res = await request(srv, 'GET', '/v1/capabilities');
      expect(res.status).toBe(200);
      expect(res.json.schemaVersion).toBe(SCHEMA_VERSION);
    } finally {
      await new Promise<void>(resolve => srv.close(() => resolve()));
    }
  });
});

// ── helper ──

function request(
  server: http.Server, method: string, urlPath: string, body?: unknown
): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path: urlPath,
        headers: data !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
      },
      res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          let json: any;
          try { json = raw ? JSON.parse(raw) : undefined; } catch { json = undefined; } // e.g. express's HTML 404
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
        });
      },
    );
    req.on('error', reject);
    if (data !== undefined) { req.write(data); }
    req.end();
  });
}
