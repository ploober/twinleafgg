import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * Broken-evolution fixes surfaced by the twinleaf-vs-rotomancer card-data differential
 * (`tools/xengine_card_diff.py`; rotomancer == canonical). Each of these Stage-1s could NOT evolve
 * on twinleaf because its `evolvesFrom` was missing (Delcatty, Bronzong), misspelled so it didn't
 * match twinleaf's own basic (Excadrill ex: `Drillbur` vs the `Drilbur` basic), or the card was
 * mis-typed as a Basic (Larry's Staravia). Repro: the basic in play (since a prior turn) + the
 * evolution in hand → the evolve must SUCCEED. RED before the fix (invalidAction / CANNOT_EVOLVE).
 */

const WATER = 'sve-003';
const RALTS = 'Ralts SIT';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function basic(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}

describe('Conformance — evolvesFrom broken-evolution fixes (xengine card-data differential)', () => {
  // `basicPrinting` in play (played turn 1) + `evoPrinting` in hand → evolve on turn 3 must succeed.
  function evolve(basicPrinting: string, evoPrinting: string): ReturnType<typeof step> {
    const A = player({
      active: basic('A-b', basicPrinting),
      hand: [{ iid: 'A-evo', printing: evoPrinting }],
      deck: [{ iid: 'A-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })),
    });
    const B = player({
      active: basic('B-b', RALTS),
      deck: [{ iid: 'B-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `B-pz${i}`, printing: WATER, faceUp: false })),
    });
    const s: NeutralState = { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
    return step(s, [{ actor: 'A', type: 'evolve', card: 'A-evo', target: 'A-b' }]);
  }

  const CASES: Array<[string, string, string]> = [
    ['Delcatty asc-166 evolves from Skitty', 'asc-165', 'asc-166'],
    ['Bronzong pfl-072 evolves from Bronzor', 'pfl-071', 'pfl-072'],
    ['Excadrill ex blk-046 evolves from Drilbur', 'blk-045', 'blk-046'],
    ["Larry's Staravia asc-169 evolves from Larry's Starly", 'asc-168', 'asc-169'],
  ];

  CASES.forEach(([name, b, evo]) => {
    it(name, () => {
      const res = evolve(b, evo);
      expect(res.status).not.toBe('invalidAction'); // the evolve is legal now
      const stack = res.state.players.A.active?.stack ?? [];
      expect(stack[stack.length - 1]?.printing).toBe(evo); // the evolution is now on top
    });
  });
});
