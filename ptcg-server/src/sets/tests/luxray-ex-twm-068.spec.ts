import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getZoneCount, hasActivePokemon } from './card-test-helpers';
import { ChooseCardsPromptType, ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';

// TA-95 — Luxray ex twm-068 "Piercing Gaze": "Look at your opponent's hand and discard 1 card you
// find there." This is MANDATORY (exactly 1 when the opponent has any cards), but twinleaf offered the
// discard as ChooseCardsPrompt{min:0}, so the attacker could decline. The auto-arbiter always picks
// max, so we capture the real prompt the card emits and assert its min. (Also verifies the bogus
// `player.supporter.moveCardTo(this,…)` no-op is gone: Luxray must stay Active.)
beforeAll(() => { loadAllSets(); });

describe('Luxray ex TWM — Piercing Gaze (TA-95)', () => {
  it('presents the discard as mandatory (min:1) and discards exactly one', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Luxray ex TWM', energy: ['Grass Energy SVE', 'Grass Energy SVE'] }, // [C,C]
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS' },
        hand: ['Grass Energy SVE', 'Fire Energy SVE'], // non-empty → the discard is mandatory
        deck: padDeck(10),
      }
    });

    const discardBefore = getZoneCount(game.state, 1, 'discard');

    let observedMin = -1;
    game.overridePrompt(ChooseCardsPromptType, (prompt, _state) => {
      observedMin = (prompt as ChooseCardsPrompt).options.min;
      return [0]; // a valid pick so the attack completes
    });

    useAttack(game.store, game.state, 0, 'Piercing Gaze');

    // The discriminator: the mandatory discard must be presented as min:1, not skippable.
    // (Net opponent hand count is unaffected — the attack ends the turn and the opponent draws.)
    expect(observedMin).toBe(1);
    // Exactly one card discarded from the opponent, and Luxray is NOT wrongly discarded (dead line 82).
    expect(getZoneCount(game.state, 1, 'discard')).toBe(discardBefore + 1);
    expect(hasActivePokemon(game.state, 0)).toBe(true);
  });
});
