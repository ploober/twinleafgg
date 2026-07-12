import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage, hasSpecialCondition } from './card-test-helpers';
import { PlayerType, SlotType, SuperType, SpecialCondition } from '../../game';
import { DiscardEnergyPromptType } from '../../game/store/prompts/discard-energy-prompt';

// TA-79 residual — Regice ex asc-048 "Ice Prison" (140; "Discard 2 Energy from this Pokémon, and your
// opponent's Active Pokémon is now Paralyzed."). twinleaf deferred the 140 base damage until AFTER the
// self-discard rider resolved, so at the discard pending the defender showed dmg=0 while rotomancer
// (correctly, rulebook step F / compendium #543/#649) had already applied 140. Fix: run
// APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS at the top of the Ice Prison block. The discriminator is the
// intermediate state: we intercept the DiscardEnergyPrompt and assert the defender already has 140.
beforeAll(() => { loadAllSets(); });

describe('Regice ex ASC — Ice Prison damage-before-rider (TA-79)', () => {
  it('applies the 140 base damage BEFORE the energy-discard rider prompt', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: {
          card: 'Regice ex MC',
          // Ice Prison costs [W,C,C,C]; 4 attached so the discard-2 rider fires its prompt.
          energy: ['Water Energy SVE', 'Water Energy SVE', 'Water Energy SVE', 'Water Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS' }, // no Water weakness => clean 140
        deck: padDeck(10),
      },
    });

    let observedDmg = -1;
    let paralyzedAtPrompt = true;
    game.overridePrompt(DiscardEnergyPromptType, (_prompt, state) => {
      observedDmg = getDamage(state, 1, 'active');
      // Text order: "Discard 2 Energy, AND ... is now Paralyzed" — at the discard pending the Paralyze
      // must NOT yet be applied (rotomancer parity; twinleaf used to apply it before this pending).
      paralyzedAtPrompt = hasSpecialCondition(state, 1, 'active', SpecialCondition.PARALYZED);
      // Discard the first two attached Energy so the attack completes.
      const active = state.players[0].active;
      const idxs: number[] = [];
      active.cards.forEach((c, i) => { if (c.superType === SuperType.ENERGY && idxs.length < 2) { idxs.push(i); } });
      return idxs.map(i => ({ from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }, index: i }));
    });

    useAttack(game.store, game.state, 0, 'Ice Prison');

    // TA-79 discriminator: damage lands before the discard pending (RED: 0, GREEN: 140).
    expect(observedDmg).toBe(140);
    // Ordering discriminator: Paralyze applied strictly AFTER the discard (RED: true, GREEN: false).
    expect(paralyzedAtPrompt).toBe(false);
    // Final state: 140 stands and the opponent ends up Paralyzed.
    expect(getDamage(game.state, 1, 'active')).toBe(140);
    expect(hasSpecialCondition(game.state, 1, 'active', SpecialCondition.PARALYZED)).toBe(true);
  });
});
