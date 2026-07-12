import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getEnergyCount } from './card-test-helpers';
import { ChooseCardsPromptType, ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { SuperType } from '../../game/store/card/card-types';

// Decision-granularity follow-on (CF-8) — Larvitar jtg-080 "Crunch": "Flip a coin. If heads, discard an
// Energy from your opponent's Active Pokémon." The discard is MANDATORY on heads (no "may"), but was coded
// `allowCancel: true` (declinable). That inaccuracy blocked the conformance adapter's CF-8 forced-atomic
// collapse of the single-candidate discard, so jtg-080 kept diverging from rotomancer (which auto-resolves
// the forced discard). Fix: allowCancel:false — then a lone opponent Energy is a forced discard and the
// adapter collapses it, matching roto. The auto-arbiter picks the card either way, so the discriminator is
// the prompt's allowCancel flag (RED true → GREEN false).
beforeAll(() => { loadAllSets(); });

describe('Larvitar JTG — Crunch mandatory heads discard (allowCancel:false)', () => {
  it('presents the heads discard as mandatory (allowCancel:false) and discards the opponent Energy', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Larvitar JTG', energy: ['Fighting Energy SVE', 'Fighting Energy SVE'] }, // cost [C,C]
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS', energy: ['Water Energy SVE'] }, // one Energy → forced single discard
        deck: padDeck(10),
      },
    });

    let observedCancel = true;
    game.overridePrompt(ChooseCardsPromptType, (prompt) => {
      const p = prompt as ChooseCardsPrompt;
      observedCancel = p.options.allowCancel;
      const idx = p.cards.cards.findIndex(c => c.superType === SuperType.ENERGY); // pick the Energy, not the Pokémon
      return [idx];
    });

    useAttack(game.store, game.state, 0, 'Crunch'); // arbiter defaults ALL_HEADS → the discard rider fires

    expect(observedCancel).toBe(false);                       // the discriminator (RED: true → GREEN: false)
    expect(getEnergyCount(game.state, 1, 'active')).toBe(0);  // opponent's lone Energy was discarded
  });
});
