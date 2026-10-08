import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { CardTarget, PlayerType, SlotType, State, StoreLike } from '../../../game';
import { CheckPokemonTypeEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Vikavolt extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = 'Charjabug';
  public hp: number = 160;
  public cardType: CardType[] = [L];
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [{
    name: 'Volt Switch',
    cost: [L],
    damage: 90,
    text: 'Switch this Pokémon with 1 of your Benched [L] Pokémon.'
  },
  {
    name: 'Sparking Strike',
    cost: [L, L, C, C],
    damage: 240,
    text: ''
  }];

  public regulationMark = 'H';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '66';
  public name: string = 'Vikavolt';
  public fullName: string = 'Vikavolt ASC';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Volt Switch — TA-418: the text has no "may", so no confirm is offered. With no Benched
    // Lightning Pokémon the switch whiffs silently (an offer that can do nothing is not surfaced,
    // §B.27); with candidates the pick is mandatory — restricted to Lightning (the old prompt let
    // ANY benched Pokémon in), and a lone candidate collapses under CF-14. Idiom: Heliolisk TEU.
    // TA-672 (B.101 (3)): the new Active is chosen at Step D, before the damage; the switch is after it (#352).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      const blocked: CardTarget[] = [];
      player.bench.forEach((bench, index) => {
        if (bench.cards.length === 0) {
          blocked.push({ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index });
          return;
        }
        const checkType = new CheckPokemonTypeEffect(bench);
        store.reduceEffect(state, checkType);
        if (!checkType.cardTypes.includes(CardType.LIGHTNING)) {
          blocked.push({ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index });
        }
      });

      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect, { blocked });
    }
    return state;
  }
}
