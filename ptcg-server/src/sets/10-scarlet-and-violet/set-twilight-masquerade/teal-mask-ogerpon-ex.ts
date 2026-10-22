import { PokemonCard } from '../../../game/store/card/pokemon-card';
import {
  Stage,
  CardType,
  CardTag,
  SuperType,
  EnergyType,
  BoardEffect,
} from '../../../game/store/card/card-types';
import {
  PowerType,
  StoreLike,
  State,
  GameError,
  GameMessage,
  StateUtils,
  AttachEnergyPrompt,
  CardTarget,
  EnergyCard,
  PlayerType,
  SlotType,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import {WAS_ATTACK_USED, WAS_POWER_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class TealMaskOgerponex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];

  public regulationMark = 'H';

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.GRASS];

  public hp: number = 210;

  public weakness = [{ type: CardType.FIRE }];

  public retreat = [CardType.COLORLESS];

  public powers = [
    {
      name: 'Teal Dance',
      powerType: PowerType.ABILITY,
      useWhenInPlay: true,
      text: 'Once during your turn, you may attach a Basic [G] Energy card from your hand to this Pokémon. If you attached any Energy to a Pokémon in this way, draw a card.',
    },
  ];

  public attacks = [
    {
      name: 'Myriad Leaf Shower',
      cost: [CardType.GRASS, CardType.GRASS, CardType.GRASS],
      damage: 30,
      damageCalculation: '+',
      text: 'This attack does 30 more damage for each Energy attached to both Active Pokémon.',
    },
  ];

  public set: string = 'TWM';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '25';

  public name: string = 'Teal Mask Ogerpon ex';

  public fullName: string = 'Teal Mask Ogerpon ex TWM';

  public readonly TEAL_DANCE_MARKER = 'TEAL_DANCE_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      player.marker.removeMarker(this.TEAL_DANCE_MARKER, this);
    }

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      if (player.marker.hasMarker(this.TEAL_DANCE_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      const hasEnergyInHand = player.hand.cards.some((c) => {
        return (
          c instanceof EnergyCard &&
          c.energyType === EnergyType.BASIC &&
          c.provides.includes(CardType.GRASS)
        );
      });
      if (!hasEnergyInHand) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      const cardList = StateUtils.findCardList(state, this);
      if (cardList === undefined) {
        return state;
      }

      // TA-546 (CF-32 / CF-5): the pick is an attach, so it is an AttachEnergyPrompt from the hand to THIS Pokémon
      // (every other slot blocked), projected as attachEnergy{card, target}. It was a ChooseCardsPrompt
      // (CHOOSE_CARD_TO_ATTACH), projected as a bare choose{card}.
      // TA-350 / B.46: the `may` IS the activation — `useAbility` is the decision, and once used the attach is
      // mandatory (#1197, #2306, #2301's 1..max floor for an Ability). With ONE Grass the pick is forced and
      // collapses (CF-14), with two it is a WHICH pick.
      const blocked: number[] = [];
      player.hand.cards.forEach((c, index) => {
        if (!(c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.provides.includes(CardType.GRASS))) {
          blocked.push(index);
        }
      });
      const blockedTo: CardTarget[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
        if (list !== cardList) {
          blockedTo.push(target);
        }
      });

      return store.prompt(
        state,
        new AttachEnergyPrompt(
          player.id,
          GameMessage.ATTACH_ENERGY_CARDS,
          player.hand,
          PlayerType.BOTTOM_PLAYER,
          [SlotType.ACTIVE, SlotType.BENCH],
          { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
          { min: 1, max: 1, allowCancel: false, blocked, blockedTo },
        ),
        (transfers) => {
          const cards = (transfers || []).map(t => t.card);
          if (cards.length > 0) {
            player.marker.addMarker(this.TEAL_DANCE_MARKER, this);
            player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list) => {
              if (list.getPokemonCard() === this) {
                list.addBoardEffect(BoardEffect.ABILITY_USED);
              }
            });

            MOVE_CARDS(store, state, player.hand, cardList, { cards, sourceCard: this });

            MOVE_CARDS(store, state, player.deck, player.hand, { count: 1, sourceCard: this });
          }
        },
      );
    }

    if (
      effect instanceof EndTurnEffect &&
      effect.player.marker.hasMarker(this.TEAL_DANCE_MARKER, this)
    ) {
      effect.player.marker.removeMarker(this.TEAL_DANCE_MARKER, this);
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const playerProvidedEnergy = new CheckProvidedEnergyEffect(player);
      store.reduceEffect(state, playerProvidedEnergy);
      const playerEnergyCount = playerProvidedEnergy.energyMap.reduce(
        (left, p) => left + StateUtils.getProvidesUnitCount(p.provides),
        0,
      );

      const opponentProvidedEnergy = new CheckProvidedEnergyEffect(opponent);
      store.reduceEffect(state, opponentProvidedEnergy);
      const opponentEnergyCount = opponentProvidedEnergy.energyMap.reduce(
        (left, p) => left + StateUtils.getProvidesUnitCount(p.provides),
        0,
      );

      effect.damage += (playerEnergyCount + opponentEnergyCount) * 30;
    }

    if (
      effect instanceof PutDamageEffect &&
      effect.target.cards.includes(this) &&
      effect.target.getPokemonCard() === this
    ) {
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
