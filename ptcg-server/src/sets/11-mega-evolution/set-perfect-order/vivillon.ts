import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, GameError, GameMessage, StateUtils, PowerType, ShuffleDeckPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { ABILITY_USED, DRAW_CARDS, WAS_ATTACK_USED, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class Vivillon extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Spewpa';
  public cardType: CardType[] = [G];
  public hp: number = 120;
  public weakness = [{ type: R }];
  public retreat = [C];

  public powers = [{
    name: 'Grand Wing',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, you may use this Ability. Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 4 cards.'
  }];

  public attacks = [{
    name: 'Blow Through',
    cost: [G],
    damage: 60,
    damageCalculation: '+',
    text: 'If there is a Stadium in play, this attack does 60 more damage.'
  }];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '9';
  public name: string = 'Vivillon';
  public fullName: string = 'Vivillon M3';

  public readonly BIG_WINGS_MARKER = 'BIG_WINGS_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (player.marker.hasMarker(this.BIG_WINGS_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      // #2306 rules this exact ability: an empty opponent hand is a provable no-op — withhold.
      // TA-338 / B.41 addendum 2026-08-31 (the CYCLE cell): with the opponent's deck EMPTY and
      // hand ≤ 4, the bottomed cards are drawn straight back, so the whole effect provably returns
      // the hand unchanged (both counts public). Withhold there too; hand > 4 over an empty deck
      // genuinely changes the hand and stays offered.
      if (opponent.hand.cards.length === 0
        || (opponent.deck.cards.length === 0 && opponent.hand.cards.length <= 4)) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      ABILITY_USED(player, this);
      player.marker.addMarker(this.BIG_WINGS_MARKER, this);

      // TA-458 (TA-379's sibling): "shuffles their hand and puts it on the bottom" — the old code
      // shuffled the hand with an inline PRNG (no external order could ever be supplied, and
      // the card sat in EXCLUDED_RANDOM_CARDS), bottomed it and drew at once. Externalize it the
      // TA-370/TA-379 way: stage the hand INTO the (emptied) deck so the adapter's ShuffleDeckPrompt
      // advertises exactly those cards, restack the untouched deck on top inside the callback, and
      // only THEN draw.
      // TA-591 / B.80: the hand goes UNDER the untouched deck and only that bottom segment is shuffled
      // (`bottomCount`), so the projection shows the hand in transit {hand -> deck bottom} and the deck as it
      // is. The old staging (deck into a temp list, hand into the emptied deck) put the whole deck in transit
      // and the hand on top at the pause.
      const n = opponent.hand.cards.length;
      opponent.hand.moveTo(opponent.deck);
      // TA-462 / B.66: the pile is the HAND (a hand-to-bottom), not the deck — declare it so the
      // adapter's `shuffled` carries zone:'hand' and the deck-randomised property is not asserted.
      return store.prompt(state, new ShuffleDeckPrompt(opponent.id, { zone: 'hand', bottomCount: n }), order => {
        const deck = opponent.deck.cards;
        const start = deck.length - n;
        // Segment-relative answer (the adapter advertises the segment); a whole-deck answer keeps the segment's order.
        const segment = order.length === n ? order.map(i => start + i) : order.filter(i => i >= start);
        if (segment.length === n && new Set(segment).size === n && segment.every(i => i >= start && i < deck.length)) {
          opponent.deck.cards = [...deck.slice(0, start), ...segment.map(i => deck[i])];
        }
        DRAW_CARDS(store, state, opponent, Math.min(4, opponent.deck.cards.length));
      });
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const stadiumCard = StateUtils.getStadiumCard(state);
      if (stadiumCard !== undefined) {
        effect.damage += 60;
      }
    }

    if (effect instanceof EndTurnEffect && effect.player.marker.hasMarker(this.BIG_WINGS_MARKER, this)) {
      effect.player.marker.removeMarker(this.BIG_WINGS_MARKER, this);
    }

    return state;
  }

}
