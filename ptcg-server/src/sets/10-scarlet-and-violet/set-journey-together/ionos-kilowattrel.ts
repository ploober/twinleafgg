import { PokemonCard } from '../../../game/store/card/pokemon-card';
import {
  Stage,
  CardType,
  CardTag,
  SuperType,
  EnergyType,
} from '../../../game/store/card/card-types';
import {
  ChooseCardsPrompt,
  EnergyCard,
  GameError,
  GameMessage,
  PokemonCardList,
  PowerType,
  State,
  StateUtils,
  StoreLike,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';

import {
  ABILITY_USED,
  ADD_MARKER,
  DRAW_CARDS_UNTIL_CARDS_IN_HAND,
  WAS_POWER_USED,
} from '../../../game/store/prefabs/prefabs';

export class IonosKilowattrel extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = "Iono's Wattrel";
  protected _tags = [CardTag.IONOS];
  public cardType: CardType[] = [L];
  public hp: number = 120;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public powers = [
    {
      name: 'Flashing Draw',
      useWhenInPlay: true,
      powerType: PowerType.ABILITY,
      text: 'You must discard a Basic [L] Energy from this Pokémon in order to use this Ability. Once during your turn, you may draw cards until you have 6 cards in your hand.',
    },
  ];

  public attacks = [
    {
      name: 'Mach Bolt',
      cost: [L, C, C],
      damage: 70,
      text: '',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'JTG';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '55';
  public name: string = "Iono's Kilowattrel";
  public fullName: string = "Iono's Kilowattrel JTG";

  public readonly RUMBLING_ENGINE_MARKER = 'RUMBLING_ENGINE_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      player.marker.removeMarker(this.RUMBLING_ENGINE_MARKER, this);
    }

    if (effect instanceof EndTurnEffect) {
      const player = effect.player;
      player.marker.removeMarker(this.RUMBLING_ENGINE_MARKER, this);
    }

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      if (player.hand.cards.length >= 6) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // TA-220 / B.30 rule 2: "You must discard ... IN ORDER TO USE this Ability" makes the discard a
      // COST and the draw the EFFECT, and compendium #2115 answers this exact shape for N's Zoroark ex's
      // "Trade" -- "No, you can't use Trade if there aren't any cards left in your deck. Discarding a card
      // from your hand is a cost to use the Ability, and drawing cards is the effect." An unpayable-FOR-
      // NOTHING cost is not a legal use, so an empty deck withholds the Ability rather than letting the
      // player pay to accomplish nothing. #1654 says the same for Liepard's "Trade".
      //
      // This is NOT the Zoroark-GX wording, and #2114 flags the split deliberately: "N's Zoroark ex's
      // 'Trade' Ability uses a different wording than Zoroark-GX's 'Trade'; it's intentional that they
      // work differently." Zoroark-GX ("Discard a card from your hand. Then, draw ...") CAN be used on an
      // empty deck (#280) because there the discard is the first step of the effect, not a cost. Do not
      // generalise this guard to that wording.
      //
      // Measured: on an empty deck twinleaf OFFERED Flashing Draw and rotomancer withheld it.
      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      if (player.marker.hasMarker(this.RUMBLING_ENGINE_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      const cardList = StateUtils.findCardList(state, this) as PokemonCardList;
      const lightningEnergy = cardList.cards.filter(
        (c) =>
          c instanceof EnergyCard &&
          c.superType === SuperType.ENERGY &&
          c.energyType === EnergyType.BASIC &&
          c.name === 'Lightning Energy',
      );

      if (lightningEnergy.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // TA-220 / B.30 rule 1: a COST is not declinable once the Ability has been declared. This prompt
      // used to be `{ allowCancel: true, min: 0, max: 1 }`, which put an `endChoice` (`confirm:false`)
      // decline on the wire beside the Energy picks and let a player use the Ability, pay nothing and
      // get nothing. The "you may" on this card governs USING the Ability, and once used the payment is
      // mandatory -- #116 ("once you begin ... you must complete the full action") and #2221 ("must use
      // the Bring Down attack once announced") both refuse a mid-resolution back-out.
      //
      // The reference implementation is twinleaf's OWN `jtg-098` N's Zoroark ex "Trade", same printed
      // idiom, coded `{ allowCancel: false, min: 1, max: 1 }` -- and it is the one that converges with
      // rotomancer on both the forced and the genuine cell. Measured here on 3 attached Basic Lightning:
      // twinleaf offered 3 discards PLUS `confirm:false`, rotomancer offered the 3 discards alone.
      //
      // The hand-rolled one-Energy fast path that used to sit here -- an early branch keyed on the
      // filtered Energy count that skipped the prompt entirely -- is deleted with it (the anti-revert
      // manifest carries that line as an `absentSignatures` entry, so a merge cannot quietly restore
      // it). It was a card-level reimplementation of the CF-14 forced-pick collapse,
      // and with `allowCancel:false` + `min:1` the decomposer's generic path
      // (`COLLAPSIBLE_PICK_MESSAGES` already contains CHOOSE_CARD_TO_DISCARD) collapses the same cell --
      // verified live, the one-Energy board still resolves atomically on both engines.
      state = store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        cardList,
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Lightning Energy' },
        { allowCancel: false, min: 1, max: 1 }
      ), energy => {
        if (energy === null || energy.length === 0) {
          return state;
        }

        energy.forEach(card => cardList.moveCardTo(card, player.discard));

        DRAW_CARDS_UNTIL_CARDS_IN_HAND(player, 6);
        ADD_MARKER(this.RUMBLING_ENGINE_MARKER, player, this);
        ABILITY_USED(player, this);
      });
    }

    return state;
  }
}
