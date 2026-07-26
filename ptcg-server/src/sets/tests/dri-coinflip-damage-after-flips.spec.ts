import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';

// TA-134 sibling — Combusken `dri-041` "Double Kick" ("Flip 2 coins. This attack does 40 damage for
// each heads."). Unlike Zweilous the attack INDEX is correct; the bug is ordering:
//
//     COIN_FLIP_PROMPT(store, state, effect.player, result => { if (result) { heads++; } });
//     COIN_FLIP_PROMPT(store, state, effect.player, result => { if (result) { heads++; } });
//     effect.damage = 40 * heads;          // <- runs BEFORE either callback fires
//
// On the conformance wire the flips are externalised as `system flip` actions, so the effect PENDS
// and `heads` is still 0 when the damage is assigned => 0 damage on any outcome. (The card also
// discards the State each COIN_FLIP_PROMPT returns, so the second call reduces against a stale state.)
//
// NOTE ON THIS TEST'S AUTHORITY: the jasmine harness arbiter (BotFlipMode.ALL_HEADS) may resolve a
// CoinFlipEffect synchronously inside reduceEffect, in which case the callbacks WOULD have run by the
// assignment and this spec passes even while the wire is broken. If that happens the card-level test
// is not a valid witness for this defect and the conformance-level repro is the authority. Measured
// before the fix: see the commit message.
beforeAll(() => { loadAllSets(); });

// Found by sweeping the shape rather than the card: 12 files matched a first-pass regex, and a
// precise brace-depth check cut that to 6 real (the other 6 assign damage INSIDE the callback and are
// fine — a 50% false-positive rate, which is why the crude scan is a lead and not a count).
// Only `dri-029` is in the rotomancer pool alongside `dri-041`; the remaining 4 (claydol CES,
// raichu CEC, larvitar PAL, pawniard OBF, sandile BLW) are out-of-pool and deferred per the standing
// twinleaf fix-scope rule — they are listed in the fix ledger, ready to fix.
const CASES = [
  { card: 'Combusken DRI', attack: 'Double Kick',     energy: ['Fire Energy SVE', 'Fire Energy SVE'], expect: 80 },
  { card: 'Ponyta DRI',    attack: 'Double Headbutt', energy: ['Fire Energy SVE'],                    expect: 20 },
];

describe('DRI coin-flip attacks — damage is assigned AFTER the flips (TA-134 siblings)', () => {
  CASES.forEach(c => {
    it(`${c.card} "${c.attack}" pays out per heads (${c.expect} on all heads), not 0`, () => {
      const g = setupGame({
        turn: 2,
        player1: {
          active: { card: c.card, energy: c.energy },
          deck: padDeck(10),
        },
        player2: {
          active: { card: 'Raging Bolt ex TEF' },   // HP 240, no weakness => clean arithmetic
          deck: padDeck(10),
        },
      });

      useAttack(g.store, g.state, 0, c.attack);
      expect(getDamage(g.state, 1, 'active')).toBe(c.expect);
    });
  });
});
