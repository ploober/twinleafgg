import { setupGame, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';

// TA-97 — Greninja ex twm-106 "Shinobi Blade": "170 damage. You may search your deck for a card and
// put it into your hand. Then, shuffle your deck." The search is optional; with an empty deck the
// attack still deals 170. twinleaf threw CANNOT_USE_POWER at the top, blocking declaration (and the
// 170 never landed). An attack is legal whenever its cost is met (#1106/#1458/#1468).
beforeAll(() => { loadAllSets(); });

describe('Greninja ex TWM — Shinobi Blade (TA-97)', () => {
  it('deals 170 even with an empty deck (optional search skipped)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Greninja ex TWM', energy: ['Water Energy SVE'] },
        deck: [], // empty — nothing to search
      },
      player2: {
        active: { card: 'Mega Sharpedo ex M2' }, // 330 HP, no Water weakness — survives 170
        deck: [],
      }
    });

    useAttack(game.store, game.state, 0, 'Shinobi Blade');

    expect(getDamage(game.state, 1, 'active')).toBe(170);
  });
});
