import { PokemonCard, Stage, CardType, StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Sableye extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = D;
  public hp: number = 80;
  public weakness = [{ type: G }];
  public retreat = [C];

  public attacks = [{
    name: 'Cocky Claw',
    cost: [D],
    damage: 20,
    damageCalculation: '+',
    // SD-11 round 2 / TA-199: "in play" should be "on your Bench" (unanimous; rotomancer matches).
    text: 'If you have any Stage 2 Darkness Pokémon on your Bench, this attack does 70 more damage.'
  }];

  public regulationMark = 'I';
  public set: string = 'PFL';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '59';
  public name: string = 'Sableye';
  public fullName: string = 'Sableye MBG';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      // TA-199: the condition is "on your Bench", not "in play" -- same vacuous widening as Ho-Oh
      // ssp-019. While Cocky Claw resolves the Active is necessarily Sableye itself, a BASIC, so no
      // board can distinguish the two readings. Narrowed to match the printed rule; no behavioural
      // change is expected or claimed.
      let hasStage2DarkOnBench = false;
      player.bench.forEach(benchSlot => {
        const pokemon = benchSlot.getPokemonCard();
        if (pokemon && pokemon.stage === Stage.STAGE_2 && pokemon.cardType === CardType.DARK) {
          hasStage2DarkOnBench = true;
        }
      });
      if (hasStage2DarkOnBench) {
        effect.damage += 70;
      }
    }
    return state;
  }
}
