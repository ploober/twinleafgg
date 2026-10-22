import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-739: Jumbo Ice Cream pfl-091 / cri-109: "Heal 80 damage from your Active Pokémon that has 3 or more Energy
 * attached." twinleaf counted Energy CARDS (energies.cards.length in canPlay, energyMap.length in the effect). Under
 * Meganium meg-010 Wild Growth each Basic Grass Energy provides two, and that counts as attached Energy (compendium
 * #2237), so 2 Basic Grass is 4 Energy and the heal applies. Found by bug report 1560492015253192816. The control has
 * no Meganium: 2 Energy, so the card cannot be played for its effect.
 */

const GRASS = 'sve-001';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function mon(iid: string, printing: string, energy: string[], damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: energy.map((p, i) => ({ iid: `${iid}e${i}`, printing: p })), tools: [], damage, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  const deck: CardRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: 'sve-003' }));
  const prizes: PrizeRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: 'sve-003', faceUp: false }));
  return { active: null, bench: [], hand: [], deck, discard: [], lostZone: [], prizes, flags: flags(), ...over };
}
function board(jumbo: string, meganium: boolean): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player('A', { active: mon('a0', 'dri-003', [GRASS, GRASS], 100), bench: meganium ? [mon('a1', 'meg-010', [])] : [], hand: [{ iid: 'ah0', printing: jumbo }] }),
      B: player('B', { active: mon('b0', 'pal-090', []) }),
    },
  } as NeutralState;
}
const play = { actor: 'A', type: 'playItem', card: 'ah0' } as never;

describe('TA-739 Jumbo Ice Cream counts the Energy provided', () => {
  it('[TA-739 pfl-091] 2 Basic Grass under Wild Growth (4 Energy): heals 80', () => {
    const r = step(board('pfl-091', true), [play]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.active!.damage).toBe(20);
    expect(r.state.players.A.discard.map(c => c.iid)).toContain('ah0');
  });

  it('[TA-739 cri-109] 2 Basic Grass under Wild Growth (4 Energy): heals 80', () => {
    const r = step(board('cri-109', true), [play]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.active!.damage).toBe(20);
    expect(r.state.players.A.discard.map(c => c.iid)).toContain('ah0');
  });

  it('[TA-739 pfl-091 control] 2 Basic Grass without Meganium (2 Energy): no heal', () => {
    const r = step(board('pfl-091', false), [play]);
    expect(r.state.players.A.active!.damage).toBe(100);
  });
});
