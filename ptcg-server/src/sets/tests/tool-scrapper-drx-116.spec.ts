import { setupGame, padDeck } from './test-helpers';

// Repro for the Tool Scrapper (asc-212 / DRX 116) offer-then-reject bug surfaced by the cross-engine
// enumeration fuzz as a CONTRACT self-inconsistency (twinleaf listed `playItem` in legalActions, then
// rejected the play with CANNOT_PLAY_THIS_CARD).
//
// "Choose up to 2 Pokémon Tool cards attached to Pokémon in play ... and discard them." Like its
// siblings Field Blower and Startling Megaphone, the effect throws CANNOT_PLAY_THIS_CARD when there
// is no Pokémon Tool in play (a Trainer with no possible effect can't be played) — but Tool Scrapper
// had no canPlay, so it reported itself playable and was offered. Fix: gate canPlay on ≥1 Tool in play.
describe('Tool Scrapper DRX — canPlay requires a Pokémon Tool in play', () => {
  it('canPlay is false when no Pokémon Tool is attached to any Pokémon', () => {
    const game = setupGame({
      turn: 3,
      player1: { active: { card: 'Ralts SIT' }, hand: ['Tool Scrapper DRX'], deck: padDeck(10) },
      player2: { active: { card: 'Ralts SIT' }, deck: padDeck(10) },
    });
    const player = game.state.players[0];
    const card = player.hand.cards.find(c => c.fullName === 'Tool Scrapper DRX') as any;
    expect(card.canPlay(game.store, game.state, player)).toBe(false);
  });

  it('canPlay is true when a Tool is attached (own or opponent)', () => {
    const game = setupGame({
      turn: 3,
      player1: {
        active: { card: 'Ralts SIT', tools: ['Forest Seal Stone SIT'] },
        hand: ['Tool Scrapper DRX'],
        deck: padDeck(10),
      },
      player2: { active: { card: 'Ralts SIT' }, deck: padDeck(10) },
    });
    const player = game.state.players[0];
    const card = player.hand.cards.find(c => c.fullName === 'Tool Scrapper DRX') as any;
    expect(card.canPlay(game.store, game.state, player)).toBe(true);
  });
});
