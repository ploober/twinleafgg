import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-740 / B.114: Yanmega ex dri-003 Jet Cyclone "Move 3 Energy from this Pokémon to 1 of your Benched Pokémon." Under
 * Meganium meg-010 Wild Growth each Basic Grass Energy provides two. "Move N Energy" uses between the fewest cards that
 * reach N and N cards (compendium #2205, #2127): with 3 Basic Grass, 2 or 3 cards. The picks stay one moveEnergy per card;
 * once the picked cards provide 3 and fewer than 3 are picked, the stop (confirm false) is offered beside the last card.
 * twinleaf moved all 3 after one pick. The control has no Meganium: 1 Energy per card, the prompt is as before.
 */

const GRASS = 'sve-001';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: energy.map((p, i) => ({ iid: `ae${i}`, printing: p })), tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  const deck: CardRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: 'sve-003' }));
  const prizes: PrizeRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: 'sve-003', faceUp: false }));
  return { active: null, bench: [], hand: [], deck, discard: [], lostZone: [], prizes, flags: flags(), ...over };
}
function board(grass: number, meganium: boolean): NeutralState {
  const bench = [mon('a1', 'pal-090')];
  if (meganium) { bench.push(mon('a2', 'meg-010')); }
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player('A', { active: mon('a0', 'dri-003', Array.from({ length: grass }, () => GRASS)), bench }),
      B: player('B', { active: mon('b0', 'asc-079') }),
    },
  } as NeutralState;
}
const attack = { actor: 'A', type: 'declareAttack', source: 'a0', name: 'Jet Cyclone' } as never;
const move = (card: string) => ({ actor: 'A', type: 'moveEnergy', card, source: 'a0', target: 'a1' } as never);
const stop = { actor: 'A', type: 'confirm', value: false } as never;
const offers = (r: ReturnType<typeof step>, type: string) => (r.pending?.legalActions ?? []).some(a => a.type === type);

describe('TA-740 Jet Cyclone moves 3 Energy, not 3 cards (B.114)', () => {
  it('[TA-740 dri-003] 3 Basic Grass under Wild Growth: after 2 cards (4 Energy) the stop is offered; stopping leaves 1 on Yanmega ex', () => {
    let r = step(board(3, true), [attack, move('ae0')]);
    expect(offers(r, 'confirm')).toBe(false);
    r = step(board(3, true), [attack, move('ae0'), move('ae1')]);
    expect(offers(r, 'confirm')).toBe(true);
    expect(offers(r, 'moveEnergy')).toBe(true);
    r = step(board(3, true), [attack, move('ae0'), move('ae1'), stop]);
    expect(r.state.players.A.active!.energy.map(c => c.iid)).toEqual(['ae2']);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid).sort()).toEqual(['ae0', 'ae1']);
  });
  it('[TA-740 dri-003 three] 3 Basic Grass under Wild Growth: taking the third card moves all 3 (#2205)', () => {
    const r = step(board(3, true), [attack, move('ae0'), move('ae1'), move('ae2')]);
    expect(r.state.players.A.active!.energy.length).toBe(0);
    expect(r.state.players.A.bench[0].energy.length).toBe(3);
  });
  it('[TA-740 dri-003 cap] 4 Basic Grass under Wild Growth: never more than 3 cards (#2127)', () => {
    const r = step(board(4, true), [attack, move('ae0'), move('ae1'), move('ae2')]);
    expect(offers(r, 'moveEnergy')).toBe(false);
    expect(r.state.players.A.active!.energy.map(c => c.iid)).toEqual(['ae3']);
  });
  it('[TA-740 dri-003 control] 3 Basic Grass without Meganium: no stop before the third card', () => {
    const r = step(board(4, false), [attack, move('ae0'), move('ae1')]);
    expect(offers(r, 'confirm')).toBe(false);
  });
});
