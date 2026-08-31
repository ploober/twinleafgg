import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike, State, GameMessage, StateUtils, Card, ChooseCardsPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { AFTER_ATTACK, CONFIRMATION_PROMPT, THIS_POKEMON_CANNOT_ATTACK_NEXT_TURN, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Unfezant extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Tranquill';
  public cardType: CardType[] = [C];
  public hp: number = 150;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [];
  public attacks = [{
    name: 'Opposing Winds',
    cost: [C, C],
    damage: 70,
    text: 'You may put 2 Energy attached to your opponent\'s Active Pokémon into their hand.'
  },
  {
    name: 'Boundless Power',
    cost: [C, C, C],
    damage: 180,
    text: 'During your next turn, this Pokémon can\'t attack.'
  }];

  public regulationMark: string = 'H';
  public set: string = 'TEF';
  public setNumber = '135';
  public cardImage = 'assets/cardback.png';
  public name: string = 'Unfezant';
  public fullName: string = 'Unfezant TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Opposing Winds
    if (AFTER_ATTACK(effect, 0, this)) {
      // TA-307 / TA-128 family A. Rulebook attack step F, compendium #543 ("Do damage first,
      // then apply effects") and #649 ("Like all attacks that don't explicitly say otherwise, the
      // effects of attacks are not applied until after damage is done", TPCi Rules Team 2015-05-07):
      // this rider PAUSES, so the base damage must already be on the board when it does. Written on
      // WAS_ATTACK_USED the rider ran inside the pre-damage block and the game paused showing the
      // defender at dmg=0 -- a mid-resolution divergence the end board never shows, which is why
      // nothing downstream reported it. AFTER_ATTACK is dispatched by the attack pipeline AFTER
      // DealDamage and BEFORE the KO sweep (game-effect.ts), which is exactly step F's order --
      // so this does not trade TA-79 (damage deferred) for TA-123 (rider dropped past the KO).
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // CF-32 second class (PINNED 2026-07-28), the count-2 arm. *"Put 2 Energy"* has no inherent zero,
      // so under the pin the decline is a standalone `confirm{true,false}` and NOT a min:0 option pick
      // with the decline inlined — rotomancer's shape is the target and twinleaf migrates. Twinleaf was
      // emitting a flat `CHOOSE_CARD_TO_DISCARD` over every attached Energy with a `confirm{false}`
      // mixed in among the objects.
      //
      // ⚠️ The pin does not say what happens at exactly ONE attached Energy — *"put 2"* cannot be
      // honoured — and that question was PARKED rather than guessed, then answered by DRIVING
      // rotomancer: at 1 Energy it still offers the gate, and on `confirm:true` it takes the single
      // Energy and moves on. So the count is min(2, available), not a suppression. Measured on
      // `:8099` sim 2.36.0, 2026-08-26.
      const available = opponent.active.cards.filter(c => c.superType === SuperType.ENERGY).length;
      if (available === 0) {
        // CF-33: a `may` that can achieve nothing presents no decision. The opponent's Active's
        // attached Energy is public, so suppressing on it leaks nothing (CF-33 Boundary 1). This is
        // also what `re70-tef-135-opposing-winds-zero-achievable-may-gate` asserts, and it is now
        // load-bearing rather than incidental: with the gate externalised the inner pick is min>=1.
        return state;
      }

      CONFIRMATION_PROMPT(store, state, player, result => {
        if (result) {
          let cards: Card[] = [];
          return store.prompt(state, new ChooseCardsPrompt(
            player,
            GameMessage.CHOOSE_CARD_TO_DISCARD,
            opponent.active,
            { superType: SuperType.ENERGY },
            { min: Math.min(2, available), max: 2, allowCancel: false },
          ), selected => {
            cards = selected || [];
            opponent.active.moveCardsTo(cards, opponent.hand);
          });
        }
      });
    }

    // Boundless Power
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      // Legacy implementation:
      // - Set player.active.cannotAttackNextTurnPending = true directly.
      //
      // Converted to prefab version (THIS_POKEMON_CANNOT_ATTACK_NEXT_TURN).
      THIS_POKEMON_CANNOT_ATTACK_NEXT_TURN(player);
    }

    return state;
  }
}
