import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getEnergyCount } from './card-test-helpers';

// TA-94 — Monferno twm-032 (confirmed by rotomancer RE-47). Canonical: "Chop" is a vanilla 40 (no
// rider); the "Discard an Energy from this Pokémon" belongs to "Heat Blow". twinleaf wired the
// discard to attack index 0 (Chop) and duplicated the text, so Chop wrongly discarded and Heat
// Blow's mandatory discard was dropped.
beforeAll(() => { loadAllSets(); });

describe('Monferno TWM — Chop / Heat Blow (TA-94)', () => {
  it('Chop does NOT discard an Energy', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Monferno TWM', energy: ['Fire Energy SVE', 'Fire Energy SVE', 'Fire Energy SVE'] },
        deck: padDeck(10),
      },
      player2: { active: { card: 'Arceus V BRS' }, deck: padDeck(10) },
    });
    const before = getEnergyCount(game.state, 0, 'active');
    useAttack(game.store, game.state, 0, 'Chop');
    expect(getEnergyCount(game.state, 0, 'active')).toBe(before);
  });

  it('Heat Blow discards 1 Energy', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Monferno TWM', energy: ['Fire Energy SVE', 'Fire Energy SVE', 'Fire Energy SVE'] },
        deck: padDeck(10),
      },
      player2: { active: { card: 'Arceus V BRS' }, deck: padDeck(10) },
    });
    const before = getEnergyCount(game.state, 0, 'active');
    useAttack(game.store, game.state, 0, 'Heat Blow');
    expect(getEnergyCount(game.state, 0, 'active')).toBe(before - 1);
  });
});
