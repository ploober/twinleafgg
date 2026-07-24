import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';

// Repro for the Iron Jugulis (tef-139) reactive-ability double-fire surfaced by the cross-engine
// enumeration fuzz's new "defense" seed (enum-tef-139-defense B:declareAttack): twinleaf put 60 damage
// on the attacker, rotomancer put 30 (verified live on :8090/:8092/:8099).
//
// "Automated Combat": "If this Pokémon is damaged by an attack from your opponent's Pokémon (even if this
// Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon." = 30 damage. twinleaf's
// reduceEffect reacted to BOTH `DealDamageEffect` AND `PutDamageEffect`, and one attack flows through the
// pipeline as a DealDamageEffect that then spawns a PutDamageEffect — so the ability fired twice, placing
// 6 counters (60), not 3 (30). Idempotent sibling reactives (Numel/Heatran "now Burned") hide the bug;
// the cumulative counter effect exposes it. Fix: trigger on `AfterDamageEffect` (fires once), matching the
// correct sibling pattern (Twilight-Masquerade Heatran, Ascended-Heroes Numel).
beforeAll(() => { loadAllSets(); });

describe('Iron Jugulis TEF — Automated Combat places 3 counters, not 6 (reactive double-fire)', () => {
  it('puts exactly 30 damage (3 counters) on the Attacking Pokémon', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        // The aggressor: a tanky Basic that survives both the correct (30) and the buggy (60) counter
        // placement so its damage is readable, and whose 60-damage attack leaves 130-HP Iron Jugulis alive.
        active: { card: 'Sandy Shocks TEF', energy: ['Fighting Energy SVE', 'Fighting Energy SVE'] },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Iron Jugulis TEF' },
        deck: padDeck(10),
      },
    });

    useAttack(game.store, game.state, 0, 'Power Gem');

    // 3 damage counters = 30 damage on the attacker (player1's active). Pre-fix the ability double-fired
    // for a single attack and placed 60.
    expect(getDamage(game.state, 0, 'active')).toBe(30);
  });
});
