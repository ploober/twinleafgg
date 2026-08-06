import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { BoardEffect, CardType, Stage, SuperType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { PowerType } from '../../../game/store/card/pokemon-types';
import { EnergyCard, GameError, GameMessage, ChooseCardsPrompt, PlayerType, StateUtils } from '../../../game';

import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { ADD_BURN_TO_PLAYER_ACTIVE, MOVE_CARDS, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';
// Energy type constants (R, C, W) are assumed to be globally available as in Larvesta

export class Volcarona extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Larvesta';
  public cardType = R;
  public hp: number = 120;
  public weakness = [{ type: W }];
  public retreat = [C];

  public powers = [{
    name: 'Torrid Scales',
    powerType: PowerType.ABILITY,
    useWhenInPlay: true,
    // TA-222: the text here read "Once during your turn, you may discard a Basic [R] Energy card from
    // your hand in order to leave your opponent's Active Pokémon Burned." All FIVE vendored sources and
    // rotomancer print the wording below instead. Not cosmetic: the old wording put the discard INSIDE
    // the "you may", i.e. an optional discard, while the printed card makes it a cost gate -- which is
    // the same mistake the `allowCancel: true` below encoded, made once and written down twice.
    text: 'You must discard a Basic [R] Energy card from your hand in order to use this Ability. Once during your turn, you may make your opponent\'s Active Pokémon Burned.'
  }];

  public attacks = [{
    name: 'Fire Wing',
    cost: [R, C, C],
    damage: 70,
    text: ''
  }];

  public regulationMark = 'I';
  public set: string = 'BLK';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '16';
  public name: string = 'Volcarona';
  public fullName: string = 'Volcarona SV11B';

  public readonly HEAT_WAVE_SCALES_MARKER = 'HEAT_WAVE_SCALES_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      player.marker.removeMarker(this.HEAT_WAVE_SCALES_MARKER, this);
    }

    if (effect instanceof EndTurnEffect && effect.player.marker.hasMarker(this.HEAT_WAVE_SCALES_MARKER, this)) {
      const player = effect.player;
      player.marker.removeMarker(this.HEAT_WAVE_SCALES_MARKER, this);
    }

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const hasEnergyInHand = player.hand.cards.some(c => {
        return c.superType === SuperType.ENERGY && (c as EnergyCard).provides.includes(CardType.FIRE);
      });

      if (!hasEnergyInHand) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      if (player.marker.hasMarker(this.HEAT_WAVE_SCALES_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      state = store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        player.hand,
        { superType: SuperType.ENERGY, name: 'Fire Energy' },
        // TA-221 / B.30 rule 3: same defect as `meg-110` Gumshoos, and found by PREDICTION from the
        // census of the cost idiom rather than by the fuzzer -- its seed board had an empty hand, so the
        // cell was never reached. `allowCancel: true` blocks `forcedPickIndices`, so the forced
        // single-candidate cost pick could never collapse. Measured on a hand of exactly one Basic Fire:
        // twinleaf surfaced a 1-option `discard`, rotomancer collapsed it and applied it (hand 1->0,
        // discard 0->1). Negative control on two Basic Fire: BOTH engines surface two picks.
        { allowCancel: false, min: 1, max: 1 }
      ), cards => {
        cards = cards || [];
        if (cards.length === 0) {
          return;
        }
        player.marker.addMarker(this.HEAT_WAVE_SCALES_MARKER, this);

        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
          if (cardList.getPokemonCard() === this) {
            cardList.addBoardEffect(BoardEffect.ABILITY_USED);
          }
        });

        MOVE_CARDS(store, state, player.hand, player.discard, { cards, sourceCard: this, sourceEffect: this.powers[0] });
        ADD_BURN_TO_PLAYER_ACTIVE(store, state, opponent, this);
      });
      return state;
    }
    return state;
  }
} 