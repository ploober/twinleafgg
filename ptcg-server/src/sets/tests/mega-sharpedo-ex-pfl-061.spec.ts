import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getZoneCount, getDamage } from './card-test-helpers';

// TA-100 — Mega Sharpedo ex pfl-061. "Greedy Fang": "Draw 2 cards" (twinleaf drew 1). "Hungry Jaws":
// "+150 more if this Pokémon has any damage counters" — twinleaf's second block re-checked attack
// index 0, so the bonus never fired.
beforeAll(() => { loadAllSets(); });

describe('Mega Sharpedo ex M2 — Greedy Fang / Hungry Jaws (TA-100)', () => {
  it('Greedy Fang draws 2', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Mega Sharpedo ex M2', energy: ['Darkness Energy SVE'] },
        hand: [],
        deck: padDeck(12),
      },
      player2: { active: { card: 'Arceus V BRS' }, deck: padDeck(10) },
    });

    useAttack(game.store, game.state, 0, 'Greedy Fang');

    expect(getZoneCount(game.state, 0, 'hand')).toBe(2);
  });

  it('Hungry Jaws does 120 + 150 when this Pokemon has damage counters', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Mega Sharpedo ex M2', energy: ['Darkness Energy SVE', 'Darkness Energy SVE'], damage: 30 },
        deck: padDeck(12),
      },
      player2: { active: { card: 'Mega Sharpedo ex M2' }, deck: padDeck(10) }, // 330 HP wall survives 270
    });

    useAttack(game.store, game.state, 0, 'Hungry Jaws');

    // 120 + 150 = 270 (Arceus V 220 HP would be KO'd — read before KO clears? survives? use big HP)
    expect(getDamage(game.state, 1, 'active')).toBe(270);
  });
});
