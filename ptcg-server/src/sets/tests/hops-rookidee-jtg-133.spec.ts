import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, endTurn, getDamage } from './card-test-helpers';

// TA-101 — Hop's Rookidee jtg-133 "Intimidating Stare": "During your opponent's NEXT turn, attacks
// used by the Defending Pokémon do 20 less damage." The −20 must expire at the end of that one next
// turn. twinleaf's EndTurn cleanup removed the marker from `getOpponent(effect.player)`'s Pokémon
// (the wrong player), so it never cleared — the debuff persisted every later turn.
beforeAll(() => { loadAllSets(); });

describe('Hop\'s Rookidee JTG — Intimidating Stare (TA-101)', () => {

  it('expires after the opponent\'s immediate next turn (full damage two turns later)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Hop\'s Rookidee JTG', energy: ['Grass Energy SVE'] }, // [C] cost
        deck: padDeck(10),
      },
      player2: {
        // Mareep's Thunder Wave: 20, [L,C]. Lightning vs Rookidee's L weakness => ×2.
        active: { card: 'Mareep M4', energy: ['Lightning Energy SVE', 'Grass Energy SVE'] },
        deck: padDeck(10),
      }
    });

    // Turn 2 (A): stare. -> B's turn 3 is the debuff window.
    useAttack(game.store, game.state, 0, 'Intimidating Stare');
    // Turn 3 (B, the window): B does NOT attack.
    endTurn(game.store, game.state);
    // Turn 4 (A): pass.
    endTurn(game.store, game.state);
    // Turn 5 (B, TWO turns after the stare — window long expired): B attacks.
    useAttack(game.store, game.state, 1, 'Thunder Wave');

    // Full 20 ×2 weakness = 40. If the debuff wrongly persisted it would show the −20 reduction.
    expect(getDamage(game.state, 0, 'active')).toBe(40);
  });

  it('still applies the −20 during the opponent\'s immediate next turn (window)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Hop\'s Rookidee JTG', energy: ['Grass Energy SVE'] },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Mareep M4', energy: ['Lightning Energy SVE', 'Grass Energy SVE'] },
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Intimidating Stare'); // turn 2 (A)
    // Turn 3 (B, the window): B attacks immediately — the −20 must apply.
    useAttack(game.store, game.state, 1, 'Thunder Wave');

    // 40 (weakness) reduced by 20 = 20.
    expect(getDamage(game.state, 0, 'active')).toBe(20);
  });
});
