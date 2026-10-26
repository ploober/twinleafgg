import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { PowerType, StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED, MAY_SEARCH_YOUR_DECK, SEARCH_YOUR_DECK_TO_HAND_THEN_SHUFFLE } from '../../../game/store/prefabs/prefabs';
import { reduceHideNSneak } from './hide-n-sneak';

export class Banette extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Shuppet';
  public cardType: CardType[] = [P];
  public hp: number = 80;
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public powers = [
    {
      name: "Hide 'n' Sneak",
      powerType: PowerType.ABILITY,
      text: "Prevent all effects of your opponent's Pokémon's attacks and Abilities done to this Pokémon. (Damage is not an effect.)",
    },
  ];

  public attacks = [
    {
      name: 'Puppet Pull',
      cost: [P],
      damage: 80,
      text: 'You may search your deck for a card and put it into your hand. Then, shuffle your deck.',
    },
  ];

  public set: string = 'PBL';
  public setNumber: string = '34';
  public regulationMark: string = 'J';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Banette';
  public fullName: string = 'Banette M5';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    reduceHideNSneak(store, state, effect, this);

    // TA-784 (B.131, owner 2026-10-25; B.129): "You may search" is a confirm asked first, before the 80; declining searches,
    // looks at and shuffles nothing (this reverses TA-369's single decision, the pick with a stop). On yes the search for
    // "a card" must take one (#1980), then the shuffle.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      return MAY_SEARCH_YOUR_DECK(store, state, effect, () => SEARCH_YOUR_DECK_TO_HAND_THEN_SHUFFLE(store, state, player, 1, 1));
    }

    return state;
  }
}
