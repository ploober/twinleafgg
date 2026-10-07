import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-490 — Morpeko par-121 Energizer Wheel (70): "Move 2 [D] Energy from this Pokémon to 1 of your Benched Pokémon."
 *
 * The card built `blocked` from card ids where AttachEnergyPrompt reads indices into the source list, so a non-[D]
 * Energy could be offered and a forced move failed the prompt's own validate (HTTP 500 in the unlimited run); and the
 * move ran on WAS_ATTACK_USED, before the 70 (#649 / #543: attack effects apply after damage).
 *
 * Mutation guards: `blocked` back to card ids and the forced / [W]-excluded cells go red; the rider back on
 * WAS_ATTACK_USED and the damage cell goes red.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const DARK = 'sve-007';
const BELLSPROUT = 'asc-004';

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
function deck(tag: string): CardRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
function board(energy: string[], benchCount: number): NeutralState {
  const bench = Array.from({ length: benchCount }, (_, i) => mon(`a${i + 2}`, BELLSPROUT));
  const A: PlayerState = { active: mon('a1', 'par-121', energy), bench, hand: [], deck: deck('a'), discard: [], lostZone: [],
    prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', 'twm-118'), bench: [mon('b2', BELLSPROUT)], hand: [], deck: deck('b'), discard: [],
    lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const wheel = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Energizer Wheel' } as unknown as NeutralAction;
function legal(r: ReturnType<typeof step>): string[] {
  return (r.pending?.legalActions || []).map(a => {
    const x = a as { type: string, card?: string, target?: string };
    return [x.type, x.card, x.target].filter(v => v !== undefined).join(':');
  }).sort();
}

describe('TA-490 Morpeko Energizer Wheel', () => {
  // The all-2-of-2 move to the only bencher collapses (TA-491); this cell pins that it completes, which 500'd before.
  it('two [D] and one Benched Pokemon: the move completes with both [D] on the Bench [TA-490 par-121]', () => {
    const r = step(board([DARK, DARK], 1), [wheel]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.bench[0].energy.map(e => e.iid).sort()).toEqual(['a1e0', 'a1e1']);
  });

  // TA-659 / B.89 (1): the Energy and the Benched Pokémon are chosen before the damage (rulebook Step D); the move
  // still comes after it. Supersedes TA-490's "70 before the move decision".
  it('the move decision is asked before the 70 [TA-490 par-121, TA-659]', () => {
    const r = step(board([DARK, DARK, WATER], 2), [wheel]);
    expect(r.state.players.B.active!.damage).toBe(0);
  });

  it('only [D] Energy is offered, and the non-[D] stays on Morpeko [TA-490 par-121]', () => {
    const r = step(board([DARK, DARK, WATER], 2), [wheel]);
    expect(legal(r).length).toBeGreaterThan(0);
    expect(legal(r).some(a => a.includes('a1e2'))).toBe(false);
  });
});
