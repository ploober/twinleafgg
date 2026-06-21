import * as http from 'http';
import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, CardRef, SCHEMA_VERSION } from '../neutral-types';
import { toPrinting } from '../printing';
import { getCardByName } from '../../sets/tests/test-helpers';
import { createConformanceApp } from '../http/app';

/**
 * OpenAPI compliance (Step 1): the real wire identity is a set-number `printing` (`sit-067`, `sve-002`),
 * and the request carries a required `schemaVersion`. This pins the round-trip through that identity,
 * the dual-accept (fullName still resolves), and the contract's request/error/endpoint shapes.
 */

const RALTS = toPrinting(getCardByName('Ralts SIT'));            // e.g. 'sit-067'
const WATER = toPrinting(getCardByName('Water Energy SVE'));     // e.g. 'sve-002'

function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function pip(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function side(active: PokemonInPlay, over: Partial<PlayerState> = {}): PlayerState {
  return {
    active, bench: [], hand: [], deck: [{ iid: `${active.stack[0].iid}-d`, printing: WATER }],
    discard: [], lostZone: [], prizes: [{ iid: `${active.stack[0].iid}-p`, printing: WATER, faceUp: false }], flags: flags(), ...over,
  };
}
function board(printing: string): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: side(pip('A-act', printing, [{ iid: 'A-e', printing: WATER }]), { hand: [{ iid: 'A-h', printing: WATER }], deck: [{ iid: 'A-d', printing: WATER }] }),
      B: side(pip('B-act', printing)),
    },
    activeEffects: [],
  };
}

describe('Conformance — OpenAPI Step-1 compliance', () => {

  it('set-number printings round-trip through import -> project unchanged', () => {
    const res = step(board(RALTS), []);
    expect(res.schemaVersion).toBe(SCHEMA_VERSION);
    expect(res.state.activeEffects).toEqual([]);
    // import resolved the set-number printing; projection re-emits the same form (a true identity)
    expect(res.state.players.A.active!.stack[0].printing).toBe(RALTS);
    expect(res.state.players.A.active!.energy[0].printing).toBe(WATER);
    expect(res.state.players.A.hand[0].printing).toBe(WATER);
    expect(/^[a-z0-9]+-\d+$/.test(res.state.players.A.active!.stack[0].printing)).toBe(true); // set-number, not fullName
  });

  it('accepts fullName printings too (back-compat) and projects identically to set-number input', () => {
    const fromSetNumber = step(board(RALTS), []).state;
    const fromFullName = step(board('Ralts SIT'), []).state; // same board, fullName identity in
    expect(fromFullName).toEqual(fromSetNumber);             // both project the canonical set-number printing
  });

  it('a successful step carries the contract envelope (schemaVersion + activeEffects)', () => {
    const res = step(board(RALTS), []);
    expect(res.status).toBe('awaitingAction');
    expect(res.schemaVersion).toBe(SCHEMA_VERSION);
    expect(res.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(res.state.activeEffects).toEqual([]);
  });

  // ── HTTP request/error/endpoint compliance ──

  let server: http.Server;
  beforeAll(done => { server = createConformanceApp().listen(0, done); });
  afterAll(done => { server.close(() => done()); });

  it('a missing schemaVersion is 400 malformedRequest', async () => {
    const res = await request(server, 'POST', '/v1/step', { initialState: board(RALTS), actions: [] });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('malformedRequest');
  });

  it('an unsupported schemaVersion is 400 unsupportedSchemaVersion', async () => {
    const res = await request(server, 'POST', '/v1/step', { schemaVersion: '9.9', initialState: board(RALTS), actions: [] });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('unsupportedSchemaVersion');
  });

  it('POST /v1/normalize is 501 notImplemented (the runner normalizes in-process)', async () => {
    const res = await request(server, 'POST', '/v1/normalize', { schemaVersion: SCHEMA_VERSION, state: board(RALTS) });
    expect(res.status).toBe(501);
    expect(res.json.error).toBe('notImplemented');
  });
});

function request(server: http.Server, method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers: data !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} },
      res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => { let json: any; try { json = raw ? JSON.parse(raw) : undefined; } catch { json = undefined; } resolve({ status: res.statusCode ?? 0, json }); });
      },
    );
    req.on('error', reject);
    if (data !== undefined) { req.write(data); }
    req.end();
  });
}
