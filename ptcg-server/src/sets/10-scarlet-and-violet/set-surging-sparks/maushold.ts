import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import {
  MULTIPLE_COIN_FLIPS_PROMPT,
  SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_ONTO_BENCH,
  WAS_ATTACK_USED,
} from '../../../game/store/prefabs/prefabs';

export class Maushold extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Tandemaus';
  public cardType: CardType = C;
  public hp: number = 80;
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [{
    name: 'Familial March',
    cost: [C],
    damage: 0,
    text: 'Search your deck for up to 2 in any combination of Maushold and Maushold ex and put them onto your Bench. Then, shuffle your deck.'
  },
  {
    name: 'Incessant Incisors',
    cost: [C],
    damage: 30,
    damageCalculation: 'x',
    text: 'Flip 4 coins. This attack does 30 damage for each heads.'
  }];

  public regulationMark = 'H';
  public set: string = 'SSP';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '158';
  public name: string = 'Maushold';
  public fullName: string = 'Maushold SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Familial March
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-237: SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_ONTO_BENCH opens with BLOCK_IF_DECK_EMPTY /
      // BLOCK_IF_NO_SLOTS — the right gates for an ABILITY (#13), but this is an ATTACK, and an
      // attack is gated by its COST, not its effect's feasibility (#622/#389 "do as much as you
      // can"; #2301 splits "up to X" 0..max on attacks). The throw made the attack-probe reject the
      // whole declaration, so twinleaf never offered the attack on an empty deck. Guard the call
      // instead: the attack declares fine and simply does nothing it cannot do.
      const hasBenchSpace = player.bench.some(b => b.cards.length === 0);
      if (player.deck.cards.length === 0 || !hasBenchSpace) {
        return state;
      }

      const blocked: number[] = [];
      player.deck.cards.forEach((card, index) => {
        if (card instanceof PokemonCard && (card.name === 'Maushold' || card.name === 'Maushold ex')) {
          return;
        }
        blocked.push(index);
      });
      SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_ONTO_BENCH(store, state, player, {}, { min: 0, max: 2, blocked });
    }

    // Incessant Incisors
    if (WAS_ATTACK_USED(effect, 1, this)) {
      MULTIPLE_COIN_FLIPS_PROMPT(store, state, effect.player, 4, results => {
        const heads = results.filter(r => r).length;
        effect.damage = 30 * heads;
      });
    }

    return state;
  }
}
