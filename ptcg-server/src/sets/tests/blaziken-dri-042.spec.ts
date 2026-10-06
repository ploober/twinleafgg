import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';
import { ChooseEnergyPromptType } from '../../game/store/prompts/choose-energy-prompt';

// TA-79 residual — Blaziken dri-042 "Inferno Kick Flurry" (120 to Active; "Discard 2 Energy from this
// Pokémon, and this attack also does 120 damage to 1 of your opponent's Benched Pokémon."). twinleaf
// deferred the 120 Active base damage until AFTER the self-discard rider, so at the discard pending the
// Active showed dmg=0 while rotomancer had already applied it (rulebook step F / #543/#649). Fix:
// APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS at the top; the Bench 120 is a literal, independent of effect.damage.
beforeAll(() => { loadAllSets(); });

describe('Blaziken DRI — Inferno Kick Flurry: choose, then damage, then discard (B.82, TA-494)', () => {
  it('asks the Energy choice before any damage; both 120s land, then the discard', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: {
          card: 'Blaziken DRI',
          // Cost [R,R,C]; 4 attached so the discard-2 forces a ChooseEnergyPrompt.
          energy: ['Fire Energy SVE', 'Fire Energy SVE', 'Fire Energy SVE', 'Fire Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Raging Bolt ex TEF' },     // no weakness, HP 240 => clean 120, survives
        bench: [{ card: 'Arceus V BRS' }],          // a Bench target so the snipe resolves cleanly
        deck: padDeck(10),
      },
    });

    // B.82 (owner 2026-10-05, #2002) supersedes TA-79's order for this attack: the Energy is CHOSEN before the damage,
    // then the damage (Active 120, Bench 120), then the discard. TA-494: the Bench 120 is not placed at the Bench pick.
    let observedActive = -1;
    let observedBench = -1;
    game.overridePrompt(ChooseEnergyPromptType, (_prompt, state) => {
      observedActive = getDamage(state, 1, 'active');
      observedBench = getDamage(state, 1, 0);
      return [0, 1];
    });

    useAttack(game.store, game.state, 0, 'Inferno Kick Flurry');

    expect(observedActive).toBe(0);              // the choice comes before the damage (B.82)
    expect(observedBench).toBe(0);               // TA-494: the Bench 120 is not placed at the pick
    expect(getDamage(game.state, 1, 'active')).toBe(120);
    expect(getDamage(game.state, 1, 0)).toBe(120); // Bench snipe still lands its 120
  });
});
