import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { DEFENDING_POKEMON_TAKES_MORE_DAMAGE_DURING_YOUR_NEXT_TURN, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Vibrava extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Trapinch';
  public cardType: CardType = F;
  public hp: number = 90;
  public weakness = [{ type: G }];
  public retreat = [C];

  // TA-92 data correction (2026-08-04). Both fields below were wrong and BOTH are contradicted by a
  // UNANIMOUS five-source authoritative record (limitless, pio⊕scrydex, pkmncards; 2 printings):
  //
  //   Screech text  was: "...takes 50 more damage from this Pokémon's attacks"   <- attacker-scoped, and
  //                      it dropped the Weakness/Resistance ordering clause entirely
  //   attack name   was: "Cutter Wind"                                            <- "Cutting Wind"
  //
  // The text error mattered twice over. It is the ONLY thing that made TA-92's "does the buff reside on
  // the attacker or on the Defending Pokémon" question look open: read as "this Pokémon's attacks" the
  // card resembles Bulk Up (#358, effect on the attacker's attacks); read as printed, the Defending
  // Pokémon is the grammatical subject that "takes" the damage, which is the Daunt shape (#401). The
  // engine was already implementing the printed card — the bonus is keyed on the attacking PLAYER
  // (attack-effect.ts), i.e. any of your attacks that turn, and it is added AFTER ApplyWeaknessEffect —
  // so this is a DATA defect, not a behavioural one. `fullName` is untouched.
  public attacks = [{
    name: 'Screech',
    cost: [C],
    damage: 0,
    text: 'During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).'
  },
  {
    name: 'Cutting Wind',
    cost: [F, C],
    damage: 50,
    text: ''
  }];

  public regulationMark = 'H';
  public set: string = 'SSP';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '105';
  public name: string = 'Vibrava';
  public fullName: string = 'Vibrava SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      DEFENDING_POKEMON_TAKES_MORE_DAMAGE_DURING_YOUR_NEXT_TURN(store, state, effect, this, 50);
    }
    return state;
  }
}
