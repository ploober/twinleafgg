import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';

// TA-102 — Iron Moth sfa-009 "Suction": "Heal from this Pokémon the same amount of damage you did to
// your opponent's Active Pokémon." twinleaf healed effect.damage (the pre-Weakness base 30) instead
// of the actual amount dealt — so against a Fire-weak Active it dealt 60 but healed only 30.
beforeAll(() => { loadAllSets(); });

describe('Iron Moth SFA — Suction (TA-102)', () => {
  it('heals the actual (post-Weakness) damage dealt, not the base', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        // Iron Moth (Fire) with 60 damage on it; Suction cost [C,C].
        active: { card: 'Iron Moth SFA', energy: ['Grass Energy SVE', 'Grass Energy SVE'], damage: 60 },
        deck: padDeck(10),
      },
      player2: {
        // Servine (Fire weakness, 100 HP) — takes 30 ×2 = 60, survives.
        active: { card: 'Servine SV11B', energy: [] },
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Suction');

    // Dealt 60 to the Fire-weak Active...
    expect(getDamage(game.state, 1, 'active')).toBe(60);
    // ...and healed the same 60 from Iron Moth (60 → 0), not just the base 30.
    expect(getDamage(game.state, 0, 'active')).toBe(0);
  });
});
