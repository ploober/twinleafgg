import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';

// TA-91 — Cinderace ex scr-028 "Garnet Volley": "180 damage to 1 of your opponent's Pokémon."
// The Active is a legal target, so with a lone opponent Active (empty Bench) it must deal 180 to
// that Active. twinleaf early-returned on `!hasBenched`, dealing 0 (a missed KO).
beforeAll(() => { loadAllSets(); });

describe('Cinderace ex SCR — Garnet Volley (TA-91)', () => {

  it('does 180 to a lone opponent Active (empty Bench)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: {
          card: 'Cinderace ex SCR',
          energy: ['Fire Energy SVE', 'Fighting Energy SVE', 'Darkness Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS' }, // 220 HP, no Fire weakness — survives 180, shows damage
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Garnet Volley');

    expect(getDamage(game.state, 1, 'active')).toBe(180);
  });
});
