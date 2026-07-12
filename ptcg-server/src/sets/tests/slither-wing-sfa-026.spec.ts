import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';
import { ChooseEnergyPromptType } from '../../game/store/prompts/choose-energy-prompt';

// TA-79 residual — Slither Wing sfa-026 "Smashing Wing" (130; "Discard 2 Energy from this Pokémon.").
// twinleaf deferred the 130 base damage until AFTER the self-discard rider, so at the discard pending
// the defender showed dmg=0 while rotomancer had already applied 130 (rulebook step F / #543/#649). Fix:
// APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS at the top of the Smashing Wing block. With >2 attached Energy the
// discard emits a ChooseEnergyPrompt; we intercept it and assert the defender already has 130.
beforeAll(() => { loadAllSets(); });

describe('Slither Wing SFA — Smashing Wing damage-before-rider (TA-79)', () => {
  it('applies the 130 base damage BEFORE the energy-discard rider prompt', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: {
          card: 'Slither Wing SFA',
          // Cost [F,F,C]; 4 attached so the discard-2 forces a which-choice ChooseEnergyPrompt.
          energy: ['Fighting Energy SVE', 'Fighting Energy SVE', 'Fighting Energy SVE', 'Fighting Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Raging Bolt ex TEF' }, // no weakness, HP 240 => clean 130, survives
        deck: padDeck(10),
      },
    });

    let observedDmg = -1;
    game.overridePrompt(ChooseEnergyPromptType, (_prompt, state) => {
      observedDmg = getDamage(state, 1, 'active');
      return [0, 1]; // discard the first two Energy (covers the [C,C] discard cost)
    });

    useAttack(game.store, game.state, 0, 'Smashing Wing');

    expect(observedDmg).toBe(130);          // RED: 0, GREEN: 130
    expect(getDamage(game.state, 1, 'active')).toBe(130);
  });
});
