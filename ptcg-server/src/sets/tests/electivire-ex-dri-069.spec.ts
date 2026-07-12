import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';

// TA-90 — Electivire ex dri-069 "Dual Bolt": "This attack does 50 damage to 2 of your opponent's
// Pokémon." The Active is a legal target, and you do as much as you can when the opponent has fewer
// than 2 Pokémon. twinleaf routed this through a Bench-only, exactly-2 prefab, so a lone Active took
// 0 (a missed hit). Weakness/Resistance apply to the Active but not to Benched targets.
beforeAll(() => { loadAllSets(); });

describe('Electivire ex DRI — Dual Bolt (TA-90)', () => {

  it('does 50 to a lone opponent Active (fewer than 2 targets → as many as possible)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Electivire ex DRI', energy: ['Lightning Energy SVE', 'Grass Energy SVE'] },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS' }, // no Lightning weakness → 50 stays 50
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Dual Bolt');

    expect(getDamage(game.state, 1, 'active')).toBe(50);
  });

  it('does 50 to the Active and 50 to a Benched Pokemon when 2 are available', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Electivire ex DRI', energy: ['Lightning Energy SVE', 'Grass Energy SVE'] },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS' },
        bench: [{ card: 'Arceus V BRS' }],
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Dual Bolt');

    expect(getDamage(game.state, 1, 'active')).toBe(50);
    expect(getDamage(game.state, 1, 0)).toBe(50);
  });
});
