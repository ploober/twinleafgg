import { CardTag, CardType, Stage } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import {
  Card,
  EnergyCard,
  ChooseEnergyPrompt,
  ChoosePokemonPrompt,
  ConfirmPrompt,
  GameMessage,
  PlayerType,
  PokemonCard,
  ShuffleDeckPrompt,
  SlotType,
  StateUtils,
} from '../../../game';

import { DealDamageEffect } from '../../../game/store/effects/attack-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import {WAS_ATTACK_USED, TERA_RULE, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { BLOCK_RETREAT } from '../../../game/store/prefabs/effect-of-attack-prefabs';

export class WellspringMaskOgerponex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public cardType: CardType[] = [W];
  public weakness = [{ type: L }];
  public hp: number = 210;
  public retreat = [C];

  public attacks = [{
    name: 'Sob',
    cost: [C],
    damage: 20,
    text: 'During your opponent\'s next turn, the Defending Pokémon can\'t retreat.'
  },
  {
    name: 'Torrential Pump',
    cost: [W, C, C],
    damage: 100,
    text: 'You may shuffle 3 Energy attached to this Pokémon into your Deck. If you do, this attack also does 120 damage to 1 of your opponent\'s Benched Pokémon. (Don\'t apply Weakness and Resistance for Benched Pokémon.)'
  }];

  public regulationMark = 'H';
  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '64';
  public name: string = 'Wellspring Mask Ogerpon ex';
  public fullName: string = 'Wellspring Mask Ogerpon ex TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Sob
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return BLOCK_RETREAT(store, state, effect, this);
    }
    // Torrential Pump
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // B.82 (#2031: "You shuffle the two energy that are attached back into the deck, and do 80 to the active and
      // 100 to the bench (remember, damage is still reduced for the DTE since the detachment happens after damage is
      // done)"): the choices come first, the 100 (the attack's damage step) and the 120 are dealt with the chosen
      // Energy attached, then they are shuffled in. Reverses TA-55's 100-first order (B.76 reading, withdrawn).

      const hasBench = opponent.bench.some(b => b.cards.length > 0);
      // TA-586 / B.77: the "may" is offered whenever Energy can be shuffled — "if you do" gates the Bench damage on
      // the shuffle, never the shuffle on a Bench target.
      if (!player.active.cards.some(c => c instanceof EnergyCard)) {
        return state;
      }

      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
      state = store.reduceEffect(state, checkProvidedEnergy);

      state = store.prompt(state, new ConfirmPrompt(
        effect.player.id,
        GameMessage.WANT_TO_USE_ABILITY,
      ), wantToUse => {
        if (!wantToUse) {
          return state;
        }

        state = store.prompt(state, new ChooseEnergyPrompt(
          player.id,
          GameMessage.CHOOSE_ENERGIES_TO_DECK,
          checkProvidedEnergy.energyMap,
          [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS],
          { allowCancel: false }
        ), energy => {
          const cards: Card[] = (energy || []).map(e => e.card);

          // The chosen Energy goes into the deck AFTER the damage (compendium #2031: "damage is still reduced for the
          // DTE since the detachment happens after damage is done"), then the deck is shuffled.
          const shuffleIn = (): State => {
            effect.afterDamageMoves.push(() => {
              MOVE_CARDS(store, state, player.active, player.deck, { cards: cards, sourceCard: this });
              store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
                player.deck.applyOrder(order);
              });
            });
            return state;
          };

          if (!hasBench) {
            return shuffleIn();
          }

          // TA-566: the 120 is attack damage done while the Energy is attached (a DealDamageEffect: the attacker's
          // modifiers such as Double Turbo Energy apply; a Benched target takes no Weakness or Resistance, TA-600).
          return store.prompt(state, new ChoosePokemonPrompt(
            player.id,
            GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
            PlayerType.TOP_PLAYER,
            [SlotType.BENCH],
            { min: 1, max: 1, allowCancel: false }
          ), selected => {
            const target = selected?.[0];
            if (target) {
              const benchDamage = new DealDamageEffect(effect, 120);
              benchDamage.target = target;
              store.reduceEffect(state, benchDamage);
            }
            return shuffleIn();
          });
        });

        return state;
      });

      return state;
    }

    TERA_RULE(effect, state, this);

    return state;
  }
}
