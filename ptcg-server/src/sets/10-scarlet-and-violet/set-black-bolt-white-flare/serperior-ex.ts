import { PokemonCard, Stage, CardType, StoreLike, State, CardTag, PowerType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK, IS_ABILITY_BLOCKED, SEARCH_DECK_FOR_CARDS_TO_HAND } from '../../../game/store/prefabs/prefabs';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';

export class Serperiorex extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Servine';
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [G];
  public hp: number = 320;
  public weakness = [{ type: R }];
  public retreat = [C, C];

  public powers = [{
    name: 'Regal Cheer',
    powerType: PowerType.ABILITY,
    text: 'Attacks used by your Pokémon do 20 more damage to your opponent\'s Active Pokémon (before applying Weakness and Resistance).'
  }];

  public attacks = [{
    name: 'Command the Grass',
    cost: [G, C, C, C],
    damage: 150,
    text: 'You may search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.'
  }];

  public regulationMark = 'I';
  public set: string = 'BLK';
  public setNumber: string = '3';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Serperior ex';
  public fullName: string = 'Serperior ex SV11B';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Regal Cheer ability - +20 damage BEFORE Weakness and Resistance (TA-268).
    // Must hook DealDamageEffect: the pipeline is DealDamage -> ApplyWeakness -> PutDamage, so a
    // boost on PutDamageEffect lands AFTER the multiplier ((30x2)+20=80 instead of (30+20)x2=100).
    // Same phase Altaria/Iron Crown ex use for the identical "attacks do 20 more (before W&R)".
    if (effect instanceof DealDamageEffect && effect.target === effect.opponent.active) {
      const player = effect.player;

      // Check if this card is in play
      const isInPlay =
        player.bench.some((b) => b.cards.some((c) => c === this)) ||
        player.active.cards.some((c) => c === this);

      if (isInPlay && !IS_ABILITY_BLOCKED(store, state, player, this)) {
        effect.damage += 20;
      }
    }

    // Grass Order attack
    if (AFTER_ATTACK(effect, 0, this)) {
      const player = effect.player;
      SEARCH_DECK_FOR_CARDS_TO_HAND(
        store,
        state,
        player,
        this,
        {},
        { min: 0, max: 3, allowCancel: false },
        this.attacks[0],
      );
    }
    return state;
  }
}
