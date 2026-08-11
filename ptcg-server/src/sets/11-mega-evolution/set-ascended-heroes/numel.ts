import { GamePhase, PowerType, State, StateUtils, StoreLike } from '../../../game';
import { CardType, SpecialCondition, Stage } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { AfterDamageEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';
import { IS_ABILITY_BLOCKED } from '../../../game/store/prefabs/prefabs';

export class Numel extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = R;
  public hp: number = 80;
  public weakness = [{ type: W }];
  public resistance = [];
  public retreat = [C, C, C];

  public powers = [{
    name: 'Incandescent Body',
    powerType: PowerType.ABILITY,
    text: 'If this Pokémon is in the Active Spot and is damaged by an attack from your opponent\'s Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Burned.',
  }];

  public attacks = [{
    name: 'Combustion',
    cost: [R, C],
    damage: 20,
    text: ''
  }];

  public regulationMark = 'I';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '27';
  public name: string = 'Numel';
  public fullName: string = 'Numel M2a';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // TA-238 / SD-18: the guard must be TOP-OF-STACK, not stack membership. `cards.includes(this)`
    // is true for evolution MATERIAL too, so this passive kept firing from UNDER Mega Camerupt —
    // an evolved-away Pokémon has no Abilities, and the attacker was Burned by a card not in play
    // as a Pokémon. `getPokemonCard()` is the current top; only then is Incandescent Body live.
    if (effect instanceof AfterDamageEffect && effect.target.getPokemonCard() === this) {
      const player = effect.player;
      const targetPlayer = StateUtils.findOwner(state, effect.target);

      if (effect.damage <= 0 || player === targetPlayer || targetPlayer.active !== effect.target) {
        return state;
      }

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      if (state.phase === GamePhase.ATTACK) {
        effect.source.addSpecialCondition(SpecialCondition.BURNED);
      }
    }

    return state;
  }
}
