import { setupGame, loadAllSets } from './test-helpers';
import { useAttack, hasActivePokemon } from './card-test-helpers';

// TA-97 — Vivillon ssp-007 "Evo-Powder" (0 dmg): "For each of your Benched Pokémon, search your deck
// for a card that evolves from that Pokémon and evolve it. Then shuffle." An attack is legal whenever
// its cost is met; with an empty deck (or nothing to evolve) it simply does nothing. twinleaf's
// generator threw CANNOT_PLAY_THIS_CARD, blocking declaration.
beforeAll(() => { loadAllSets(); });

describe('Vivillon SSP — Evo-Powder (TA-97)', () => {
  it('is usable (no-op) with an empty deck / nothing to evolve', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Vivillion SSP', energy: ['Grass Energy SVE'] }, // [C]
        deck: [], // nothing to search
      },
      player2: { active: { card: 'Arceus V BRS' }, deck: [] },
    });

    expect(() => useAttack(game.store, game.state, 0, 'Evo-Powder')).not.toThrow();
    expect(hasActivePokemon(game.state, 0)).toBe(true);
  });
});
