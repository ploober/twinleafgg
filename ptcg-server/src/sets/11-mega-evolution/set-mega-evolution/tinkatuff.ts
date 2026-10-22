import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, Stage, SuperType } from '../../../game/store/card/card-types';
import { GameMessage, PowerType, State, StateUtils, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { CAN_APPLY_ABILITY_TO_TARGET } from '../../../game/store/prefabs/effect-of-ability-prefabs';
import { ABILITY_USED, COIN_FLIP_PROMPT, IS_ABILITY_BLOCKED, JUST_EVOLVED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { ConfirmPrompt } from '../../../game';

export class Tinkatuff extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Tinkatink';
  public hp: number = 90;
  public cardType: CardType[] = [M];
  public weakness = [{ type: R }];
  public resistance = [{ type: G, value: -30 }];
  public retreat = [C, C];

  public powers = [{
    name: 'Haphazard Hammer',
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Flip a coin. If heads, discard an Energy from your opponent\'s Active Pokémon.',
  }];

  public attacks = [{
    name: 'Light Punch',
    cost: [M],
    damage: 30,
    text: ''
  }];

  public regulationMark = 'I';

  public set: string = 'MEG';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '97';
  public name: string = 'Tinkatuff';
  public fullName: string = 'Tinkatuff MEG';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Haphazard Hammer
    if (JUST_EVOLVED(effect, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      if (!opponent.active.energies.cards.some(card => card.superType === SuperType.ENERGY)) {
        return state;
      }

      // TA-420: the printed "you may use this Ability" is a DECISION, and it comes before the flip (a flip is not a
      // decision). The Ability is used at the accepted "may", whatever the coin says (TA-455 / CF-77).
      return store.prompt(state, new ConfirmPrompt(player.id, GameMessage.WANT_TO_USE_ABILITY), wantToUse => {
        if (!wantToUse) {
          return state;
        }
        ABILITY_USED(player, this);
        return COIN_FLIP_PROMPT(store, state, player, (result) => {
        if (!result) {
          return state;
        }

        if (!CAN_APPLY_ABILITY_TO_TARGET(
          store,
          state,
          player,
          this.powers[0],
          this,
          opponent.active,
        )) {
          return state;
        }

        store.prompt(state, new ChooseCardsPrompt(
          player,
          GameMessage.CHOOSE_CARD_TO_DISCARD,
          opponent.active,
          { superType: SuperType.ENERGY },
          { min: 1, max: 1, allowCancel: false },
        ), selected => {
          if (selected && selected.length > 0) {
            MOVE_CARDS(store, state, opponent.active, opponent.discard, {
              cards: selected,
              sourceCard: this,
              sourceEffect: this.powers[0],
            });
          }
        });

        return state;
      });
      });
    }

    return state;
  }
}
