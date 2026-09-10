import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  ChoosePokemonPrompt,
  GameMessage,
  PlayerType,
  SlotType,
  StateUtils,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { DAMAGE_OPPONENT_POKEMON, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class StevensSkarmory extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.STEVENS];
  public cardType: CardType[] = [M];
  public hp: number = 120;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Razor Wing',
      cost: [C, C],
      damage: 30,
      text: '',
    },
    {
      name: 'Sonic Double',
      // Printed damage is empty: all damage is dealt by the effect (50 to each of 2 chosen Pokémon
      // via DAMAGE_OPPONENT_POKEMON below). A non-zero field here would add a phantom 50 to the
      // Active on top of the effect's damage. Keep it 0.
      cost: [M, M, C],
      damage: 0,
      text: 'This attack does 50 damage to 2 of your opponent\'s Pokémon. (Don\'t apply Weakness and Resistance for Benched Pokémon.)'
    }
  ];

  public regulationMark: string = 'I';
  public set: string = 'DRI';
  public setNumber: string = '142';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Steven's Skarmory";
  public fullName: string = "Steven's Skarmory DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      // TA-390: "2 of your opponent's Pokemon" is a FIXED count, not "up to 2" — `min: 1` offered a
      // stop after the first target (halving the attack) and left the forced second pick surfaced.
      // Pin min === max === min(2, available); the adapter collapses the forced set (CF-14, TA-317 idiom).
      const opponent = StateUtils.getOpponent(state, player);
      let available = 0;
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, () => { available++; });
      const count = Math.min(2, available);

      return store.prompt(
        state,
        new ChoosePokemonPrompt(
          player.id,
          GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
          PlayerType.TOP_PLAYER,
          [SlotType.ACTIVE, SlotType.BENCH],
          { min: count, max: count, allowCancel: false },
        ),
        (selected) => {
          const targets = selected || [];
          DAMAGE_OPPONENT_POKEMON(store, state, effect, 50, targets);
        },
      );
    }
    return state;
  }
}
