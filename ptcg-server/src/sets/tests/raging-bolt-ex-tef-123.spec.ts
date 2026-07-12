import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getZoneCount } from './card-test-helpers';

// TA-104 — Raging Bolt ex tef-123/218 "Burst Roar" ([C]; "Discard your hand and draw 6 cards."). twinleaf
// threw CANNOT_PLAY_THIS_CARD when the deck was empty, so the attack was omitted from legalActions and
// couldn't be declared. But it IS declarable — you discard your hand and draw as many as you can (0 on an
// empty deck); rotomancer correctly offers it. Same TA-97 declare-then-skip family: never block the
// declaration, no-op only the un-performable sub-effect (the draw whiffs; the hand discard still happens).
beforeAll(() => { loadAllSets(); });

describe('Raging Bolt ex TEF — Burst Roar on an empty deck (TA-104)', () => {
  it('is declarable on an empty deck: discards the hand, draws 0, does not throw', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Raging Bolt ex TEF', energy: ['Lightning Energy SVE'] }, // cost [C]
        hand: ['Grass Energy SVE', 'Fire Energy SVE', 'Water Energy SVE'],
        deck: [], // empty — the "draw 6" can't be fulfilled
      },
      player2: {
        active: { card: 'Arceus V BRS' },
        deck: padDeck(10),
      },
    });

    const discardBefore = getZoneCount(game.state, 0, 'discard');
    const handBefore = getZoneCount(game.state, 0, 'hand'); // 3

    // RED (pre-fix): threw CANNOT_PLAY_THIS_CARD. GREEN: declarable, no throw.
    expect(() => useAttack(game.store, game.state, 0, 'Burst Roar')).not.toThrow();

    // The hand is discarded (draw whiffs on the empty deck), so the hand emptied into the discard.
    expect(getZoneCount(game.state, 0, 'discard')).toBe(discardBefore + handBefore);
    expect(getZoneCount(game.state, 0, 'hand')).toBe(0);
  });
});
