import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { State } from '../../../game/store/state/state';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { StoreLike } from '../../../game/store/store-like';
import { Effect } from '../../../game/store/effects/effect';
import { PowerType, PlayerType, pokemonHasCardType } from '../../../game';
import { IS_ABILITY_BLOCKED } from '../../../game/store/prefabs/prefabs';

export class Seviper extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [D];
  public hp: number = 120;
  public weakness = [{ type: F }];
  public resistance = [];
  public retreat = [C];

  public powers = [{
    name: 'Excited Power',
    powerType: PowerType.ABILITY,
    // SD-11 round 2 / TA-197: this text had dropped "Mega Evolution" from the condition (and the
    // W/R-ordering parenthetical). Restored from the UNANIMOUS authoritative record; rotomancer matches.
    text: 'If you have any Darkness Mega Evolution Pokémon ex in play, attacks used by this Pokémon do 120 more damage to your opponent\'s Active Pokémon (before applying Weakness and Resistance).'
  }];

  public attacks = [{
    name: 'Pitch-Black Fangs',
    cost: [D, D, D],
    damage: 120,
    text: '',
  }];

  public regulationMark = 'I';
  public set: string = 'PFL';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '62';
  public name: string = 'Seviper';
  public fullName: string = 'Seviper M2';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof AttackEffect && effect.source.cards.includes(this)) {
      const player = effect.player;

      // Try to reduce PowerEffect, to check if something is blocking our ability
      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      // TA-197: the condition is "any Darkness MEGA EVOLUTION Pokémon ex in play" -- the
      // "Mega Evolution" qualifier was absent from both our printed text and this test, so ANY
      // Darkness Pokémon ex granted the +120. Measured live: with Okidogi ex sfa-036 (a Darkness
      // Pokémon ex that is NOT a Mega Evolution) on the Bench, Pitch-Black Fangs did 240 on twinleaf
      // against rotomancer's correct 120. The control (Mega Absol ex meg-086 benched) converged at
      // 240 on both engines before and after this fix, which is what shows the CONDITION narrowed
      // rather than the ability being disabled.
      let hasDarkMegaPokemonEx = false;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
        if (card && card instanceof PokemonCard &&
          pokemonHasCardType(card, CardType.DARK) &&
          card.hasTag(CardTag.POKEMON_ex) &&
          card.hasTag(CardTag.POKEMON_SV_MEGA)) {
          hasDarkMegaPokemonEx = true;
        }
      });

      // Add 120 more damage if condition is met
      if (hasDarkMegaPokemonEx && effect.damage > 0) {
        effect.damage += 120;
      }
    }

    return state;
  }
}
