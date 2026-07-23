import { setupGame, padDeck, loadAllSets, choosePokemonCandidates } from './test-helpers';
import { useAttack, getDamage, getEnergyCount } from './card-test-helpers';
import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';

// TA-114 — N's Darmanitan JTG jtg-027 (and its asc-033 / svp-181 reprints) "Flamebody Cannon":
// "Discard all Energy from this Pokemon. This attack also does 90 damage to 1 of your opponent's
// BENCHED Pokemon." CF-10 (=> the TA-39 Thunder Raid fix) pins the Step-D bench-target CHOICE before
// the attack's other effects (rulebook p.19 Step D). twinleaf discarded the Energy FIRST and only then
// surfaced the choice, so at the choice the Energy was already gone — the cross-engine differential vs
// rotomancer (which holds the discard until after the choice) caught it. The final board is identical
// either way (all Energy discarded, 90 to the chosen Bench), so this pins the decision ORDER.
beforeAll(() => { loadAllSets(); });

describe("N's Darmanitan JTG — Flamebody Cannon (TA-114, CF-10 order)", () => {

  it('resolves the Step-D bench choice BEFORE discarding Energy (CF-10)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: {
          card: "N's Darmanitan JTG",
          energy: ['Fire Energy SVE', 'Fire Energy SVE', 'Fire Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS' },
        bench: [{ card: 'Arceus V BRS' }],
        deck: padDeck(10),
      }
    });

    let energyAtChoice = -1;
    game.overridePrompt('Choose pokemon', (prompt, state) => {
      // The state at the moment the Step-D bench choice is offered.
      energyAtChoice = getEnergyCount(state, 0, 'active');
      const candidates = choosePokemonCandidates(state, prompt as ChoosePokemonPrompt);
      return [candidates[0]];
    });

    useAttack(game.store, game.state, 0, 'Flamebody Cannon');

    // CF-10: the "Discard all Energy" effect must NOT have resolved yet at the Step-D choice.
    expect(energyAtChoice).toBe(3);
    // Final board (regression): all Energy discarded, 90 on the chosen Bench Pokemon.
    expect(getEnergyCount(game.state, 0, 'active')).toBe(0);
    expect(getDamage(game.state, 1, 0)).toBe(90);
  });

  it('with no opponent Bench, still discards all Energy (no Step-D choice, no bench damage)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: {
          card: "N's Darmanitan JTG",
          energy: ['Fire Energy SVE', 'Fire Energy SVE', 'Fire Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS' },
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Flamebody Cannon');

    // No Bench target => no bench damage, but the discard is unconditional.
    expect(getEnergyCount(game.state, 0, 'active')).toBe(0);
  });
});
