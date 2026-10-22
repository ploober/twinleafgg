import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-743: Hop's Dubwool jtg-136 Defiant Horn: "When you play this Pokémon from your hand to evolve 1 of your Pokémon
 * during your turn, you may switch in 1 of your opponent's Benched Pokémon to the Active Spot." With no Pokémon on the
 * opponent's Bench the switch cannot be carried out, so it is not offered (B.27; #13: an Ability cannot be used for no
 * effect). twinleaf asked the confirm and checked the Bench only inside it; rotomancer offers nothing. The control puts
 * one Pokémon on B's Bench: the confirm is offered.
 */

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  const deck: CardRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: 'sve-003' }));
  const prizes: PrizeRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: 'sve-003', faceUp: false }));
  return { active: null, bench: [], hand: [], deck, discard: [], lostZone: [], prizes, flags: flags(), ...over };
}
function board(bBench: boolean): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player('A', { active: mon('a0', 'pal-090'), bench: [mon('a1', 'jtg-135')], hand: [{ iid: 'ah0', printing: 'jtg-136' }] }),
      B: player('B', { active: mon('b0', 'pal-090'), bench: bBench ? [mon('b1', 'pal-090')] : [] }),
    },
  } as NeutralState;
}
const evolve = { actor: 'A', type: 'evolve', card: 'ah0', target: 'a1' } as never;

describe('TA-743 Defiant Horn needs an opponent\'s Benched Pokemon', () => {
  it('[TA-743 jtg-136] no Pokemon on the opponent\'s Bench: Defiant Horn is not offered', () => {
    const r = step(board(false), [evolve]);
    expect(r.status).toBe('awaitingAction');
    expect((r.pending?.legalActions ?? []).some(a => a.type === 'confirm')).toBe(false);
    expect(r.state.players.A.bench[0].stack.map(c => c.printing)).toEqual(['jtg-135', 'jtg-136']);
  });
  it('[TA-743 jtg-136 control] one Pokemon on the opponent\'s Bench: Defiant Horn is offered', () => {
    const r = step(board(true), [evolve]);
    expect((r.pending?.legalActions ?? []).some(a => a.type === 'confirm')).toBe(true);
  });
});
