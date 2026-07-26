import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';

// TA-134 — Zweilous `wht-066` (and its AR reprint `wht-147`, which extends this class and so shares
// the bug). The coin-flip rider was wired to the WRONG ATTACK INDEX:
//
//     WAS_ATTACK_USED(effect, 1, this)   // index 1 = "Pitch-Black Fangs"
//
// but the flips belong to attack index 0, "Double Hit" ("Flip 2 coins. This attack does 40 damage for
// each heads."). One off-by-one produced two opposite symptoms, which is why it read as two unrelated
// findings in the cross-engine corpus:
//
//   * Double Hit        — no flips ran, so the flat base `damage: 40` landed regardless of the coins.
//                         Deterministically 40 on every run; rotomancer dealt 80 on two heads.
//   * Pitch-Black Fangs — a plain 100-damage attack with NO text, yet twinleaf pended two coin flips
//                         that the card never asks for.
//
// The test harness arbiter is BotFlipMode.ALL_HEADS, so both coins are heads: 40 x 2 = 80.
beforeAll(() => { loadAllSets(); });

describe('Zweilous WHT — Double Hit coin flips are wired to the right attack (TA-134)', () => {

  function game() {
    return setupGame({
      turn: 2,
      player1: {
        active: {
          card: 'Zweilous SV11W',
          // Covers Double Hit [C,C] and Pitch-Black Fangs [D,D,C,C] from one board.
          energy: ['Darkness Energy SVE', 'Darkness Energy SVE', 'Darkness Energy SVE', 'Darkness Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Raging Bolt ex TEF' },   // HP 240, no weakness => clean arithmetic, survives
        deck: padDeck(10),
      },
    });
  }

  it('Double Hit does 40 per heads — 80 on two heads, not the flat base 40', () => {
    const g = game();
    useAttack(g.store, g.state, 0, 'Double Hit');
    // RED: 40 (base damage applied, flips never ran). GREEN: 80.
    expect(getDamage(g.state, 1, 'active')).toBe(80);
  });

  it('Pitch-Black Fangs does a flat 100 and raises no coin flip', () => {
    const g = game();
    let flips = 0;
    g.overridePrompt('Coin flip', () => { flips++; return true; });

    useAttack(g.store, g.state, 0, 'Pitch-Black Fangs');

    expect(getDamage(g.state, 1, 'active')).toBe(100);
    // RED: the misindexed rider fired here and overwrote damage with 40 x heads.
    expect(flips).toBe(0);
  });
});
