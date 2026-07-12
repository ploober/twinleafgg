import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, zoneContains, getDamage } from './card-test-helpers';

// TA-88 — Lillie's Comfey jtg-068 "Fade Out": "Put this Pokémon and all attached cards into your
// hand." twinleaf's reduceEffect only handled attack index 0 (Inviting Flowers); Fade Out (index 1)
// had NO handler, so the self-bounce never happened — Comfey stayed Active.
beforeAll(() => { loadAllSets(); });

describe('Lillie\'s Comfey JTG — Fade Out (TA-88)', () => {
  it('returns this Pokemon (and attached) to hand after dealing damage', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Lillie\'s Comfey JTG', energy: ['Psychic Energy SVE'] },
        bench: [{ card: 'Arceus V BRS' }], // so A can promote after the self-bounce
        deck: padDeck(10),
      },
      player2: { active: { card: 'Arceus V BRS' }, deck: padDeck(10) },
    });

    useAttack(game.store, game.state, 0, 'Fade Out');

    // 30 dealt, and Comfey bounced to hand.
    expect(getDamage(game.state, 1, 'active')).toBe(30);
    expect(zoneContains(game.state, 0, 'hand', 'Lillie\'s Comfey JTG')).toBe(true);
  });
});
