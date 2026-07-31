import { CardTag, CardType, Stage, SuperType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { Card, CardList, ChooseCardsPrompt, GameError, GameMessage, PokemonCard, ShuffleDeckPrompt, StateUtils } from '../../../game';
import { ApplyWeaknessEffect, AfterDamageEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';

import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Tatsugiriex extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];

  public regulationMark = 'H';

  public cardType: CardType = N;

  public hp: number = 160;

  public weakness = [];

  public resistance = [];

  public retreat = [C];

  public attacks = [
    {
      name: 'Surprise Pump',
      cost: [R, W],
      damage: 100,
      shredAttack: true,
      text: 'This attack\'s damage isn\'t affected by any effects on your opponent\'s Active Pokémon.'
    },
    {
      name: 'Cinnabar Lure',
      cost: [R, W, D],
      damage: 0,
      text: 'Look at the top 10 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.'
    }
  ];

  public set: string = 'SSP';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '142';

  public name: string = 'Tatsugiri ex';

  public fullName: string = 'Tatsugiri ex SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const applyWeakness = new ApplyWeaknessEffect(effect, 100);
      store.reduceEffect(state, applyWeakness);
      const damage = applyWeakness.damage;

      effect.damage = 0;

      if (damage > 0) {
        opponent.active.damage += damage;
        const afterDamage = new AfterDamageEffect(effect, damage);
        state = store.reduceEffect(state, afterDamage);
      }
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {

      const player = effect.player;

      // TA-131: declarable with an empty deck (rulebook p.20) — the top-of-deck look simply whiffs.
      // TA-166 / CF-9 put-back boundary: the trailing shuffle does NOT fire when nothing goes back
      // into the deck. #2377 (April 2026 rulebook update, with #1022 and #1968 reversed the same
      // day): "you do not shuffle since you are not putting any cards back into the deck." CF-9's
      // unconditional shuffle is about a deck SEARCH (#2171) and does not reach a put-back — we had
      // generalised across that boundary and asked rotomancer to match us, which was wrong in both
      // directions. Note this covers TWO ways of reaching "nothing to put back": an empty deck, and
      // the player benching every Pokemon they looked at (#2377's own board).
      // Check if bench has open slots
      const openSlots = player.bench.filter(b => b.cards.length === 0);

      if (openSlots.length === 0) {
        // No open slots, throw error
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      // Set maxPokemons to number of open slots
      const maxPokemons = openSlots.length;

      const deckTop = new CardList();
      player.deck.moveTo(deckTop, 10);

      let cards: Card[] = [];
      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_PUT_ONTO_BENCH,
        deckTop,
        { superType: SuperType.POKEMON },
        { min: 0, max: maxPokemons, allowCancel: false }
      ), selectedCards => {
        cards = selectedCards || [];

        cards.forEach((card, index) => {
          deckTop.moveCardTo(card, openSlots[index]);
          openSlots[index].pokemonPlayedTurn = state.turn;
        });
        const putBack = deckTop.cards.length;
        deckTop.moveTo(player.deck);
        if (putBack === 0) {
          return state;   // nothing returned to the deck → no shuffle (TA-166, #2377)
        }

        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      });
    }

    if (effect instanceof PutDamageEffect && effect.target.cards.includes(this) && effect.target.getPokemonCard() === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Target is not Active
      if (effect.target === player.active || effect.target === opponent.active) {
        return state;
      }

      effect.preventDefault = true;
    }
    return state;
  }
}
