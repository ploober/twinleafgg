import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';

// TA-97 / RE-38 — Cinderace meg-028 "Turbo Flare": "50 damage. Search your deck for up to 3 Basic
// Energy cards and attach them to your Benched Pokémon... Then, shuffle your deck." An attack is legal
// whenever its cost is met; the search attaches to the BENCH, so with an empty deck (nothing to find)
// or no Benched Pokémon (no legal destination, #1108) there is no search and no shuffle — but the 50
// still lands. twinleaf threw CANNOT_USE_ATTACK on an empty deck (blocked declaration; 50 never landed).
beforeAll(() => { loadAllSets(); });

describe('Cinderace M1L — Turbo Flare (TA-97 / RE-38)', () => {
  it('deals 50 even with an empty deck', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Cinderace M1L', energy: ['Grass Energy SVE'] },
        deck: [],
      },
      player2: { active: { card: 'Mega Sharpedo ex M2' }, deck: [] },
    });
    useAttack(game.store, game.state, 0, 'Turbo Flare');
    expect(getDamage(game.state, 1, 'active')).toBe(50);
  });

  it('deals 50 with a non-empty deck but NO Benched Pokemon (no attach destination)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Cinderace M1L', energy: ['Grass Energy SVE'] },
        deck: padDeck(10, 'Fire Energy SVE'), // basic energy present, but no Bench to attach to
      },
      player2: { active: { card: 'Mega Sharpedo ex M2' }, deck: padDeck(10) },
    });
    useAttack(game.store, game.state, 0, 'Turbo Flare');
    expect(getDamage(game.state, 1, 'active')).toBe(50);
  });
});
