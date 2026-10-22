import { Effect } from '../../../game/store/effects/effect';
import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardTag, Stage, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { Card, ChooseCardsPrompt, Player, PokemonCard, ShowCardsPrompt, ShuffleDeckPrompt, StateUtils } from '../../../game';
import { MOVE_CARDS, COIN_FLIP_PROMPT } from '../../../game/store/prefabs/prefabs';

export class TeamRocketsGreatBall extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.ITEM;

  public set: string = 'DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '175';

  public regulationMark = 'I';

  public name: string = 'Team Rocket\'s Great Ball';
  public fullName: string = 'Team Rocket\'s Great Ball DRI';

  public text: string =
    'Flip a coin. If heads, search your deck for an Evolution Team Rocket Pokémon, reveal it, and put it into your hand. If tails, search your deck for a Basic Team Rocket Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.deck.cards.length === 0) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      // heads: an EVOLUTION Team Rocket Pokemon; tails: a BASIC Team Rocket Pokemon.
      const blockedOnHeads: number[] = [];
      const blockedOnTails: number[] = [];
      player.deck.cards.forEach((card, index) => {
        if (card instanceof PokemonCard) {
          if (card.stage === Stage.BASIC || !card.hasTag(CardTag.TEAM_ROCKET)) {
            blockedOnHeads.push(index);
          }
          if (card.stage !== Stage.BASIC || !card.hasTag(CardTag.TEAM_ROCKET)) {
            blockedOnTails.push(index);
          }
        }
      });

      // We will discard this card after prompt confirmation
      effect.preventDefault = true;

      // TA-396(b): the TAILS branch was missing entirely — the flip callback handled heads and fell
      // through to `return state` on tails, so no Basic search happened and the owed "Then, shuffle
      // your deck" never ran. Both faces search (with their own filter) and both shuffle, on a whiff
      // too (#2303).
      const search = (blocked: number[]): State => store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck,
        { superType: SuperType.POKEMON },
        { min: 0, max: 1, allowCancel: false, blocked }
      ), selectedCards => {
        const cards: Card[] = selectedCards || [];
        if (cards.length > 0) {
          state = store.prompt(state, new ShowCardsPrompt(
            opponent.id,
            GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
            cards), () => state);
          MOVE_CARDS(store, state, player.deck, player.hand, { cards, sourceCard: this });
        }
        return store.prompt(state, new ShuffleDeckPrompt(player.id), (order) => {
          player.deck.applyOrder(order);
        });
      });

      return COIN_FLIP_PROMPT(store, state, player, flipResult => {
        search(flipResult ? blockedOnHeads : blockedOnTails);
      });
    }
    return state;
  }
}
