import {
  PokemonCard,
  Stage,
  CardType,
  CardTag,
  SuperType,
  State,
  StoreLike,
  GameMessage,
  ChooseEnergyPrompt,
  Card,
} from '../../../game';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';
import {SWITCH_OUT_OPPONENT_ACTIVE_POKEMON,
  WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Quaquavalex extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Quaxwell';
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [W];
  public hp: number = 320;
  public weakness = [{ type: L }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Exciting Dance',
      cost: [W],
      damage: 60,
      text: "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    },
    {
      name: 'Spiral Shot',
      cost: [W, C],
      damage: 230,
      text: 'Put 2 Energy attached to this Pokémon into your hand.',
    },
  ];

  public regulationMark = 'G';
  public set: string = 'PAL';
  public setNumber: string = '52';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Quaquaval ex';
  public fullName: string = 'Quaquaval ex PAL';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Attack 1: Exciting Dance
    // TA-672 (B.101 (3)): the new Active is chosen at Step D, before the damage; after the damage the switch happens,
    // then ("If you do") the opponent switches out their Active and chooses its replacement (#1846, #1990).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect, {
        message: GameMessage.CHOOSE_POKEMON_TO_SWITCH,
        afterSwitch: () => {
          SWITCH_OUT_OPPONENT_ACTIVE_POKEMON(store, state, player, { sourceEffect: effect });
        },
      });
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      if (!player.active.cards.some((c) => c.superType === SuperType.ENERGY)) {
        return state;
      }

      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
      state = store.reduceEffect(state, checkProvidedEnergy);

      return store.prompt(
        state,
        new ChooseEnergyPrompt(
          player.id,
          GameMessage.CHOOSE_CARD_TO_HAND,
          checkProvidedEnergy.energyMap,
          [CardType.COLORLESS, CardType.COLORLESS],
          { allowCancel: false },
        ),
        (energy) => {
          const cards: Card[] = (energy || []).map((e) => e.card);
          MOVE_CARDS(store, state, player.active, player.hand, { cards: cards, sourceCard: this });
        },
      );
    }

    return state;
  }
}
