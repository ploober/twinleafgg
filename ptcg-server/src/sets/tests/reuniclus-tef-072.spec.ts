import { setupGame, loadAllSets } from './test-helpers';
import { useAttack, hasActivePokemon } from './card-test-helpers';

// TA-97 — Reuniclus tef-072 "Summoning Gate" (0 dmg): "Look at the top 8 cards of your deck and put
// any number of Pokémon you find there onto your Bench. Shuffle the other cards into your deck." An
// attack is legal whenever its cost is met; with an empty deck (or a full Bench) it does nothing.
// twinleaf threw CANNOT_PLAY_THIS_CARD, blocking declaration. The look/bench prefab already no-ops
// safely on an empty deck or full Bench.
beforeAll(() => { loadAllSets(); });

describe('Reuniclus TEF — Summoning Gate (TA-97)', () => {
  it('is usable (no-op) with an empty deck', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Reuniclus TEF', energy: ['Grass Energy SVE'] }, // [C]
        deck: [],
      },
      player2: { active: { card: 'Arceus V BRS' }, deck: [] },
    });

    expect(() => useAttack(game.store, game.state, 0, 'Summoning Gate')).not.toThrow();
    expect(hasActivePokemon(game.state, 0)).toBe(true);
  });
});
