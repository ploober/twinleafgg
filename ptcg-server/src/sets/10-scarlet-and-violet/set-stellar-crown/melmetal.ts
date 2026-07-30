import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Melmetal extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Meltan';
  public cardType: CardType = M;
  public hp: number = 160;
  public weakness = [{ type: R }];
  public resistance = [{ type: G, value: -30 }];
  public retreat = [C, C, C];

  public attacks = [{
    name: 'Wrack Down',
    cost: [C, C],
    damage: 50,
    text: ''
  },
  {
    name: 'Reforged Axe',
    cost: [M, C, C],
    damage: 250,
    text: 'Before doing damage, discard all Pokémon Tools from this Pokémon. If you can\'t discard any, this attack does nothing.'
  }];

  public set: string = 'SCR';
  public regulationMark: string = 'H';
  public setNumber: string = '104';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Melmetal';
  public fullName: string = 'Melmetal SCR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      // TA-151: *"Before doing damage, discard all Pokémon Tools from THIS POKÉMON."* This read
      // `opponent.active` and `opponent.discard`, so the gate was decided by whether the DEFENDER wore
      // a Tool and the discard landed in the wrong player's pile — the wrong-perspective family
      // (TA-121 Croconaw "Crunch", TA-147 Team Rocket's Zapdos). Measured with a Tool on the attacker:
      // 0 damage and the Tool still attached, where the card requires 250 and its own Tool discarded.
      // `player.active` is the attacker: this effect only runs under WAS_ATTACK_USED, so `effect.player`
      // is by definition the attacking player and this Melmetal is its Active.
      effect.damage = 0; // no Tool to discard ⇒ "this attack does nothing"

      // Snapshot before moving: `moveCardTo` splices the live `tools` array, so iterating it directly
      // while discarding would skip entries (the splice-while-iterating hazard). Matches the
      // established idiom in `set-lost-thunder/forretress.ts`.
      const tools = player.active.tools.slice();
      if (tools.length > 0) {
        tools.forEach(tool => player.active.moveCardTo(tool, player.discard));
        effect.damage = 250;
      }
    }
    return state;
  }
}