import { PokemonCard, Stage, CardType, State, StoreLike, StateUtils, ChoosePokemonPrompt, GameMessage, PlayerType, SlotType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { DISCARD_X_ENERGY_FROM_THIS_POKEMON } from '../../../game/store/prefabs/costs';
import { WAS_ATTACK_USED, APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS } from '../../../game/store/prefabs/prefabs';

export class Blaziken extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Combusken';
  public cardType: CardType[] = [R];
  public hp: number = 170;
  public weakness = [{ type: W }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Heat Blast',
      cost: [C, C],
      damage: 70,
      text: ''
    },
    {
      name: 'Inferno Kick Flurry',
      cost: [R, R, C],
      damage: 120,
      text: 'Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent\'s Benched Pokémon. (Don\'t apply Weakness and Resistance for Benched Pokémon.)'
    },
  ];

  public set: string = 'DRI';
  public regulationMark = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '42';
  public name: string = 'Blaziken';
  public fullName: string = 'Blaziken DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const benchTargets = opponent.bench.filter(b => b.cards.length > 0);

      // TA-79: the 120 base damage lands on the Active before the discard rider (rulebook step F /
      // #543/#649); the Bench 120 is a literal, independent of effect.damage.
      const applyDamageAndDiscard = (s: State, benchTarget?: typeof opponent.bench[number]): State => {
        s = APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS(store, s, effect);
        if (benchTarget) {
          const bench = new PutDamageEffect(effect, 120);
          bench.target = benchTarget;
          s = store.reduceEffect(s, bench);
        }
        DISCARD_X_ENERGY_FROM_THIS_POKEMON(store, s, effect, 2);
        return s;
      };

      if (benchTargets.length === 0) {
        return applyDamageAndDiscard(state);
      }

      // TA-434: the Bench target is a Step-D choice — "you would make that choice now" — so it is pended
      // FIRST, before any damage or the discard. At that pending the Active is still at 0 (rotomancer's
      // shape); the base damage and discard follow once the target is chosen.
      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.BENCH],
        { min: 1, max: 1, allowCancel: false }
      ), selected => {
        if (selected && selected.length > 0) {
          applyDamageAndDiscard(state, selected[0]);
        }
      });
    }

    return state;
  }
}
