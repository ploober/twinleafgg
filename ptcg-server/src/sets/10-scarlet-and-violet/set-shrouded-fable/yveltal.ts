import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { Card, ChooseCardsPrompt, CoinFlipPrompt, GameMessage, PlayerType, StateUtils } from '../../../game';
import { StoreLike, State } from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { DealDamageEffect, DiscardCardsEffect, PutCountersEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Yveltal extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = D;
  public hp: number = 120;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -20 }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Corrosive Winds',
      cost: [CardType.DARK],
      damage: 0,
      text: 'Put 2 damage counters on each of your opponent\'s Pokemon that has any damage counters on it.'
    },
    {
      name: 'Destructive Beam',
      cost: [CardType.DARK, CardType.DARK, CardType.COLORLESS],
      damage: 100,
      text: 'Flip a coin. If heads, discard an Energy from your opponent\'s Active Pokemon.'
    },
  ];

  public regulationMark = 'H';
  public set = 'SFA';
  public setNumber = '35';
  public cardImage = 'assets/cardback.png';
  public name = 'Yveltal';
  public fullName = 'Yveltal SFA';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Corrosive Winds
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const opponent = effect.opponent;
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card) => {
        if ((cardList.damage > 0)) {
          const putCountersEffect = new PutCountersEffect(effect, 20);
          putCountersEffect.target = cardList;
          store.reduceEffect(state, putCountersEffect);
        }
      });
    }

    // Destructive Beam
    if (WAS_ATTACK_USED(effect, 1, this)) {

      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Rulebook attack step F: damage first, then the post-damage effect flip
      // (compendium #649) — the flip pauses, so the 100 must already be placed.
      const damageEffect = new DealDamageEffect(effect, effect.damage);
      state = store.reduceEffect(state, damageEffect);
      effect.damage = 0;

      return store.prompt(state, [
        new CoinFlipPrompt(player.id, GameMessage.COIN_FLIP)
      ], result => {
        if (result === true) {

          // TA-306 / compendium #1661 (Clefable "Moonlit Miracle", TPCi Rules Team 2022-02-24):
          // "You can use the attack no matter what, but AFTER FLIPPING COINS if you have no Pokemon
          // that can evolve the attack stops there." The flip is a mandated STEP of the attack, not a
          // decision, so CF-33's zero-achievable suppression does not reach it — only the DISCARD is
          // gated on a target existing. This guard used to sit above the flip and skipped it entirely
          // on an Energy-less defender.
          if (!opponent.active.cards.some(c => c.superType === SuperType.ENERGY)) {
            return;
          }

          let card: Card;
          return store.prompt(state, new ChooseCardsPrompt(
            player,
            GameMessage.CHOOSE_CARD_TO_DISCARD,
            opponent.active,
            { superType: SuperType.ENERGY },
            { min: 1, max: 1, allowCancel: false }
          ), selected => {
            card = selected[0];
            return store.reduceEffect(state, new DiscardCardsEffect(effect, [card]));
          });
        }
      });
    }

    return state;
  }
}