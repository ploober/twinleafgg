import { Effect } from '../../../game/store/effects/effect';
import { GameMessage } from '../../../game/game-message';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { SuperType, TrainerType } from '../../../game/store/card/card-types';
import { CardTarget, EnergyCard, GameError, MoveEnergyPrompt, Player, PlayerType, SlotType, StateUtils } from '../../../game';
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
      // TA-483: "from 1 of your Pokemon to another of your Pokemon" is ONE source and ONE target, so the optional
      // second Energy is pinned to the first move's source and target.
      return store.prompt(state, new MoveEnergyPrompt(
        effect.player.id,
        GameMessage.MOVE_ENERGY_CARDS,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { superType: SuperType.ENERGY },
        { min: 1, max: 1, allowCancel: false }
      ), transfers => {
        if (!transfers || transfers.length === 0) {
          return state;
        }
        const first = transfers[0];
        const source = StateUtils.getTarget(state, player, first.from);
        const target = StateUtils.getTarget(state, player, first.to);
        MOVE_CARDS(store, state, source, target, { cards: [first.card], sourceCard: this });

        if (!source.cards.some(c => c.superType === SuperType.ENERGY)) {
          return state;
        }
        const blockedFrom: CardTarget[] = [];
        const blockedTo: CardTarget[] = [];
        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, t) => {
          if (list !== source) {
            blockedFrom.push(t);
          }
          if (list !== target) {
            blockedTo.push(t);
          }
        });
        return store.prompt(state, new MoveEnergyPrompt(
          effect.player.id,
          GameMessage.MOVE_ENERGY_CARDS,
          PlayerType.BOTTOM_PLAYER,
          [SlotType.ACTIVE, SlotType.BENCH],
          { superType: SuperType.ENERGY },
          { min: 0, max: 1, allowCancel: false, blockedFrom, blockedTo }
        ), second => {
          for (const transfer of second || []) {
            MOVE_CARDS(store, state, source, target, { cards: [transfer.card], sourceCard: this });
          }
        });
      });
    }

    return state;
  }
}
