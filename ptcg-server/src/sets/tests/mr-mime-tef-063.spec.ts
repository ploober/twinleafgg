import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, hasActivePokemon } from './card-test-helpers';
import { SpecialCondition } from '../../game/store/card/card-types';

// TA-96 — Mr. Mime tef-063 "Look-Alike Show" is an ATTACK. Only Asleep/Paralyzed prevent attacking;
// Poison/Burn/Confusion do not. twinleaf threw CANNOT_USE_POWER whenever the attacker had ANY special
// condition, so a Poisoned Mr. Mime could not use Look-Alike Show.
beforeAll(() => { loadAllSets(); });

describe('Mr. Mime TEF — Look-Alike Show (TA-96)', () => {
  it('can be used while the attacker is Poisoned', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Mr. Mime TEF', energy: ['Psychic Energy SVE'] },
        deck: padDeck(10),
      },
      player2: { active: { card: 'Arceus V BRS' }, hand: [], deck: padDeck(10) },
    });

    // Poison the attacker — this must NOT block the attack.
    game.state.players[0].active.addSpecialCondition(SpecialCondition.POISONED);

    // Before the fix this threw GameError CANNOT_USE_POWER.
    useAttack(game.store, game.state, 0, 'Look-Alike Show');

    expect(hasActivePokemon(game.state, 0)).toBe(true);
  });
});
