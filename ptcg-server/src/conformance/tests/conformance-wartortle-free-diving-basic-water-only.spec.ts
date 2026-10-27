import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Wartortle mew-008 Free Diving: "Put up to 3 Basic [Water] Energy cards from your discard pile into your hand."
 * (card-data/final/mew.json). Only Basic Water Energy cards may be chosen: not a Water Pokémon (Squirtle mew-007), not a
 * Basic Energy of another type. twinleaf filtered on the Water type alone, so it offered Squirtle.
 */

const GRASS = 'sve-001', WATER = 'sve-003';
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function board(): NeutralState {
  const A: PlayerState = { active: mon('a1', 'mew-008', [WATER]), bench: [], hand: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `ad${i}`, printing: GRASS })),
    discard: [{ iid: 'x0', printing: 'mew-007' }, { iid: 'x1', printing: WATER }, { iid: 'x2', printing: GRASS }],
    lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', 'asc-148'), bench: [], hand: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `bd${i}`, printing: GRASS })),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const freeDiving = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Free Diving' } as unknown as NeutralAction;
const targets = (r: ReturnType<typeof step>) =>
  (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'choose').map(a => (a as { target: string }).target).sort();

describe('Wartortle Free Diving: Basic Water Energy cards only', () => {
  it('offers the Basic Water Energy and not Squirtle or the Grass Energy [TA-793 mew-008 offer]', () => {
    expect(targets(step(board(), [freeDiving]))).toEqual(['x1']);
  });
  it('choosing Squirtle is refused [TA-793 mew-008 refuse]', () => {
    const r = step(board(), [freeDiving, { actor: 'A', type: 'choose', target: 'x0' } as unknown as NeutralAction]);
    expect(r.status).toBe('invalidAction');
  });
  it('control: the Water Energy goes to the hand [TA-793 mew-008 take]', () => {
    const r0 = step(board(), [freeDiving, { actor: 'A', type: 'choose', target: 'x1' } as unknown as NeutralAction]);
    const done = (r0.pending?.legalActions ?? []).find(a => (a as { type: string }).type === 'confirm' || (a as { type: string }).type === 'endChoice');
    const r = done ? step(board(), [freeDiving, { actor: 'A', type: 'choose', target: 'x1' } as unknown as NeutralAction, done as NeutralAction]) : r0;
    expect(r.state.players.A.hand.map(c => c.iid)).toContain('x1');
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['x0', 'x2']);
  });
});
