import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-468 / B.18 — Archaludon ex ssp-130 "Assemble Alloy": "…you may attach up to 2 Basic [M] Energy cards from
 * your discard pile to your [M] Pokémon in any way you like." The "may" is the only decline. Once it is accepted,
 * #2301 floors an Ability's "up to 2" at 1, and the discard pile is public (A.9's fail-to-find does not reach it).
 * So the first attach pick offers no zero-stop; after one attach the stop is legal. Twinleaf's prompt said `min: 0`,
 * so the accepted may could resolve having attached nothing. Rotomancer floors it at 1.
 *
 * Mutation guard: put `min: 0` back and the first cell goes red. The second cell pins the legal stop after
 * one attach. The third pins that one eligible Energy (a forced single step) is applied by the CF-14 collapse.
 */

const DURALUDON = 'ssp-129';
const ARCHALUDON_EX = 'ssp-130';
const METAL = 'sve-008';
const GRASS = 'sve-001';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function mon(iid: string, printing: string): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
const cards = (tag: string, n: number, printing: string): CardRef[] => Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
const prizes = (tag: string): PrizeRef[] => cards(`${tag}p`, 3, GRASS).map(c => ({ ...c, faceUp: false }));
function board(metalInDiscard: number): NeutralState {
  const A: PlayerState = { active: mon('a1', DURALUDON), bench: [], hand: [{ iid: 'h1', printing: ARCHALUDON_EX }],
    deck: cards('ad', 10, GRASS), discard: cards('dc', metalInDiscard, METAL), lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', DURALUDON), bench: [], hand: [], deck: cards('bd', 10, GRASS), discard: [],
    lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'standard', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const evolve = act({ actor: 'A', type: 'evolve', card: 'h1', target: 'a1' });
const accept = act({ actor: 'A', type: 'confirm', value: true });
const types = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []).map(a => a.type);

describe('TA-468 Assemble Alloy: the accepted may floors "up to 2" at 1 (B.18)', () => {
  it('two Basic [M] in the discard: the first attach pick offers no zero-stop [TA-468 ssp-130]', () => {
    const r = step(board(2), [evolve, accept]);
    // TA-772 / B.116: Archaludon ex is the only target ("this Pokémon"), so each card is asked alone (choose).
    expect(types(r)).toContain('choose');
    expect(types(r)).not.toContain('confirm');
  });

  it('after one attach the stop is legal (control)', () => {
    const r = step(board(2), [evolve, accept, act({ actor: 'A', type: 'choose', target: 'dc0' })]);
    expect(types(r)).toContain('confirm');   // stop now legal…
    expect((r.pending?.legalActions ?? []).some(a => a.type === 'choose' && (a as { target?: string }).target === 'dc1')).toBe(true); // …or attach the second
  });

  it('one Basic [M] in the discard: the single forced attach is applied (CF-14)', () => {
    const r = step(board(1), [evolve, accept]);
    expect(types(r)).not.toContain('attachEnergy');
    expect(r.state.players.A.active!.energy.map(c => c.iid)).toEqual(['dc0']);
  });
});
