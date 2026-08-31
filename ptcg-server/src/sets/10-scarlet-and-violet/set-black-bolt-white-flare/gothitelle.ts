import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { PowerType } from '../../../game/store/card/pokemon-types';
import { StoreLike, State, GameMessage, StateUtils, GameError } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { ABILITY_USED, MOVE_CARDS, SHUFFLE_THEN_DRAW, WAS_ATTACK_USED, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class Gothitelle extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public cardType: CardType[] = [P];
  public hp: number = 150;
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C, C];
  public evolvesFrom = 'Gothorita';

  public powers = [{
    name: 'Distorted Future',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, if this Pokémon is in the Active Spot, you may have your opponent shuffle their hand into their deck and draw 3 cards.'
  }];

  public attacks = [{
    name: 'Synchro Shot',
    cost: [P, C],
    damage: 90,
    damageCalculation: '+',
    text: 'If you have the same number of cards in your hand as your opponent, this attack does 90 more damage.'
  }];

  public set: string = 'WHT';
  public regulationMark = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '43';
  public name: string = 'Gothitelle';
  public fullName: string = 'Gothitelle WHT';

  public readonly DISTORTED_FUTURE_MARKER = 'DISTORTED_FUTURE_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Can't use ability if already used
      if (player.marker.hasMarker(this.DISTORTED_FUTURE_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      // TA-235 / B.29 rule 1 (arithmetic): with the opponent's hand AND deck both empty, both
      // halves of the effect ("shuffle their hand into their deck and draw 3") are inert, and both
      // counts are public. Checked BEFORE the marker is added so a blocked use cannot consume the
      // once-per-turn.
      // TA-338 / B.41 addendum 2026-08-31 (the CYCLE cell) widens it: with the opponent's deck
      // EMPTY and hand ≤ 3, the shuffled-in cards are drawn straight back, so the effect provably
      // returns the hand unchanged (both counts public) — withhold. Hand > 3 over an empty deck
      // genuinely changes the hand (3 drawn of >3 shuffled) and stays offered, and the B.41(b)
      // empty-hand/STOCKED-deck cell stays offered (the unconditional draw moves cards that stay
      // moved).
      if (opponent.deck.cards.length === 0 && opponent.hand.cards.length <= 3) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      player.marker.addMarker(this.DISTORTED_FUTURE_MARKER, this);
      ABILITY_USED(player, this);

      if (player.active.getPokemonCard() !== this) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // SD-25 (omission sub-shape) / TA-305: the printed text is "shuffle their hand into their deck
      // AND DRAW 3". The shuffle was simply absent — `MOVE_CARDS` then `DRAW_CARDS` hands the
      // opponent back the very cards they just put in, in order, so the ability's whole randomising
      // purpose was lost while every COUNT stayed identical (hand 3 in, 3 out) and no cell noticed.
      // The draw must run INSIDE the shuffle's continuation, per `SHUFFLE_THEN_DRAW` (TA-304).
      MOVE_CARDS(store, state, opponent.hand, opponent.deck, { sourceCard: this });
      return SHUFFLE_THEN_DRAW(store, state, opponent, 3);
    }

    if (effect instanceof EndTurnEffect) {
      const player = (effect as EndTurnEffect).player;
      player.marker.removeMarker(this.DISTORTED_FUTURE_MARKER, this);
    }

    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;

      player.marker.removeMarker(this.DISTORTED_FUTURE_MARKER, this);
      return state;
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      if (player.hand.cards.length === opponent.hand.cards.length) {
        effect.damage += 90;
      }
    }

    return state;
  }
}