import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, PokemonCardList, GameMessage, PlayerType, StateUtils, ChooseCardsPrompt, Card, CardList } from '../../../game';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Effect } from '../../../game/store/effects/effect';
import {WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

function* useCleaningUp(next: Function, store: StoreLike, state: State,
  effect: AttackEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  // TA-579: the objects chosen are the Tools themselves ("Discard up to 2 Pokémon Tools from your opponent's
  // Pokémon"), up to 2 in total, both possibly off one Pokémon. This used to pick up to 2 BEARERS and then raise a
  // ChooseCardsPrompt per bearer inside a forEach without yield, so a bearer holding 2 Tools lost nothing.
  const tools: Card[] = [];
  const bearerOf = new Map<Card, PokemonCardList>();
  opponent.forEachPokemon(PlayerType.TOP_PLAYER, cardList => {
    cardList.tools.forEach(tool => {
      tools.push(tool);
      bearerOf.set(tool, cardList);
    });
  });

  // "Discard up to 2 Pokémon Tools" is a whiff: with no Tools in play there is nothing to discard,
  // but the attack is still legal to use — it just does nothing. Do not reject it (an offer-then-reject
  // would hide the attack from the menu). Same whiff-is-a-no-op class as regice-ex / slowpoke (TA-46/52).
  if (tools.length === 0) {
    return state;
  }

  // We will discard this card after prompt confirmation
  effect.preventDefault = true;

  // TA-155 / compendium #2301: for ATTACK effects, "up to X" means any number between 0 and X —
  // the player may discard nothing. min:0 declares the real range (the declared range IS the wire contract).
  // Note the ruling's asymmetry: Trainer/Ability "up to X" is 1..X (Blowtorch, Ruffian).
  const toolList = new CardList();
  toolList.cards = tools;
  let selected: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_DISCARD,
    toolList,
    {},
    { min: 0, max: Math.min(2, tools.length), allowCancel: false }
  ), results => {
    selected = results || [];
    next();
  });

  selected.forEach(tool => {
    const bearer = bearerOf.get(tool);
    if (bearer !== undefined && bearer.tools.includes(tool)) {
      MOVE_CARDS(store, state, bearer, opponent.discard, { cards: [tool], sourceCard: effect.source.getPokemonCard()! });
    }
  });

  return state;
}

export class Minccino extends PokemonCard {

  public regulationMark = 'H';

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.COLORLESS];

  public hp: number = 70;

  public weakness = [{ type: CardType.FIGHTING }];

  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Beat',
      cost: [CardType.COLORLESS],
      damage: 10,
      text: ''
    },
    {
      name: 'Cleaning Up',
      cost: [CardType.COLORLESS, CardType.COLORLESS],
      damage: 0,
      text: 'Discard up to 2 Pokémon Tools from your opponent\'s Pokémon.'
    }
  ];

  public set: string = 'TEF';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '136';

  public name: string = 'Minccino';

  public fullName: string = 'Minccino TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // "Cleaning Up" is attack index 1 (index 0 is "Beat", a vanilla 10-damage attack with no
    // reduceEffect). Binding this handler to index 0 made declaring "Beat" run the tool-discard —
    // which throws CANNOT_PLAY_THIS_CARD when the opponent has no tools, so the attack menu hid
    // "Beat" entirely and offered only "Cleaning Up". (Wrong-attack-index class, cf. TA-49/TA-58.)
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const generator = useCleaningUp(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }

}
