import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { SuperType } from '../../../game/store/card/card-types';
import { APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS, MOVE_CARDS, SHUFFLE_DECK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';
import { DISCARD_X_ENERGY_FROM_THIS_POKEMON } from '../../../game/store/prefabs/costs';

export class Kyogre extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [W];
  public hp: number = 150;
  public weakness = [{ type: L }];
  public retreat = [C, C, C];

  public attacks = [{
    name: 'Riptide',
    cost: [W],
    damage: 20,
    damageCalculation: 'x',
    text: 'This attack does 20 damage for each [W] Energy card in your discard pile. Then, shuffle those cards into your deck.'
  },
  {
    name: 'Swirling Waves',
    cost: [W, W, C],
    damage: 130,
    text: 'Discard 2 Energy from this Pokémon.'
  }];

  public set: string = 'MEG';
  public name: string = 'Kyogre';
  public fullName: string = 'Kyogre M1S';
  public setNumber: string = '34';
  public regulationMark: string = 'I';
  public cardImage: string = 'assets/cardback.png';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Surging Flames
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      // counting the energies
      const energiesInDiscard = player.discard.cards.filter(c => c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC && c.name === 'Water Energy');
      // "20 damage for each [W] Energy card in your discard pile" — compute the damage BEFORE the
      // empty-discard early-return, otherwise an empty discard leaves the printed base 20 in effect
      // and wrongly deals 20 instead of 0. [TA-22]
      effect.damage = 20 * energiesInDiscard.length;
      if (energiesInDiscard.length === 0) {
        return state;
      }

      // TA-402 (TA-258 family, rulebook Step F / #649): the 20x lands BEFORE the "Then, shuffle
      // those cards into your deck" rider pends — at the shuffle pause the defender already reads
      // the damage on rotomancer; twinleaf deferred it past the shuffle.
      state = APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS(store, state, effect);

      // slapping those energies back into the deck
      MOVE_CARDS(store, state, player.discard, player.deck, { cards: energiesInDiscard, sourceCard: this, sourceEffect: this.attacks[0] });
      SHUFFLE_DECK(store, state, player);
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      // Rulebook attack step F / compendium #649: the 130 is placed before the
      // post-damage discard effect pauses on its energy choice.
      const damageEffect = new DealDamageEffect(effect, effect.damage);
      state = store.reduceEffect(state, damageEffect);
      effect.damage = 0;
      DISCARD_X_ENERGY_FROM_THIS_POKEMON(store, state, effect, 2);
    }

    return state;
  }
}