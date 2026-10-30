import { PokemonCard } from '../../../game/store/card/pokemon-card';
import {
  Stage,
  CardType,
  CardTag,
  EnergyType,
  SuperType,
  SpecialCondition,
} from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  AttachEnergyPrompt,
  PlayerType,
  SlotType,
  EnergyCard,
  GameMessage,
  ShuffleDeckPrompt,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AttachEnergyEffect } from '../../../game/store/effects/play-card-effects';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { AddSpecialConditionsEffect } from '../../../game/store/effects/attack-effects';
import {WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Okidogiex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_ex];
  public regulationMark = 'H';
  public cardType: CardType[] = [D];
  public weakness = [{ type: F }];
  public hp: number = 250;
  public retreat = [C, C, C];

  public attacks = [
    {
      name: 'Poisonous Musculature',
      cost: [C],
      damage: 0,
      text: 'Search your deck for up to 2 Basic [D] Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned. ',
    },
    {
      name: 'Chain-Crazed',
      cost: [D, D, C],
      damage: 130,
      damageCalculation: '+',
      text: 'If this Pokémon is Poisoned, this attack does 130 more damage.',
    },
  ];

  public set: string = 'SFA';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '36';
  public name: string = 'Okidogi ex';
  public fullName: string = 'Okidogi ex SFA';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      const attacker = player.active;
      return store.prompt(state, new AttachEnergyPrompt(
        player.id, GameMessage.ATTACH_ENERGY_CARDS, player.deck,
        PlayerType.BOTTOM_PLAYER, [SlotType.ACTIVE],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Darkness Energy' },
        { min: 0, max: 2, allowCancel: false },
      ), transfers => {
        let attached = false;
        for (const transfer of transfers || []) {
          store.reduceEffect(state, new AttachEnergyEffect(player, transfer.card as EnergyCard, attacker));
          attached = attached || attacker.cards.includes(transfer.card);
        }
        // The printed shuffle completes before the conditional Poison instruction.
        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
          if (attached) {
            const poison = new AddSpecialConditionsEffect(effect, [SpecialCondition.POISONED]);
            poison.target = attacker;
            store.reduceEffect(state, poison);
          }
        });
      });
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      if (player.active.specialConditions.includes(SpecialCondition.POISONED)) {
        const attackEffect = effect as AttackEffect;
        attackEffect.damage += 130;
      }
      return state;
    }
    return state;
  }
}
