import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';
import { buildCapabilities } from '../capabilities';
import { buildCardsForSet, UnknownSetError } from '../cards';
import { toPrinting } from '../printing';
import { getCardByName } from '../../sets/tests/test-helpers';
import { EXCLUDED_RANDOM_CARDS } from '../excluded-random-cards';
import { handleStep, handleCapabilities, BadRequestError } from '../http/handlers';
import { createConformanceApp } from '../http/app';

// M6: capabilities, rejection codes, and the HTTP layer.

const PSY = 'Psychic Energy SVE';
const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT';   // "Memory Skip" [P]; retreat [C]
const KIRLIA = 'Kirlia SIT'; // evolves from Ralts

function markers(played = 1): PokemonMarkers {
  return { playedOnTurn: played, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(over: Partial<PlayerFlags> = {}): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0,
    vstarUsed: false, ...over,
  };
}
function pip(iid: string, printing: string, energy: CardRef[] = [], played = 1, conditions: ConditionToken[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions, markers: markers(played) };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState, turn = 3): NeutralState {
  const withDefaults = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }],
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withDefaults(A, 'A'), B: withDefaults(B, 'B') },
  };
}

describe('Conformance M6 — rejection codes', () => {

  it('a second energy attach in one turn → invalidAction/alreadyAttachedEnergy, rolled-back state', () => {
    const res = step(
      board(player({ active: pip('A-act', RALTS), hand: [{ iid: 'e0', printing: PSY }, { iid: 'e1', printing: PSY }] }),
            player({ active: pip('B-act', RALTS) })),
      [
        { actor: 'A', type: 'attachEnergy', card: 'e0', target: 'A-act' },
        { actor: 'A', type: 'attachEnergy', card: 'e1', target: 'A-act' },
      ],
    );
    expect(res.status).toBe('invalidAction');
    expect(res.reasonCode).toBe('ONCE_PER_TURN_EXHAUSTED');
    expect(res.index).toBe(1);                                  // the offending action's index
    expect(res.nativeReason!.source).toBe('twinleaf:GameMessage'); // verbatim engine code preserved
    expect(res.applied).toBe(1); // the first attach succeeded; the second was rejected + rolled back
    expect(res.state.players.A.active!.energy.map(e => e.iid)).toEqual(['e0']);
  });

  it('attacking with too little energy → notEnoughEnergy', () => {
    const res = step(
      board(player({ active: pip('A-act', RALTS) }), player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Memory Skip' }],
    );
    expect(res.status).toBe('invalidAction');
    expect(res.reasonCode).toBe('INSUFFICIENT_ENERGY');
    expect(res.applied).toBe(0);
  });

  it('an unknown attack name → unknownAttack', () => {
    const res = step(
      board(player({ active: pip('A-act', RALTS, [{ iid: 'e0', printing: PSY }]) }), player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Nonexistent Attack' }],
    );
    expect(res.status).toBe('invalidAction');
    expect(res.reasonCode).toBe('UNKNOWN_REFERENCE');
  });

  it('acting as the non-active player → notYourTurn', () => {
    const res = step(
      board(player({ active: pip('A-act', RALTS) }),
            player({ active: pip('B-act', RALTS), hand: [{ iid: 'be', printing: PSY }] })),
      [{ actor: 'B', type: 'attachEnergy', card: 'be', target: 'B-act' }],
    );
    expect(res.status).toBe('invalidAction');
    expect(res.reasonCode).toBe('NOT_YOUR_TURN');
  });

  it('evolving a Pokémon played this turn → cannotEvolveThisTurn', () => {
    const res = step(
      board(player({ active: pip('A-act', RALTS, [], /* played */ 3), hand: [{ iid: 'k', printing: KIRLIA }] }),
            player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A', type: 'evolve', card: 'k', target: 'A-act' }],
    );
    expect(res.status).toBe('invalidAction');
    expect(res.reasonCode).toBe('EVOLVE_NOT_ELIGIBLE');
  });

  it('a non-GameError (stray system action) still propagates — the boundary catches only GameError', () => {
    expect(() => step(
      board(player({ active: pip('A-act', RALTS) }), player({ active: pip('B-act', RALTS) })),
      [{ actor: 'system', type: 'flip', face: 'heads' }],
    )).toThrow();
  });
});

describe('Conformance M6 — capabilities', () => {

  it('reports engine identity and a per-set implemented-card count map', () => {
    const caps = buildCapabilities();
    expect(caps.engine).toBe('twinleaf');
    expect(caps.version).toBeTruthy();
    expect(caps.schemaVersion).toBe(SCHEMA_VERSION);
    const total = Object.values(caps.sets).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(1000);
    expect(caps.sets['sit']).toBeGreaterThan(0);
    expect(caps.sets['svi']).toBeGreaterThan(0); // loads once the stray exp-share.js build shadow is removed
    expect(Object.keys(caps.sets).every(code => code === code.toLowerCase())).toBe(true);
    expect(Object.values(caps.sets).every(n => Number.isInteger(n) && n > 0)).toBe(true);
  });

  it('GET /v1/cards enumerates a set\'s printed data, consistent with the count', () => {
    const caps = buildCapabilities();
    const sit = buildCardsForSet('SIT'); // set code is case-insensitive
    expect(sit.setCode).toBe('sit');
    expect(sit.cards.length).toBe(caps.sets['sit']);            // list length === capabilities count
    expect(sit.cards.every(c => /^[a-z0-9]+-/.test(c.printing))).toBe(true); // set-number printings
    const printings = sit.cards.map(c => c.printing);
    expect(printings).toEqual([...printings].sort((a, b) => a.localeCompare(b))); // sorted by printing

    const ralts = sit.cards.find(c => c.printing === toPrinting(getCardByName('Ralts SIT')));
    expect(ralts).toBeDefined();
    expect(ralts!.name).toBe('Ralts');
    expect(ralts!.supertype).toBe('Pokémon');
    expect(typeof ralts!.hp).toBe('number');
    expect((ralts!.attacks ?? []).length).toBeGreaterThan(0);
    expect(ralts!.rarity).toBeUndefined(); // twinleaf does not model rarity — field omitted

    // CF-23: a nondeterministic (inline-Math.random) card is still ENUMERATED in its set listing,
    // flagged `nondeterministic: true` — the catalog no longer blanket-excludes such cards.
    const iono = buildCardsForSet('pal').cards
      .find(c => c.printing === toPrinting(getCardByName('Iono PAL')));
    expect(iono).toBeDefined();
    expect(iono!.nondeterministic).toBe(true);
    // a set with no implemented cards → UnknownSetError (→ HTTP 404)
    expect(() => buildCardsForSet('zzz')).toThrowError(UnknownSetError);
  });

  it('EXCLUDED_RANDOM_CARDS matches the cards that call Math.random in source (drift guard)', () => {
    const derived = deriveExcludedRandomCards(path.resolve(__dirname, '../../sets'));
    expect([...EXCLUDED_RANDOM_CARDS].sort()).toEqual(derived.sort());
  });
});

describe('Conformance M6 — HTTP handlers', () => {

  it('handleStep returns the same envelope as step()', () => {
    const initial = board(player({ active: pip('A-act', RALTS) }), player({ active: pip('B-act', RALTS) }));
    const direct = step(initial, []);
    const viaHttp = handleStep({ schemaVersion: SCHEMA_VERSION, initialState: initial, actions: [] });
    expect(viaHttp).toEqual(direct);
  });

  it('handleStep rejects a malformed body with BadRequestError', () => {
    expect(() => handleStep({})).toThrowError(BadRequestError);
    expect(() => handleStep({ initialState: {}, actions: 'nope' })).toThrowError(BadRequestError);
    expect(() => handleStep('not an object')).toThrowError(BadRequestError);
  });

  it('handleCapabilities returns the capabilities object', () => {
    const caps = handleCapabilities();
    expect(typeof caps.sets).toBe('object');
    expect(Object.keys(caps.sets).length).toBeGreaterThan(0);
    expect(caps.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('POST /v1/step over a real socket returns the step envelope', async () => {
    const server = createConformanceApp().listen(0);
    try {
      const initial = board(player({ active: pip('A-act', RALTS) }), player({ active: pip('B-act', RALTS) }));
      const { status, json } = await request(server, 'POST', '/v1/step', { schemaVersion: SCHEMA_VERSION, initialState: initial, actions: [] });
      expect(status).toBe(200);
      expect(json.status).toBe('awaitingAction');
      expect(json.pending.descriptor).toBe('main');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('POST /v1/step with a malformed body returns 400', async () => {
    const server = createConformanceApp().listen(0);
    try {
      const { status, json } = await request(server, 'POST', '/v1/step', { actions: [] });
      expect(status).toBe(400);
      expect(json.error).toBe('malformedRequest'); // contract Error: `error` is a string code
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

// ── helpers ──

/** Re-derive the Math.random exclusion set from source — the same extraction that generated the constant. */
function deriveExcludedRandomCards(setsDir: string): string[] {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'tests') { walk(p); }
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) { continue; }
      const src = fs.readFileSync(p, 'utf8');
      if (!/Math\.random/.test(src)) { continue; }
      const re = /fullName\s*(?::\s*string)?\s*=\s*(['"])((?:\\.|(?!\1).)*)\1/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        out.add(m[2].replace(/\\(['"\\])/g, '$1'));
      }
    }
  };
  walk(setsDir);
  return [...out];
}

function request(server: http.Server, method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: any }> {
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
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : undefined }));
      },
    );
    req.on('error', reject);
    if (data !== undefined) { req.write(data); }
    req.end();
  });
}
