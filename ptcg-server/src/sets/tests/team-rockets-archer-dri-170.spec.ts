import { setupGame, padDeck } from './test-helpers';

// Repro for the Team Rocket's Archer (asc-201 / DRI 170) precondition bug surfaced by the
// cross-engine enumeration fuzz as a CONTRACT self-inconsistency (twinleaf listed
// `playSupporter` in legalActions, then rejected its own play with CANNOT_PLAY_THIS_CARD),
// plus an [illegal] divergence vs rotomancer (which correctly does NOT offer it).
//
// "You can use this card only if any of your Team Rocket's Pokemon were Knocked Out during
// your opponent's last turn." reduceEffect enforces this (throws CANNOT_PLAY_THIS_CARD when the
// ARCHER_MARKER is absent), but canPlay omitted the check — so the card reported itself playable
// and was offered, only to be rejected. Fix: gate canPlay on the same marker.
describe("Team Rocket's Archer DRI — canPlay gates the KO precondition", () => {
  function freshGame() {
    return setupGame({
      turn: 3,
      player1: {
        active: { card: 'Ralts SIT' },
        hand: ["Team Rocket's Archer DRI"],
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Ralts SIT' },
        deck: padDeck(10),
      },
    });
  }

  it('canPlay is false when no Team Rocket Pokemon was Knocked Out last turn (marker absent)', () => {
    const game = freshGame();
    const player = game.state.players[0];
    const card = player.hand.cards.find(c => c.fullName === "Team Rocket's Archer DRI") as any;
    expect(card.canPlay(game.store, game.state, player)).toBe(false);
  });

  it('canPlay is true once the precondition marker is present', () => {
    const game = freshGame();
    const player = game.state.players[0];
    const card = player.hand.cards.find(c => c.fullName === "Team Rocket's Archer DRI") as any;
    player.marker.addMarker(card.ARCHER_MARKER, card);
    expect(card.canPlay(game.store, game.state, player)).toBe(true);
  });
});
