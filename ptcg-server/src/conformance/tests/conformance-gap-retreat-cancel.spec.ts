import { RetreatAction, RetreatStartAction } from '../../game/store/actions/game-actions';
import { SpecialCondition } from '../../game/store/card/card-types';
import { ChoosePokemonPrompt, ChoosePokemonPromptType } from '../../game/store/prompts/choose-pokemon-prompt';
import { CheckRetreatCostEffect } from '../../game/store/effects/check-effects';
import { Prompt } from '../../game/store/prompts/prompt';
import { padDeck, setupGame } from '../../sets/tests/test-helpers';

/*
 * GAP: a retreat cancelled at its Bench choice keeps its cost and its cure (live-client path only).
 *
 * The rule (rulebook.md:270): "To retreat, you must discard 1 Energy from your Active Pokémon for
 * each {Colorless} listed in its Retreat Cost ... Then, you switch that retreating Pokémon with a
 * Pokémon from your Bench." Retreating is one act: the discard and the switch go together, and a
 * Pokémon that has not retreated has not paid a Retreat Cost and is not cured of Special Conditions.
 *
 * The defect: the socket client retreats through RetreatStartAction (player-turn-reducer.ts) ->
 * RetreatStartEffect (effect-reducers/retreat-effect.ts). That path opens the ChooseEnergyPrompt,
 * and in its callback calls player.active.clearEffects() (cures Special Conditions) and discards the
 * chosen Energy BEFORE it opens the Bench ChoosePokemonPrompt, which is built with allowCancel: true.
 * When the player cancels the Bench choice (result null) the callback simply returns: nothing is
 * restored. The Pokémon stays Active, short its Energy, cured, and retreatedTurn is not set, so the
 * player may start another retreat in the same turn.
 *
 * Why the wire cannot show it: the conformance driver (/v1/step) retreats with the one-step
 * RetreatAction(benchIndex), whose Bench target is fixed before any cost is paid; RetreatStartAction
 * is sent only by the socket client. This spec drives the engine directly.
 */
describe('Conformance gap: retreat cancelled at the Bench choice (RetreatStartAction)', () => {

  function board() {
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Ralts SIT', energy: ['Psychic Energy SVE', 'Water Energy SVE'] },
        bench: [{ card: 'Manaphy BRS' }],
        deck: padDeck(10)
      },
      player2: {
        active: { card: 'Ralts SIT' },
        deck: padDeck(10)
      }
    });
    const player = game.state.players[0];
    player.active.specialConditions.push(SpecialCondition.POISONED);
    const cost = new CheckRetreatCostEffect(player);
    game.store.reduceEffect(game.state, cost);
    return { game, player, retreatCost: cost.cost.length };
  }

  it('REPRO (open): cancelling the Bench choice leaves the Energy discarded, the Pokémon cured, and retreat still available', () => {
    // When this goes red, the bug is fixed: flip the assertion to the rule (Energy still attached,
    // still Poisoned, no Energy in the discard pile).
    const { game, player, retreatCost } = board();
    expect(retreatCost).toBeGreaterThan(0);
    expect(player.active.energies.cards.length).toBe(2);
    expect(player.discard.cards.length).toBe(0);

    const seen: string[] = [];
    // Observe the prompt sequence: let the harness auto-pay the Energy, then cancel the Bench choice.
    const store: any = game.store;
    const origPrompt = store.prompt.bind(store);
    store.prompt = (state: any, prompt: Prompt<any>, cb: any) => {
      seen.push(prompt.constructor.name);
      return origPrompt(state, prompt, cb);
    };
    game.overridePrompt(ChoosePokemonPromptType, (p: Prompt<any>) => {
      expect((p as ChoosePokemonPrompt).options.allowCancel).toBe(true);
      return null;
    });

    game.store.dispatch(new RetreatStartAction(player.id));

    // Prompt sequence: Energy payment first, then the cancellable Bench choice.
    expect(seen).toEqual(['ChooseEnergyPrompt', 'ChoosePokemonPrompt']);
    // Retreat did not happen: Ralts is still Active, Manaphy still Benched.
    expect(player.active.getPokemonCard()?.fullName).toBe('Ralts SIT');
    expect(player.bench[0].getPokemonCard()?.fullName).toBe('Manaphy BRS');
    expect(player.retreatedTurn).not.toBe(game.state.turn);
    // DEFECT: the Retreat Cost was paid anyway ...
    expect(player.active.energies.cards.length).toBe(2 - retreatCost);
    expect(player.discard.cards.length).toBe(retreatCost);
    // ... and the Special Condition was cured anyway.
    expect(player.active.specialConditions).not.toContain(SpecialCondition.POISONED);

    // DEFECT: retreat is still available this turn; a second retreat pays again and completes.
    seen.length = 0;
    game.store.dispatch(new RetreatStartAction(player.id));
    expect(seen).toEqual(['ChooseEnergyPrompt', 'ChoosePokemonPrompt']);
    expect(player.active.getPokemonCard()?.fullName).toBe('Manaphy BRS');
    expect(player.bench[0].getPokemonCard()?.fullName).toBe('Ralts SIT');
    expect(player.discard.cards.length).toBe(2 * retreatCost);
    expect(player.retreatedTurn).toBe(game.state.turn);
  });

  it('CONTROL: completing the Bench choice (and the one-step RetreatAction) retreats once, paying the cost once', () => {
    // (a) RetreatStartAction answered with a Bench Pokémon.
    {
      const { game, player, retreatCost } = board();
      game.store.dispatch(new RetreatStartAction(player.id));
      expect(player.active.getPokemonCard()?.fullName).toBe('Manaphy BRS');
      expect(player.bench[0].getPokemonCard()?.fullName).toBe('Ralts SIT');
      expect(player.bench[0].energies.cards.length).toBe(2 - retreatCost);
      expect(player.discard.cards.length).toBe(retreatCost);
      expect(player.bench[0].specialConditions).not.toContain(SpecialCondition.POISONED);
      expect(player.retreatedTurn).toBe(game.state.turn);
      // A second retreat in the same turn is refused.
      expect(() => game.store.dispatch(new RetreatStartAction(player.id))).toThrow();
      expect(player.discard.cards.length).toBe(retreatCost);
    }
    // (b) The conformance driver's one-step RetreatAction: target fixed before any cost is paid.
    {
      const { game, player, retreatCost } = board();
      game.store.dispatch(new RetreatAction(player.id, 0));
      expect(player.active.getPokemonCard()?.fullName).toBe('Manaphy BRS');
      expect(player.bench[0].energies.cards.length).toBe(2 - retreatCost);
      expect(player.discard.cards.length).toBe(retreatCost);
      expect(player.retreatedTurn).toBe(game.state.turn);
    }
  });
});
