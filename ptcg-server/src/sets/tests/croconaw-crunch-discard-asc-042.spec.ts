import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack } from './card-test-helpers';
import { SuperType } from '../../game/store/card/card-types';

// TA-121 — Croconaw ASC "Crunch" (asc-042): "Flip a coin. If heads, discard an Energy from your
// opponent's Active Pokémon." The DiscardEnergyPrompt is built with `effect.player.id`, so its result
// `from` CardTarget is in the ATTACKER's perspective (TOP_PLAYER = the defender). The callback must
// resolve it against `effect.player` (as every sibling opponent-discard card does: mega-camerupt-ex,
// mega-charizard-x-ex, mega-diancie-ex, larrys-staraptor). Croconaw wrongly resolved it against
// `effect.opponent`, flipping TOP_PLAYER back to the attacker's own Active, so `moveCardTo` found
// nothing and the Energy was NEVER discarded. Coin flips default to heads in the test arbiter.
beforeAll(() => { loadAllSets(); });

function defenderEnergyAfterCrunch(): { energy: number; discard: number } {
  const game = setupGame({
    turn: 2,
    player1: {
      active: { card: 'Croconaw MC', energy: ['Water Energy SVE', 'Water Energy SVE'] }, // pays [W,W]
      deck: padDeck(10),
    },
    player2: {
      active: { card: 'Ralts SIT', energy: ['Water Energy SVE'] }, // hp 70 survives the 50; holds 1 Energy
      bench: [{ card: 'Rufflet SIT' }],
      deck: padDeck(10),
    },
  });
  useAttack(game.store, game.state, 0, 'Crunch'); // heads -> should discard the defender's lone Energy
  const active = game.player2.active;
  return {
    energy: active.cards.filter(c => c.superType === SuperType.ENERGY).length,
    discard: game.player2.discard.cards.filter(c => c.superType === SuperType.ENERGY).length,
  };
}

describe('TA-121 — Croconaw "Crunch" heads discards the DEFENDER\'s Energy [asc-042]', () => {
  it('the defending Pokemon loses its Energy to its own discard pile', () => {
    const res = defenderEnergyAfterCrunch();
    expect(res.energy).toBe(0);   // pre-fix: 1 (never discarded — wrong-perspective getTarget no-op)
    expect(res.discard).toBe(1);  // pre-fix: 0
  });
});
