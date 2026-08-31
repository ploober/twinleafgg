import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { State } from '../../../game/store/state/state';

import { StoreLike } from '../../../game/store/store-like';
import { Effect } from '../../../game/store/effects/effect';
import { PlayerType, StateUtils } from '../../../game';
import { DISCARD_X_ENERGY_FROM_THIS_POKEMON } from '../../../game/store/prefabs/costs';
import { WAS_ATTACK_USED, APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS } from '../../../game/store/prefabs/prefabs';

export class SlitherWing extends PokemonCard {
  public regulationMark = 'H';

  protected _tags = [CardTag.ANCIENT];

  public stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.FIGHTING];

  public hp = 140;

  public weakness = [{ type: CardType.PSYCHIC }];

  public retreat = [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    {
      name: 'Iron Smasher',
      cost: [CardType.FIGHTING, CardType.COLORLESS],
      damage: 20,
      damageCalculation: '+',
      text: 'If your opponent has a Future Pokémon in play, this attack does 120 more damage.',
    },
    {
      name: 'Smashing Wing',
      cost: [CardType.FIGHTING, CardType.FIGHTING, CardType.COLORLESS],
      damage: 130,
      text: 'Discard 2 Energy from this Pokémon.',
    },
  ];

  public set: string = 'SFA';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '26';

  public name: string = 'Slither Wing';

  public fullName: string = 'Slither Wing SFA';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      let opponentFuturePokemon = 0;
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card, target) => {
        if (card.hasTag(CardTag.FUTURE)) {
          opponentFuturePokemon++;
        }
      });
      if (opponentFuturePokemon >= 1) {
        effect.damage += 120;
      }
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      // TA-79: apply the 130 base damage before the discard rider (rulebook step F / #543/#649).
      state = APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS(store, state, effect);
      DISCARD_X_ENERGY_FROM_THIS_POKEMON(store, state, effect, 2);
    }
    return state;
  }
}
