import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';

// TA-89 — Team Rocket's Hypno dri-080 "Bench Manipulation".
// "Your opponent flips a coin for each of their Benched Pokemon. This attack does 80 damage for
// each tails." With an EMPTY opponent Bench there are 0 flips => 0 tails => 0 damage. twinleaf left
// effect.damage at the declared base 80 when coinFlips===0, dealing a phantom 80 (illegitimate KO).
beforeAll(() => { loadAllSets(); });

describe('Team Rocket\'s Hypno DRI — Bench Manipulation (TA-89)', () => {

  it('does 0 damage when the opponent has no Benched Pokemon (no flips)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: {
          card: 'Team Rocket\'s Hypno DRI',
          energy: ['Psychic Energy SVE', 'Psychic Energy SVE', 'Psychic Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        // High-HP lone Active (no bench) so a phantom 80 would register as damage, not a KO.
        active: { card: 'Arceus V BRS' },
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Bench Manipulation');

    // 0 Benched => 0 tails => 0 damage.
    expect(getDamage(game.state, 1, 'active')).toBe(0);
  });
});
