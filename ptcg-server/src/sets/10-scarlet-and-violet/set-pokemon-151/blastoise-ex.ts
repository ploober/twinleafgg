import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, SuperType, EnergyType } from '../../../game/store/card/card-types';
import { EnergyCard } from '../../../game/store/card/energy-card';
import {
  StoreLike,
  State,
  ChooseCardsPrompt,
  PowerType,
  GamePhase,
  StateUtils,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { GameMessage } from '../../../game/game-message';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import {IS_ABILITY_BLOCKED, WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Blastoiseex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex];
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Wartortle';
  public cardType: CardType[] = [W];
  public hp: number = 330;
  public weakness = [{ type: L }];
  public retreat = [C, C, C];

  public powers = [
    {
      name: 'Solid Shell',
      powerType: PowerType.ABILITY,
      text: 'This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).',
    },
  ];

  public attacks = [
    {
      name: 'Twin Cannons',
      cost: [W, W],
      damage: 140,
      damageCalculation: 'x',
      text: 'Discard up to 2 Basic [W] Energy cards from your hand. This attack does 140 damage for each card you discarded in this way.',
    },
  ];

  public regulationMark = 'G';
  public set: string = 'MEW';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '9';
  public name: string = 'Blastoise ex';
  public fullName: string = 'Blastoise ex MEW';

  // Implement power
  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      // TA-496: "Discard up to 2 Basic [W] Energy cards from your hand. This attack does 140 damage for each card you
      // discarded in this way." The pick took ANY Energy card, min 1 (with a cancel that kept the printed 140), and the
      // attack was withheld with no Energy in hand. An attack's "up to 2" is 0..2 (#2301) and the attack is always
      // usable; the damage is 140 x the cards discarded, so 0 discarded is 0 damage.
      const filter = { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Water Energy' };
      const water = player.hand.cards.filter(c => c.superType === SuperType.ENERGY
        && (c as EnergyCard).energyType === EnergyType.BASIC && c.name === 'Water Energy');
      effect.damage = 0;
      if (water.length === 0) {
        return state;
      }
      state = store.prompt(
        state,
        new ChooseCardsPrompt(
          player,
          GameMessage.CHOOSE_CARD_TO_DISCARD,
          player.hand,
          filter,
          { allowCancel: false, min: 0, max: 2 },
        ),
        (cards) => {
          cards = cards || [];
          effect.damage = cards.length * 140;
          if (cards.length > 0) {
            MOVE_CARDS(store, state, player.hand, player.discard, { cards: cards, sourceCard: this });
          }
          return state;
        },
      );
    }

    // Reduce damage by 30
    if (effect instanceof PutDamageEffect && effect.target.cards.includes(this)) {
      const pokemonCard = effect.target.getPokemonCard();

      // It's not this pokemon card
      if (pokemonCard !== this) {
        return state;
      }

      // It's not an attack
      if (state.phase !== GamePhase.ATTACK) {
        return state;
      }

      const player = StateUtils.findOwner(state, effect.target);

      // Try to reduce PowerEffect, to check if something is blocking our ability
      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      effect.damage = Math.max(0, effect.damage - 30);
    }

    return state;
  }
}
