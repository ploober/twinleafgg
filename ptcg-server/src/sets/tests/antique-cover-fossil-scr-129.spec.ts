import { GameError } from '../../game/game-error';
import { GameMessage } from '../../game/game-message';
import { RetreatEffect } from '../../game/store/effects/game-effects';
import { setupGame, padDeck, getCardByName } from './test-helpers';

// Repro for the Antique Cover Fossil (scr-129) retreat-lock leak surfaced by the cross-engine
// enumeration fuzz (enum-blk-022/106/023/107 A:retreat: twinleaf `invalidAction`, rotomancer allows).
//
// Antique Cover Fossil is a Trainer that "plays as a 60-HP Basic Pokémon ... can't retreat." That
// restriction is a characteristic of the fossil WHILE it is the in-play Basic — once a Pokémon evolves
// onto it, the active is that evolution and it retreats per its own cost (the Basic's text does not carry
// up). Bug: reduceEffect blocked whenever `active.cards.includes(this)` — true even when the fossil is
// buried at the base of an evolved stack. The four sibling Antique fossils correctly gate on
// `active.getPokemonCard() === this` (only the actual active Pokémon), which is the fix applied here.
function throwsCannotRetreat(fn: () => void): boolean {
  try { fn(); return false; }
  catch (e) { return e instanceof GameError && (e as GameError).message === GameMessage.CANNOT_RETREAT; }
}

describe('Antique Cover Fossil SCR — retreat lock must not carry through evolution', () => {
  it('a Pokémon evolved onto the fossil (fossil at the stack base) may retreat', () => {
    const game = setupGame({
      turn: 3,
      player1: {
        // The active Pokémon (any Pokémon evolved onto the fossil) — Ralts stands in for the real
        // fossil evolution (Tirtouga SV11B), whose set module the test loader can't resolve; the
        // retreat-lock code only checks whether the fossil is the *active Pokémon*, not what it is.
        active: { card: 'Ralts SIT', energy: ['Psychic Energy SVE'] },
        bench: [{ card: 'Ralts SIT' }],
        deck: padDeck(10),
      },
      player2: { active: { card: 'Ralts SIT' }, deck: padDeck(10) },
    });
    // Bury the fossil under the active Pokémon to model the evolved stack (fossil = the played Basic).
    const active = game.state.players[0].active;
    const fossil = getCardByName('Antique Cover Fossil SCR');
    fossil.id = 9001;
    active.cards.unshift(fossil);
    expect(active.cards.includes(fossil)).toBe(true);          // fossil is in the stack (pre-fix: blocks)
    expect(active.getPokemonCard()!.name).toBe('Ralts');       // but the fossil is NOT the active Pokémon

    expect(throwsCannotRetreat(() =>
      game.store.reduceEffect(game.state, new RetreatEffect(game.state.players[0], 0))
    )).toBe(false);
  });

  it('a bare (unevolved) Antique Cover Fossil still cannot retreat', () => {
    const game = setupGame({
      turn: 3,
      player1: {
        active: { card: 'Antique Cover Fossil SCR' },
        bench: [{ card: 'Ralts SIT' }],
        deck: padDeck(10),
      },
      player2: { active: { card: 'Ralts SIT' }, deck: padDeck(10) },
    });
    expect(throwsCannotRetreat(() =>
      game.store.reduceEffect(game.state, new RetreatEffect(game.state.players[0], 0))
    )).toBe(true);
  });
});
