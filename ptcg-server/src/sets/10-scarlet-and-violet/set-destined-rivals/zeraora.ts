import { Attack, CardTag, CardTarget, CardType, ChoosePokemonPrompt, GameMessage, PlayerType, PokemonCard, PokemonCardList, SlotType, Stage, State, StateUtils, StoreLike, Weakness } from '../../../game';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';

import { DISCARD_ALL_ENERGY_FROM_POKEMON, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Zeraora extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = L;
  public hp: number = 100;
  public weakness: Weakness[] = [{ type: F }];
  public retreat: CardType[] = [C];

  public attacks: Attack[] = [{
    name: 'Scratch',
    cost: [C],
    damage: 20,
    text: ''
  }, {
    name: 'Thunder Raid',
    cost: [L, L, L],
    damage: 0,
    text: 'Discard all Energy from this Pokémon. This attack does 210 damage to 1 of your opponent\'s Benched ex Pokemon. (Don\'t apply Weakness and Resistance for Benched Pokémon.)'
  }];

  public regulationMark: string = 'I';
  public set: string = 'DRI';
  public setNumber: string = '78';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Zeraora';
  public fullName: string = 'Zeraora DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // "Discard all Energy" is FORCED (no which/how-many choice) — apply it
      // atomically, then place the 210. Both happen AFTER the Step-D target
      // choice below.
      const discardThenDamage = (target?: PokemonCardList): State => {
        DISCARD_ALL_ENERGY_FROM_POKEMON(store, state, effect, this);
        if (target !== undefined) {
          const damageEffect = new PutDamageEffect(effect, 210);
          damageEffect.target = target;
          store.reduceEffect(state, damageEffect);
        }
        return state;
      };

      // Rulebook p.19 Step D — "Make any choices the attack requires you to
      // make … For example, if an attack says 'Choose 1 of your opponent's
      // Benched Pokémon,' you would make that choice now." The bench-ex target
      // is chosen BEFORE the energy discard (a Step-E/F effect) resolves.
      const benchHasEx = opponent.bench.some(b => {
        const pokemon = b.getPokemonCard();
        return pokemon !== undefined && pokemon.tags.includes(CardTag.POKEMON_ex);
      });

      // The attack is usable with no Benched Pokemon ex to hit; there is no
      // Step-D choice, the energy is still discarded and no damage happens.
      if (!benchHasEx) {
        return discardThenDamage();
      }

      const blocked: CardTarget[] = [];
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (list, card, target) => {
        if (!card.tags.includes(CardTag.POKEMON_ex)) {
          blocked.push(target);
        }
      });
      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.BENCH],
        { min: 1, max: 1, allowCancel: false, blocked }
      ), selected => {
        const targets = selected || [];
        return discardThenDamage(targets[0]);
      });
    }
    return state;
  }
}
