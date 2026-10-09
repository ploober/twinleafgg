import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-662 / B.95 (owner 2026-10-07, confirmed): an action matches an advertised legalAction only if it carries every
 * field that entry carries, each with the same value; leaving one out, or giving a different value, makes the action
 * not offered: invalidAction (CF-12). The registered gates (CF-70's op / amount / destination, CF-38's subject) are not
 * compared here; neither is a template-only field.
 *
 * Board: Crunch dri-132 ("Discard an Energy from your opponent's Active Pokémon.") against B's Active b1 with two
 * Energy, so the discard pick is a real choice: discard {owner B, target b1e0 | b1e1}.
 */
const E = { G: 'sve-001', P: 'sve-005', D: 'sve-007' };

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: string[]): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: energy.map((p, i) => ({ iid: `${iid}e${i}`, printing: p })), tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, ps: string[]): CardRef[] {
  return ps.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string): PrizeRef[] {
  return cards(tag, [E.G, E.G, E.G]).map(c => ({ ...c, faceUp: false }));
}
const BOARD: NeutralState = {
  schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
  stadium: null,
  players: {
    A: player({ active: mon('a1', 'dri-132', [E.D, E.D, E.D]), bench: [mon('ab1', 'asc-004', [])], deck: cards('ad', Array(6).fill(E.G)), prizes: prizes('ap') }),
    B: player({ active: mon('b1', 'mew-003', [E.G, E.P]), bench: [mon('bb1', 'asc-004', [])], deck: cards('bd', Array(6).fill(E.G)), prizes: prizes('bp') }),
  },
} as NeutralState;

const crunch = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Crunch' } as never;
const discard = (fields: Record<string, unknown>) => ({ actor: 'A', type: 'discard', ...fields } as never);

describe('TA-662 / B.95: a pick must carry every field the offered entry carries, with its value', () => {
  it('the offered discard carries owner B [TA-662]', () => {
    const r = step(BOARD, [crunch]);
    const offered = r.pending?.legalActions.filter(a => a.type === 'discard') as Array<{ owner?: string; target?: string }>;
    expect(offered.map(a => a.target).sort()).toEqual(['b1e0', 'b1e1']);
    expect(offered.every(a => a.owner === 'B')).toBe(true);
  });

  it('the complete pick is accepted [TA-662]', () => {
    const r = step(BOARD, [crunch, discard({ owner: 'B', target: 'b1e0' })]);
    expect(r.status).not.toBe('invalidAction');
  });

  it('a pick without owner is invalidAction [TA-662]', () => {
    const r = step(BOARD, [crunch, discard({ target: 'b1e0' })]);
    expect(r.status).toBe('invalidAction');
    expect(r.applied).toBe(1);
  });

  it('a pick with owner A is invalidAction [TA-662]', () => {
    const r = step(BOARD, [crunch, discard({ owner: 'A', target: 'b1e0' })]);
    expect(r.status).toBe('invalidAction');
  });

  it('a gated field (CF-70 destination) is not compared: a different value is not a reason to refuse [TA-662]', () => {
    const r = step(BOARD, [crunch, discard({ owner: 'B', target: 'b1e0', destination: 'hand' })]);
    expect(r.status).not.toBe('invalidAction');
  });
});
