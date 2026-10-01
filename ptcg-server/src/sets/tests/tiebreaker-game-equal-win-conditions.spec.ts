import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getWinner } from './card-test-helpers';
import { GameWinner } from '../../game/store/state/state';

// TA-561 (2026-10-01). Rulebook, "What if both players win at the same time?": "If this happens, play a tiebreaker
// game. However, if you win in both ways and your opponent wins in only one way, you are the victor!" Our TA-76 fix
// (check-effect.ts checkWinner) ended an EQUAL count of win conditions as a DRAW in every game, calling sudden death
// a tournament-only overlay - the base rulebook says otherwise, and upstream starts the tiebreaker game. The draw is
// right only for the conformance contract, which scores the tied game itself (outcome `tie`); its tiebreaker is a new
// game outside any scenario. That is now a rule the conformance importer sets (Rules.tiebreakerGame = false).
//
// Board: Revavroom ex "Shattering Speed" (250, "Discard this Pokemon and all attached cards") Knocks Out B's last
// Pokemon while discarding A's last Pokemon: each player has one win condition (the opponent has no Pokemon).
beforeAll(() => { loadAllSets(); });

describe('equal win conditions start a tiebreaker game [TA-561]', () => {
  const board = () => setupGame({
    turn: 2,
    player1: {
      active: { card: 'Revavroom ex SFA', energy: ['Metal Energy SVE', 'Metal Energy SVE', 'Metal Energy SVE'] },
      deck: padDeck(12, 'Ralts SIT'),   // Basics, so the tiebreaker game's own setup can place an Active
    },
    player2: {
      active: { card: 'Ralts SIT' },
      deck: padDeck(12, 'Ralts SIT'),   // Basics, so the tiebreaker game's own setup can place an Active
    },
  });

  it('in a real game (default rules) the tie is not the end: a tiebreaker game starts', () => {
    const game = board();
    useAttack(game.store, game.state, 0, 'Shattering Speed');
    expect(getWinner(game.state)).not.toBe(GameWinner.DRAW);
    expect(game.state.isSuddenDeath).toBe(true);
  });

  it('with Rules.tiebreakerGame = false (the conformance contract) the tied game ends as a tie', () => {
    const game = board();
    (game.state.rules as { tiebreakerGame?: boolean }).tiebreakerGame = false;
    useAttack(game.store, game.state, 0, 'Shattering Speed');
    expect(getWinner(game.state)).toBe(GameWinner.DRAW);
    expect(game.state.isSuddenDeath).toBeFalsy();
  });
});
