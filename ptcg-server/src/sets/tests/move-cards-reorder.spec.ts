import { MoveCardsEffect } from '../../game/store/effects/game-effects';
import { setupGame, padDeck } from './test-helpers';
import {
  getCardIds,
  getZone,
  getZoneCardIds,
  collectAllCardIds,
  expectNoDuplicateCards,
  expectCardsConserved
} from './card-test-helpers';

// Moving a specific card (or top-N cards) to the top/bottom of a non-empty pile must
// preserve the rest of the pile and neither lose nor duplicate any card.
describe('MoveCardsEffect toTop/toBottom into a non-empty pile', () => {

  function setup() {
    const game = setupGame({
      player1: {
        active: { card: 'Ralts SIT' },
        hand: ['Ralts SIT'],
        deck: padDeck(5),
      },
      player2: {
        active: { card: 'Ralts SIT' },
        deck: padDeck(5),
      }
    });
    return game;
  }

  it('appends a specific card to the BOTTOM without losing or duplicating cards (effect.cards)', () => {
    const game = setup();
    const deck = getZone(game.state, 0, 'deck');
    const hand = getZone(game.state, 0, 'hand');

    const deckIdsBefore = getCardIds(deck);
    const x = hand.cards[0];
    const idsBefore = collectAllCardIds(game.state);

    game.store.reduceEffect(
      game.state,
      new MoveCardsEffect(hand, deck, { cards: [x], toBottom: true })
    );

    expect(getZoneCardIds(game.state, 0, 'deck')).toEqual([...deckIdsBefore, x.id]);
    expect(getZoneCardIds(game.state, 0, 'hand')).toEqual([]);
    expectNoDuplicateCards(game.state);
    expectCardsConserved(game.state, idsBefore);
  });

  it('places a specific card on TOP without losing or duplicating cards (effect.cards)', () => {
    const game = setup();
    const deck = getZone(game.state, 0, 'deck');
    const hand = getZone(game.state, 0, 'hand');

    const deckIdsBefore = getCardIds(deck);
    const x = hand.cards[0];
    const idsBefore = collectAllCardIds(game.state);

    game.store.reduceEffect(
      game.state,
      new MoveCardsEffect(hand, deck, { cards: [x], toTop: true })
    );

    expect(getZoneCardIds(game.state, 0, 'deck')).toEqual([x.id, ...deckIdsBefore]);
    expect(getZoneCardIds(game.state, 0, 'hand')).toEqual([]);
    expectNoDuplicateCards(game.state);
    expectCardsConserved(game.state, idsBefore);
  });

  it('moves top-N cards to the BOTTOM of another pile without corruption (effect.count)', () => {
    const game = setup();
    const deck = getZone(game.state, 0, 'deck');
    const discard = getZone(game.state, 0, 'discard');

    // Seed the discard with one identifiable card to move via count.
    const y = deck.cards.splice(0, 1)[0];
    discard.cards.push(y);

    const deckIdsBefore = getCardIds(deck);
    const idsBefore = collectAllCardIds(game.state);

    game.store.reduceEffect(
      game.state,
      new MoveCardsEffect(discard, deck, { count: 1, toBottom: true })
    );

    expect(getZoneCardIds(game.state, 0, 'deck')).toEqual([...deckIdsBefore, y.id]);
    expect(getZoneCardIds(game.state, 0, 'discard')).toEqual([]);
    expectNoDuplicateCards(game.state);
    expectCardsConserved(game.state, idsBefore);
  });

  it('moves top-N cards to the TOP of another pile without corruption (effect.count)', () => {
    const game = setup();
    const deck = getZone(game.state, 0, 'deck');
    const discard = getZone(game.state, 0, 'discard');

    const y = deck.cards.splice(0, 1)[0];
    discard.cards.push(y);

    const deckIdsBefore = getCardIds(deck);
    const idsBefore = collectAllCardIds(game.state);

    game.store.reduceEffect(
      game.state,
      new MoveCardsEffect(discard, deck, { count: 1, toTop: true })
    );

    expect(getZoneCardIds(game.state, 0, 'deck')).toEqual([y.id, ...deckIdsBefore]);
    expect(getZoneCardIds(game.state, 0, 'discard')).toEqual([]);
    expectNoDuplicateCards(game.state);
    expectCardsConserved(game.state, idsBefore);
  });
});
