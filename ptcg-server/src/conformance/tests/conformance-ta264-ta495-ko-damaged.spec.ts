import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * A lethal damage placement that is not an attack's dealt damage still emits its `damaged` before the `ko`
 * (CF-6 / CF-60: one `damaged` per damage placement, including on a Knocked Out target; card-spec-design §9.1:
 * "placed damage counters and dealt damage emit the same event").
 *
 * TA-264: Team Rocket's Venture Bomb dri-179 — "Flip a coin. If heads, put 2 damage counters on 1 of your opponent's
 * Pokémon. If tails, put 2 damage counters on your Active Pokémon." (card-data/final/dri.json). On a 40-damage
 * Erika's Bellsprout asc-004 (60 HP) the 20 is lethal; twinleaf bf4bb0f32 emitted `ko` alone on both faces.
 *
 * TA-495: a Confused attacker's failed flip ("hurts itself", 3 damage counters) that Knocks it Out — twinleaf
 * bf4bb0f32 emitted `ko` alone (Koffing / Gothita / Gothorita / Mr. Mime rows; the self-damage is the engine's, not
 * the card's, so a Confused Erika's Bellsprout "Vine Slap" stands in).
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const BELLSPROUT = 'asc-004'; // Basic Grass, 60 HP, Vine Slap [G] 20

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, energy: string[] = [], damage = 0, conditions: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing: BELLSPROUT }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: [], damage, conditions: conditions as never,
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function ps(tag: string, active: PokemonInPlay, hand: string[] = []): PlayerState {
  return { active, bench: [mon(`${tag}b0`)], hand: cards(`${tag}h`, hand), deck: cards(`${tag}d`, Array(4).fill(WATER)),
    discard: [], lostZone: [], prizes: prizes(tag), flags: flags() };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
type Ev = { kind: string; player?: string; target?: string; hp?: number };
const evs = (r: ReturnType<typeof step>): Ev[] => (r.events ?? []) as unknown as Ev[];
const flip = (face: 'heads' | 'tails') => ({ actor: 'system', type: 'flip', face });
/** The `damaged` on `target` and its index, and the `ko` index on the same target. */
function koTrace(r: ReturnType<typeof step>, target: string) {
  const e = evs(r);
  const d = e.findIndex(x => x.kind === 'damaged' && x.target === target);
  const k = e.findIndex(x => x.kind === 'ko' && x.target === target);
  return { d, k, hp: d >= 0 ? e[d].hp : undefined };
}
/** Play Venture Bomb, script the flip, and on heads answer the target pick with `pick`. */
function bomb(face: 'heads' | 'tails', damage: number): ReturnType<typeof step> {
  const s = () => board(ps('a', mon('a1', [], face === 'tails' ? damage : 0), ['dri-179']),
    ps('b', mon('b1', [], face === 'heads' ? damage : 0)));
  const seq: unknown[] = [{ actor: 'A', type: 'playItem', card: 'ah0' }, flip(face)];
  let r = step(s(), seq as never);
  const pick = (r.pending?.legalActions ?? []).find(a => (a as { target?: string }).target === 'b1');
  if (r.status === 'awaitingAction' && r.pending?.actor === 'A' && pick) {
    seq.push(pick);
    r = step(s(), seq as never);
  }
  return r;
}
function confused(damage: number): ReturnType<typeof step> {
  return step(board(ps('a', mon('a1', [GRASS], damage, ['confused'])), ps('b', mon('b1'))),
    [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Vine Slap' }, flip('tails')] as never);
}

describe('TA-264 / TA-495: a lethal non-attack damage placement emits `damaged` before `ko`', () => {
  it('[TA-264] Venture Bomb heads: 2 lethal counters on the opponent\'s Active emit damaged 20 then ko', () => {
    const t = koTrace(bomb('heads', 40), 'b1');
    expect(t.k).toBeGreaterThanOrEqual(0);
    expect(t.d).toBeGreaterThanOrEqual(0);
    expect(t.d).toBeLessThan(t.k);
    expect(t.hp).toBe(20);
  });
  it('[TA-264] Venture Bomb tails: 2 lethal counters on its own Active emit damaged 20 then ko', () => {
    const t = koTrace(bomb('tails', 40), 'a1');
    expect(t.k).toBeGreaterThanOrEqual(0);
    expect(t.d).toBeGreaterThanOrEqual(0);
    expect(t.d).toBeLessThan(t.k);
    expect(t.hp).toBe(20);
  });
  it('control [TA-264]: Venture Bomb heads, non-lethal: damaged 20 and no ko', () => {
    const t = koTrace(bomb('heads', 0), 'b1');
    expect(t.hp).toBe(20);
    expect(t.k).toBe(-1);
  });
  it('[TA-495] a Confused attacker that hurts itself into a Knock Out emits damaged 30 then ko', () => {
    const t = koTrace(confused(40), 'a1');
    expect(t.k).toBeGreaterThanOrEqual(0);
    expect(t.d).toBeGreaterThanOrEqual(0);
    expect(t.d).toBeLessThan(t.k);
    expect(t.hp).toBe(30);
  });
  it('control [TA-495]: a Confused attacker that survives its self-damage emits damaged 30 and no ko', () => {
    const t = koTrace(confused(0), 'a1');
    expect(t.hp).toBe(30);
    expect(t.k).toBe(-1);
  });
});
