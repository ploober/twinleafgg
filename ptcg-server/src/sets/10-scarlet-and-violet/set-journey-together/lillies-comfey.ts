import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType, CardTag } from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  PokemonCardList,
  Card,
  ChooseCardsPrompt,
  GameMessage,
  ShuffleDeckPrompt,
} from '../../../game';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Effect } from '../../../game/store/effects/effect';
import { PlayPokemonFromDeckEffect } from '../../../game/store/effects/play-card-effects';
import { AfterAttackEffect } from '../../../game/store/effects/game-phase-effects';
import { PUT_THIS_POKEMON_AND_ALL_ATTACHED_CARDS_INTO_YOUR_HAND } from '../../../game/store/prefabs/attack-effects';
import { WAS_ATTACK_USED, MAY_SEARCH_YOUR_DECK } from '../../../game/store/prefabs/prefabs';

function* useCallForFamily(
  next: Function,
  store: StoreLike,
  state: State,
  effect: AttackEffect,
): IterableIterator<State> {
  const player = effect.player;
  const slots: PokemonCardList[] = player.bench.filter((b) => b.cards.length === 0);
  const max = Math.min(slots.length);

  if (max === 0) {
    return state;
  }

  const blocked: number[] = [];
  player.deck.cards.forEach((card, index) => {
    if (card instanceof PokemonCard && !card.hasTag(CardTag.LILLIES)) {
      blocked.push(index);
    }
  });

  let cards: Card[] = [];
  yield store.prompt(
    state,
    new ChooseCardsPrompt(
      player,
      GameMessage.CHOOSE_CARD_TO_PUT_ONTO_BENCH,
      player.deck,
      { superType: SuperType.POKEMON, stage: Stage.BASIC },
      { min: 0, max: max, allowCancel: false, blocked },
    ),
    (selected) => {
      cards = selected || [];
      next();
    },
  );

  if (cards.length > slots.length) {
    cards.length = slots.length;
  }

  cards.forEach((card, index) => {
    store.reduceEffect(
      state,
      new PlayPokemonFromDeckEffect(player, card as PokemonCard, slots[index]),
    );
  });

  return store.prompt(state, new ShuffleDeckPrompt(player.id), (order) => {
    player.deck.applyOrder(order);
  });
}

export class LilliesComfey extends PokemonCard {
  public stage: Stage = Stage.BASIC;

  protected _tags = [CardTag.LILLIES];

  public cardType: CardType[] = [P];

  public hp: number = 70;

  public weakness = [{ type: M }];

  public retreat = [C];

  public attacks = [
    {
      name: 'Inviting Flowers',
      cost: [C],
      damage: 0,
      text: "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
    },
    {
      name: 'Fade Out',
      cost: [P],
      damage: 30,
      text: 'Put this Pokémon and all attached cards into your hand.',
    },
  ];

  public regulationMark = 'I';

  public cardImage: string = 'assets/cardback.png';

  public set: string = 'JTG';

  public setNumber = '68';

  public name: string = "Lillie's Comfey";

  public fullName: string = "Lillie's Comfey JTG";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-784 (B.131, owner 2026-10-25): "You may search" is a confirm asked first; declining searches, looks at and
    // shuffles nothing. On yes the search (its "any number" pick may stop), then the shuffle.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return MAY_SEARCH_YOUR_DECK(store, state, effect, () => {
        const generator = useCallForFamily(() => generator.next(), store, state, effect);
        generator.next();
      });
    }

    // Fade Out — "Put this Pokémon and all attached cards into your hand." Runs after damage
    // (AfterAttackEffect), mirroring the Greedent DAA "Smack and Run" idiom. This attack had NO
    // handler before, so the self-bounce never happened.
    // TA-730: keyed on the attack the AfterAttackEffect carries, not an instance flag: the menu's attack probes share
    // this Card instance, so a probed Fade Out armed the flag and the next real attack (Inviting Flowers) bounced.
    if (effect instanceof AfterAttackEffect && effect.attack === this.attacks[1]
      && effect.player.active.getPokemonCard() === this) {
      PUT_THIS_POKEMON_AND_ALL_ATTACHED_CARDS_INTO_YOUR_HAND(store, state, effect);
    }

    return state;
  }
}
