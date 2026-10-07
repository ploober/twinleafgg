import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  GameMessage,
  StateUtils,
  ChooseCardsPrompt,
  SuperType,
  PowerType,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { CheckAttackCostEffect } from '../../../game/store/effects/check-effects';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Decidueyeex extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Dartrix';
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [G];
  public hp: number = 320;
  public weakness = [{ type: R }];
  public retreat = [C, C];

  public powers = [{
    name: 'Sniper\'s Eye',
    // PASSIVE, always-on cost reduction (compendium #2311: "removes all colorless energy costs from any
    // attack that Decidueye ex can use"). It is NOT player-activated — it works via the CheckAttackCostEffect
    // hook below. `useWhenInPlay: true` wrongly made it an activatable ability: the engine accepted a no-op
    // UsePowerEffect and legal-action enumeration offered `useAbility Sniper's Eye` (rotomancer never does).
    powerType: PowerType.ABILITY,
    text: 'If your opponent has exactly 4 cards in their hand, ignore all [C] Energy in the costs of attacks used by this Pokémon.'
  }];

  public attacks = [
    {
      name: 'Crushing Arrow',
      cost: [G, C, C, C],
      damage: 240,
      text: "Discard an Energy from your opponent's Active Pokémon.",
    },
  ];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '12';
  public name: string = 'Decidueye ex';
  public fullName: string = 'Decidueye ex M3';

  public readonly SNIPER_EYE_MARKER = 'SNIPER_EYE_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Ability: Ignore [C] in attack costs if opponent has exactly 4 cards
    if (effect instanceof CheckAttackCostEffect && effect.player.active.getPokemonCard() === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (opponent.hand.cards.length === 4) {
        // Remove all [C] from the cost
        const cost = effect.cost;
        while (cost.includes(CardType.COLORLESS)) {
          const index = cost.indexOf(CardType.COLORLESS);
          cost.splice(index, 1);
        }
      }
    }

    // Crushing Arrow. TA-655 / B.89 (1), (4): the attacker chooses the opponent's Energy at Step D, before the damage (recorded as
    // `chosen`); the damage reads it still attached (#77) and it is discarded after the damage, before damage reactions
    // and the Knock Out check.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const source = opponent.active;

      if (source.energies.cards.length === 0) {
        return state;
      }

      const prompt = new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        source,
        { superType: SuperType.ENERGY },
        { min: 1, max: 1, allowCancel: false, blocked: [] },
      );
      prompt.deferredMove = true;
      return store.prompt(state, prompt, (selected) => {
        const cards = selected || [];
        if (cards.length === 0) {
          return;
        }
        effect.afterDamageMoves.push(() => {
          const still = cards.filter(c => source.cards.includes(c));
          if (still.length > 0) {
            MOVE_CARDS(store, state, source, opponent.discard, { cards: still, sourceCard: this });
          }
        });
      });
    }

    if (
      effect instanceof EndTurnEffect &&
      effect.player.marker.hasMarker(this.SNIPER_EYE_MARKER, this)
    ) {
      effect.player.marker.removeMarker(this.SNIPER_EYE_MARKER, this);
    }

    return state;
  }
}
