import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, ChoosePokemonPrompt, GameMessage, SlotType, PlayerType } from '../../../game';
import { DISCARD_ALL_ENERGY_FROM_POKEMON, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { Effect } from '../../../game/store/effects/effect';
import { PutCountersEffect } from '../../../game/store/effects/attack-effects';

export class Spectrier extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [P];
  public hp: number = 120;
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [{
    name: 'Spooky Shot',
    cost: [P],
    damage: 30,
    text: ''
  },
  {
    name: 'Phantasmal Barrage',
    cost: [P, P, C],
    damage: 0,
    text: 'Discard all Energy from this Pokémon and place 12 damage counters on 1 of your opponent\'s Pokémon.'
  }];

  public set: string = 'ASC';
  public name: string = 'Spectrier';
  public fullName: string = 'Spectrier ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '98';
  public regulationMark = 'I';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // TA-673 (B.89 (5), B.98): the attack does no damage, but its Step-D choice still comes first: the counters' target
    // is picked with the Energy still attached; then, in printed order, the Energy is discarded and the counters placed.
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { operation: 'placeCounters', amount: 12, allowCancel: false }
      ), targets => {
        if (!targets || targets.length === 0) {
          return;
        }
        const target = targets[0];
        effect.afterDamageMoves.push(() => {
          DISCARD_ALL_ENERGY_FROM_POKEMON(store, state, effect, this);
          const damageEffect = new PutCountersEffect(effect, 120);
          damageEffect.target = target;
          store.reduceEffect(state, damageEffect);
        });
      });
    }

    return state;
  }

}