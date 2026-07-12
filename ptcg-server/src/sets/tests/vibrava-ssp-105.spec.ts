import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, endTurn, getDamage } from './card-test-helpers';

// TA-92 — Vibrava ssp-105 "Screech": "During your next turn, the Defending Pokémon takes 50 more
// damage from this Pokémon's attacks." twinleaf's custom markers were wired wrong (marker on the
// attacker, gate checked the wrong marker on the wrong player), so the +50 never applied. Use the
// engine's DefendingPokemonTakesMoreDamageDuringAttackerNextTurn mechanism instead.
beforeAll(() => { loadAllSets(); });

describe('Vibrava SSP — Screech (TA-92)', () => {
  it('adds 50 to this Pokemon\'s attack during YOUR next turn', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Vibrava SSP', energy: ['Fighting Energy SVE', 'Grass Energy SVE'] },
        deck: padDeck(10),
      },
      player2: {
        // 330 HP, no Fighting weakness — survives 100 and shows the bonus cleanly.
        active: { card: 'Mega Sharpedo ex M2' },
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Screech'); // turn 2 (A): mark the Defending Pokemon
    endTurn(game.store, game.state);                 // turn 3 (B)
    useAttack(game.store, game.state, 0, 'Cutting Wind'); // turn 4 (A, YOUR next turn): 50 + 50

    expect(getDamage(game.state, 1, 'active')).toBe(100);
  });

  it('Cutting Wind alone (no Screech) does its base 50', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Vibrava SSP', energy: ['Fighting Energy SVE', 'Grass Energy SVE'] },
        deck: padDeck(10),
      },
      player2: { active: { card: 'Mega Sharpedo ex M2' }, deck: padDeck(10) },
    });

    useAttack(game.store, game.state, 0, 'Cutting Wind');

    expect(getDamage(game.state, 1, 'active')).toBe(50);
  });
});
