import { Effect } from '../../../game/store/effects/effect';
import { GameMessage } from '../../../game/game-message';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { SuperType, TrainerType } from '../../../game/store/card/card-types';
import { Card, CardTarget, ChooseCardsPrompt, ChoosePokemonPrompt, EnergyCard, GameError, Player, PlayerType, SlotType } from '../../../game';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Poppy extends TrainerCard {
  public regulationMark = 'G';

  protected _trainerType: TrainerType = TrainerType.SUPPORTER;

  public set: string = 'OBF';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '193';

  public name: string = 'Poppy';

  public fullName: string = 'Poppy OBF';

  public text: string =
    'Move up to 2 Energy from 1 of your Pokémon to another ' + 'of your Pokémon.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    let hasEnergy = false;
    let pokemonCount = 0;
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
      pokemonCount += 1;
      const energyAttached = cardList.cards.some((c) => c.superType === SuperType.ENERGY);
      hasEnergy = hasEnergy || energyAttached;
    });
    if (!hasEnergy || pokemonCount <= 1) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;

      // Player has no Basic Energy in the discard pile
      let hasEnergy = false;
      let pokemonCount = 0;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
        pokemonCount += 1;
        const energyAttached = cardList.cards.some((c) => {
          return c instanceof EnergyCard;
        });
        hasEnergy = hasEnergy || energyAttached;
      });

      if (!hasEnergy || pokemonCount <= 1) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      const supporterTurn = player.supporterTurn;

      if (supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      MOVE_CARDS(store, state, player.hand, player.supporter, {
        cards: [effect.trainerCard],
        sourceCard: this,
      });
      // We will discard this card after prompt confirmation
      effect.preventDefault = true;

      // OOP-91 / B.18 (#2301): a Trainer's "move up to 2" is 1..2; canPlay guarantees an Energy and a second
      // Pokemon, so the first move is always possible and owed.
      // TA-778 (B.120 amended, owner 2026-10-25): "from 1 of your Pokemon to another of your Pokemon" asks the source,
      // then up to 2 of its Energy, then another Pokemon (the source is never a destination). Replaces TA-483's two
      // MoveEnergyPrompts, which asked (Energy, source, target) and fixed the destination with the first move.
      const noEnergy: CardTarget[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, t) => {
        if (!list.cards.some(c => c.superType === SuperType.ENERGY)) {
          noEnergy.push(t);
        }
      });
      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { min: 1, max: 1, allowCancel: false, blocked: noEnergy }
      ), sources => {
        const source = (sources || [])[0];
        if (!source) {
          return state;
        }
        const toDestination = (cards: Card[]): State => {
          if (cards.length === 0) {
            return state;
          }
          const isSource: CardTarget[] = [];
          player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, t) => {
            if (list === source) {
              isSource.push(t);
            }
          });
          return store.prompt(state, new ChoosePokemonPrompt(
            player.id,
            GameMessage.CHOOSE_POKEMON_TO_ATTACH_CARDS,
            PlayerType.BOTTOM_PLAYER,
            [SlotType.ACTIVE, SlotType.BENCH],
            { min: 1, max: 1, allowCancel: false, blocked: isSource }
          ), targets => {
            const target = (targets || [])[0];
            if (target) {
              MOVE_CARDS(store, state, source, target, { cards, sourceCard: this });
            }
          });
        };
        const energy = source.cards.filter(c => c.superType === SuperType.ENERGY);
        if (energy.length === 1) {
          return toDestination(energy);   // SR-3: a single Energy with a floor of 1 is forced, not asked
        }
        const notEnergy: number[] = [];
        source.cards.forEach((c, index) => {
          if (c.superType !== SuperType.ENERGY) {
            notEnergy.push(index);
          }
        });
        return store.prompt(state, new ChooseCardsPrompt(
          player,
          GameMessage.MOVE_ENERGY_CARDS,
          source,
          { superType: SuperType.ENERGY },
          { min: 1, max: 2, allowCancel: false, blocked: notEnergy }
        ), selected => toDestination(selected || []));
      });
    }

    return state;
  }
}
