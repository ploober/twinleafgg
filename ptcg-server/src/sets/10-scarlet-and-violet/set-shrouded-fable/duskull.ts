import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike, State, PokemonCardList, Card, ChooseCardsPrompt, GameMessage } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

function* useKingsOrder(next: Function, store: StoreLike, state: State,
  effect: AttackEffect): IterableIterator<State> {
  const player = effect.player;
  const slots: PokemonCardList[] = player.bench.filter(b => b.cards.length === 0);
  const max = Math.min(slots.length, 3);

  const hasDuskullInDiscard = player.discard.cards.some(c => {
    return c instanceof PokemonCard && c.name === 'Duskull';
  });
  // The attack is usable even when it can do nothing (no Duskull in the
  // discard pile / no free Bench space); the effect just does not happen.
  if (!hasDuskullInDiscard || max === 0) {
    return state;
  }

  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_PUT_ONTO_BENCH,
    player.discard,
    { superType: SuperType.POKEMON, name: 'Duskull' },
    { min: 0, max, allowCancel: false }
  ), selected => {
    cards = selected || [];
    next();
  });

  if (cards.length > slots.length) {
    cards.length = slots.length;
  }

  cards.forEach((card, index) => {
    player.discard.moveCardTo(card, slots[index]);
    slots[index].pokemonPlayedTurn = state.turn;
  });
}

export class Duskull extends PokemonCard {

  public regulationMark = 'H';

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.PSYCHIC];

  public hp: number = 60;

  public weakness = [{ type: CardType.DARK }];

  public resistance = [{ type: CardType.FIGHTING, value: -30 }];

  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Come and Get You',
      cost: [CardType.PSYCHIC],
      damage: 0,
      text: 'Put up to 3 Duskull from your discard pile onto your Bench.'
    },
    {
      name: 'Mumble',
      cost: [CardType.PSYCHIC, CardType.PSYCHIC],
      damage: 30,
      text: ''
    },
  ];

  public set: string = 'SFA';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '18';

  public name: string = 'Duskull';

  public fullName: string = 'Duskull SFA';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const generator = useKingsOrder(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }

}
