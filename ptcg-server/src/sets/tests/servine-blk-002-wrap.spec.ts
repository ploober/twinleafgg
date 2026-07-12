import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, hasSpecialCondition, getEnergyCount, getDamage } from './card-test-helpers';
import { SpecialCondition } from '../../game/store/card/card-types';

// Black Bolt (SV11B) fullNames don't map to the loader's inferred set-code table, so register the
// full catalog up front — this defines 'Servine SV11B' before setupGame resolves it by fullName.
beforeAll(() => { loadAllSets(); });

// TA-103 / RE-50 — Servine blk-002 (Black Bolt) "Wrap".
// Real reprint (PkmnCards + Bulbapedia + card-data/final/blk.json):
//   "20 damage. Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
// twinleaf shipped the WRONG effect (discard an Energy from the opponent's Active) — this spec
// pins the correct behavior. Coin flips default to ALL_HEADS in the test arbiter.
describe('Servine SV11B — Wrap (TA-103 / RE-50)', () => {

  it('on heads, Paralyzes the opponent Active and does NOT discard its Energy', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Servine SV11B', energy: ['Grass Energy SVE'] },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Ralts SIT', energy: ['Psychic Energy SVE'] },
        deck: padDeck(10),
      }
    });

    const oppEnergyBefore = getEnergyCount(game.state, 1, 'active');

    useAttack(game.store, game.state, 0, 'Wrap');

    // Base 20 lands (Ralts is 70 HP — survives, so it can hold the condition).
    expect(getDamage(game.state, 1, 'active')).toBe(20);
    // The real rider: heads => opponent's Active is now Paralyzed.
    expect(hasSpecialCondition(game.state, 1, 'active', SpecialCondition.PARALYZED)).toBe(true);
    // And it must NOT discard the opponent's Energy — that was the TA-103 defect.
    expect(getEnergyCount(game.state, 1, 'active')).toBe(oppEnergyBefore);
  });
});
