import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-738: attacks that count "each Energy attached" summed `provides.length` over the CheckProvidedEnergyEffect
 * energyMap. Team Rocket's Energy asc-217 ("provides 2 in any combination of [P] Energy and [D] Energy") pushes two
 * choosable entries of [P, D], each ONE unit (StateUtils.getProvidesUnitCount), so the sum read it as 4 Energy.
 * "For each Energy attached" counts Energy provided (compendium #466, #482, #669). Found by bug report
 * 1560812872823603370 (Delphox cri-013 Energized Storm: 390 where 270 is correct).
 *
 * Board: A's Active is the attacker with its cost plus one Water; A's Bench holds Team Rocket's Mewtwo ex asc-079 with
 * one Team Rocket's Energy (2 Energy); B's Active is Team Rocket's Mewtwo ex with one Team Rocket's Energy and one
 * Psychic (3 Energy); B's Bench holds an Energy-less Gothita. Each expected value is that arithmetic (rotomancer
 * f3e92fdba gives the same number on every row); each control row swaps both Team Rocket's Energy for a Psychic.
 */

const MEWTWO = 'asc-079';
const TRE = 'asc-217';
const PSYCHIC = 'sve-005';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function mon(iid: string, printing: string, energy: string[]): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: energy.map((p, i) => ({ iid: `${iid}e${i}`, printing: p })), tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, active: PokemonInPlay, bench: PokemonInPlay[]): PlayerState {
  const deck: CardRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: 'sve-003' }));
  const prizes: PrizeRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: 'sve-003', faceUp: false }));
  return { active, bench, hand: [], deck, discard: [], lostZone: [], prizes, flags: flags() };
}
function board(attacker: string, energy: string[], tr: boolean): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player('A', mon('a0', attacker, energy), [mon('a1', MEWTWO, [tr ? TRE : PSYCHIC])]),
      B: player('B', mon('b0', MEWTWO, tr ? [TRE, PSYCHIC] : [PSYCHIC]), [mon('b1', 'pal-090', [])]),
    },
  } as NeutralState;
}

// [attacker, name, attack, attached Energy, expected damage to B's Active with Team Rocket's Energy in play]
const ROWS: [string, string, string, string[], number][] = [
  ['asc-166', "Delcatty", "Energy Crush", ["sve-003", "sve-003", "sve-003"], 120],
  ['asc-172', "Mega Audino ex", "Ear Force", ["sve-003", "sve-003", "sve-003", "sve-003"], 260],
  ['cri-013', "Delphox", "Energized Storm", ["sve-002", "sve-002", "sve-003"], 240],
  ['cri-031', "Deoxys", "Psychic", ["sve-005", "sve-005", "sve-003", "sve-003"], 140],
  ['meg-098', "Tinkaton", "Windup Swing", ["sve-008", "sve-003"], 60],
  ['ssp-061', "Rotom", "Energy Short", ["sve-004", "sve-003"], 60],
  ['svi-065', "Magnezone ex", "Energy Crush", ["sve-004", "sve-003"], 150],
  ['svi-085', "Kirlia", "Psychic", ["sve-005", "sve-005", "sve-003", "sve-003"], 120],
  ['tef-024', "Rabsca", "Psychic", ["sve-001", "sve-003"], 100],
  ['twm-025', "Teal Mask Ogerpon ex", "Myriad Leaf Shower", ["sve-001", "sve-001", "sve-001", "sve-003"], 240],
  ['twm-055', "Phione", "Energy Press", ["sve-003", "sve-003"], 60],
  ['twm-081', "Kadabra", "Psychic", ["sve-005", "sve-003"], 100],
  ['twm-082', "Alakazam", "Psychic", ["sve-005", "sve-003"], 160],
];

describe('TA-738 Team Rocket\'s Energy counts as 2 Energy in "for each Energy attached"', () => {
  for (const [printing, name, attack, energy, expected] of ROWS) {
    it(`[TA-738 ${printing}] ${name} ${attack}: ${expected} with Team Rocket's Energy in play`, () => {
      const r = step(board(printing, energy, true), [{ actor: 'A', type: 'declareAttack', source: 'a0', name: attack } as never]);
      expect(r.state.players.B.active!.damage).toBe(expected);
    });
  }
  it('[TA-738 cri-013 control] Delphox Energized Storm without Team Rocket\'s Energy: 150 (5 Energy)', () => {
    const r = step(board('cri-013', ['sve-002', 'sve-002', 'sve-003'], false), [{ actor: 'A', type: 'declareAttack', source: 'a0', name: 'Energized Storm' } as never]);
    expect(r.state.players.B.active!.damage).toBe(150);
  });
});
