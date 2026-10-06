import { AttachEnergyPrompt, GameMessage, PlayerType, SlotType, State, StateUtils, StoreLike } from '../../../game';
import { CardType, EnergyType, Stage, SuperType } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Gorebyss extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Clamperl';
  public cardType: CardType[] = [W];
  public hp: number = 90;
  public weakness = [{ type: L }];
  public retreat = [C];

  public attacks = [{
    name: 'Crescendo Wave',
    cost: [W],
    damage: 30,
    damageCalculation: 'x',
    text: 'This attack does 30 damage for each [W] Energy attached to this Pokémon. Before doing damage, you may attach as many Basic [W] Energy cards as you like from your hand to this Pokémon.'
  }];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '56';
  public name: string = 'Gorebyss';
  public fullName: string = 'Gorebyss DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-602 / TA-520: "30 damage for each [W] Energy attached" counts every Energy PROVIDING [W] (Legacy / Luminous
      // Energy provide every type while attached, #443), and it is counted AFTER the optional attach, which happens
      // "Before doing damage" -- the count used to run as soon as the confirm was raised, before any answer.
      const setDamage = () => {
        const provided = new CheckProvidedEnergyEffect(player, player.active);
        store.reduceEffect(state, provided);
        let water = 0;
        provided.energyMap.forEach(em => {
          water += em.provides.filter(t => t === CardType.WATER || t === CardType.ANY).length;
        });
        effect.damage = water * 30;
      };

      const energiesInHand = player.hand.cards.filter(c => c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC && c.name === 'Water Energy');

      if (energiesInHand.length === 0) {
        setDamage();
        return state;
      }

      // TA-520: the any-number attach (min 0) is itself the "you may" -- no separate confirm before it.
      return store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_ACTIVE,
        player.hand,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Water Energy' },
        { allowCancel: false, min: 0 }
      ), transfers => {
        for (const transfer of transfers || []) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          MOVE_CARDS(store, state, player.hand, target, { cards: [transfer.card], sourceCard: this });
        }
        setDamage();
      });
    }

    return state;
  }
}