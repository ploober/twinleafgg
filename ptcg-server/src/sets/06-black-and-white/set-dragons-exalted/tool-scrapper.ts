import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

import {
  PlayerType, StateUtils, GameError, GameMessage,
  PokemonCardList,
  ChooseCardsPrompt,
  Card,
  CardList,
  Player
} from '../../../game';

function* playCard(next: Function, store: StoreLike, state: State, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  // TA-627: the objects chosen are the Tools themselves ("Choose up to 2 Pokémon Tools attached to Pokémon (yours or
  // your opponent's) and discard them"), up to 2 in total from either side, both possibly off one Pokémon (as
  // minccino.ts does since TA-579). This used to pick up to 2 BEARERS and discard tools[0] of each, so the second Tool
  // on a Pokémon could not be chosen and 2 could not come off one Pokémon.
  const tools: Card[] = [];
  const bearerOf = new Map<Card, PokemonCardList>();
  const ownerOf = new Map<Card, Player>();
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
    cardList.tools.forEach(tool => { tools.push(tool); bearerOf.set(tool, cardList); ownerOf.set(tool, player); });
  });
  opponent.forEachPokemon(PlayerType.TOP_PLAYER, cardList => {
    cardList.tools.forEach(tool => { tools.push(tool); bearerOf.set(tool, cardList); ownerOf.set(tool, opponent); });
  });

  if (tools.length === 0) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  // We will discard this card after prompt confirmation
  effect.preventDefault = true;

  // Compendium #2301 (B.18): a Trainer's "up to X" is 1..X, so at least one Tool is chosen.
  const toolList = new CardList();
  toolList.cards = tools;
  let selected: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_DISCARD,
    toolList,
    {},
    { min: 1, max: Math.min(2, tools.length), allowCancel: false }
  ), results => {
    selected = results || [];
    next();
  });

  selected.forEach(tool => {
    const bearer = bearerOf.get(tool);
    const owner = ownerOf.get(tool);
    if (bearer !== undefined && owner !== undefined && bearer.tools.includes(tool)) {
      MOVE_CARDS(store, state, bearer, owner.discard, { cards: [tool], sourceCard: effect.trainerCard });
    }
  });

  return state;
}

export class ToolScrapper extends TrainerCard {

  public trainerType: TrainerType = TrainerType.ITEM;

  public set: string = 'DRX';

  public name: string = 'Tool Scrapper';

  public fullName: string = 'Tool Scrapper DRX';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '116';

  public text: string =
    'Choose up to 2 Pokemon Tool cards attached to Pokemon in play (yours or ' +
    'your opponent\'s) and discard them.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    // Mirrors `playCard`: a Trainer that can have no effect can't be played, so at least one Pokémon
    // Tool must be attached to a Pokémon in play — yours or your opponent's. Without this gate canPlay
    // defaulted to playable, so the card was offered in legalActions and then rejected on play.
    const opponent = StateUtils.getOpponent(state, player);
    let pokemonsWithTool = 0;
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
      if (cardList.tools.length > 0) { pokemonsWithTool += 1; }
    });
    opponent.forEachPokemon(PlayerType.TOP_PLAYER, cardList => {
      if (cardList.tools.length > 0) { pokemonsWithTool += 1; }
    });
    return pokemonsWithTool > 0;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, effect);
      return generator.next().value;
    }
    return state;
  }

}
