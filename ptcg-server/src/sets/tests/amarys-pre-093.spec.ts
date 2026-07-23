import { setupGame, padDeck } from './test-helpers';
import { playTrainerCard, endTurn, getZoneCount, expectNoDuplicateCards } from './card-test-helpers';

// Repro for the pre-093 Amarys end-of-turn discard bug surfaced by the cross-engine
// enumeration fuzz (path: enum-pre-093 A:playSupporter A:endTurn, pure-[state] divergence).
//
// Amarys PRE: "Draw 4 cards. At the end of this turn, if you have 5 or more cards in your
// hand, discard your hand." The end-of-turn clause must discard the ENTIRE hand.
//
// Root cause: amarys.ts called `hand.moveCardsTo(hand.cards, discard)` — passing the live
// `hand.cards` array as the list to iterate while moveCardsTo splices those same cards out of
// it. The loop bound shrinks as it goes, so only every other card is removed (a 6-card hand
// discards 3 and keeps 3). Rotomancer discards the whole hand (correct); twinleaf kept half.
// Fixed by making CardList.moveCardsTo snapshot the input array when it aliases `this.cards`.
describe('Amarys PRE — end-of-turn discard your hand', () => {
  it('discards the ENTIRE hand at end of turn when 5+ cards remain', () => {
    const game = setupGame({
      turn: 3,
      player1: {
        active: { card: 'Ralts SIT' },
        // 2 fillers + Amarys; after playing Amarys and drawing 4 the hand is 6 (>= 5).
        hand: ['Amarys PRE', 'Water Energy SVE', 'Water Energy SVE'],
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Ralts SIT' },
        deck: padDeck(10),
      },
    });

    playTrainerCard(game.store, game.state, 0, 'Amarys PRE');

    // Sanity: drew 4 onto the 2 fillers left after playing Amarys.
    expect(getZoneCount(game.state, 0, 'hand')).toBe(6);

    endTurn(game.store, game.state);

    // The whole hand must be discarded — not a mutate-during-iteration half (which left 3).
    expect(getZoneCount(game.state, 0, 'hand')).toBe(0);
    expectNoDuplicateCards(game.state);
  });
});
