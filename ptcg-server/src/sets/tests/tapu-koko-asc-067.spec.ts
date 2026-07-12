import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getZoneCount } from './card-test-helpers';

// TA-99 — Tapu Koko asc-067 "Fast Flight": "Discard your hand and draw 5 cards." twinleaf passed the
// LIVE player.hand.cards array to moveCardsTo, which splices while iterating and skips every other
// card — so only half the hand was discarded.
beforeAll(() => { loadAllSets(); });

describe('Tapu Koko M2a — Fast Flight (TA-99)', () => {
  it('discards the ENTIRE hand and draws 5', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Tapu Koko M2a', energy: ['Lightning Energy SVE'] },
        hand: ['Grass Energy SVE', 'Fire Energy SVE', 'Water Energy SVE', 'Psychic Energy SVE'],
        deck: padDeck(12),
      },
      player2: { active: { card: 'Arceus V BRS' }, deck: padDeck(10) },
    });

    useAttack(game.store, game.state, 0, 'Fast Flight');

    // All 4 original hand cards discarded; 5 fresh drawn.
    expect(getZoneCount(game.state, 0, 'discard')).toBe(4);
    expect(getZoneCount(game.state, 0, 'hand')).toBe(5);
  });
});
