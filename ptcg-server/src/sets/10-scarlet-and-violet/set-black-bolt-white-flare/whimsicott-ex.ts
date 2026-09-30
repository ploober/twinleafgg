import { PokemonCard } from '../../../game/store/card/pokemon-card';
import {
  CardType,
  Stage,
  CardTag,
  SuperType,
  EnergyType,
} from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  GameMessage,
  PlayerType,
  SlotType,
  StateUtils,
  TrainerCard,
} from '../../../game';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Effect } from '../../../game/store/effects/effect';
import { AttachEnergyPrompt } from '../../../game/store/prompts/attach-energy-prompt';
import { ShowCardsPrompt } from '../../../game/store/prompts/show-cards-prompt';
import { ShuffleDeckPrompt } from '../../../game/store/prompts/shuffle-prompt';
import {WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

function* useEnergyGift(
  next: Function,
  store: StoreLike,
  state: State,
  effect: AttackEffect,
): IterableIterator<State> {
  const player = effect.player;

  // TA-126/CF-9: the trailing shuffle survives an empty deck. Energy Gift attaches "to your Pokémon",
  // and you always have an Active, so the search instruction is always executable — you simply looked
  // at zero cards and found nothing, which compendium #2171 handles like a voluntary fail: *"you must
  // search and shuffle your deck."* Distinct from the RE-38/TA-97 over-shuffle case (an attach with no
  // legal destination, where #1108/RE-32 say no search happens at all).
  if (player.deck.cards.length === 0) {
    return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
      player.deck.applyOrder(order);
    });
  }

  yield store.prompt(state, new AttachEnergyPrompt(
    player.id,
    GameMessage.ATTACH_ENERGY_TO_BENCH,
    player.deck,
    PlayerType.BOTTOM_PLAYER,
    [SlotType.BENCH, SlotType.ACTIVE],
    { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
    { allowCancel: false, min: 0, max: 3 }
  ), transfers => {
    transfers = transfers || [];
    for (const transfer of transfers) {
      const target = StateUtils.getTarget(state, player, transfer.to);
      MOVE_CARDS(store, state, player.deck, target, { cards: [transfer.card], sourceCard: effect.source.getPokemonCard()! });
    }
    // TA-331: resume the generator ONCE after the (possibly empty) attach loop so the trailing
    // `return store.prompt(ShuffleDeckPrompt)` fires even on a ZERO-take. The prior `next()` sat
    // INSIDE the for-loop, so a zero-transfer attach — a deck that is non-empty but holds no Basic
    // Energy (min:0 makes zero a legal voluntary fail; #2171 "you must search and shuffle your
    // deck") — never resumed the generator and the mandated "Then, shuffle your deck" was skipped
    // (the same generator-next()-in-loop owed-shuffle-skip as TA-320 Energy Search Pro). Rotomancer
    // shuffles on the zero-take. On >=1 transfer this still resumes exactly once (a done generator
    // ignores extra next() calls), so the non-zero path is unchanged.
    next();
  });

  return store.prompt(state, new ShuffleDeckPrompt(player.id), (order) => {
    player.deck.applyOrder(order);
  });
}

export class Whimsicottex extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  protected _tags = [CardTag.POKEMON_ex];
  public evolvesFrom = 'Cottonee';
  public cardType: CardType[] = [G];
  public hp: number = 230;
  public weakness = [{ type: R }];
  public resistance = [];
  public retreat = [];

  public attacks = [{
    name: 'Energy Gift',
    cost: [G],
    damage: 0,
    text: 'Search your deck for up to 3 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.'
  },
  {
    name: 'Wondrous Cotton',
    cost: [G],
    damage: 0,
    text: 'Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.'
  }];

  public set: string = 'WHT';
  public regulationMark: string = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '5';
  public name: string = 'Whimsicott ex';
  public fullName: string = 'Whimsicott ex SV11W';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Energy Gift
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const generator = useEnergyGift(() => generator.next(), store, state, effect);
      return generator.next().value;
    }
    // Wonder Cotton
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      state = store.prompt(
        state,
        new ShowCardsPrompt(
          player.id,
          GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
          opponent.hand.cards,
        ),
        () => {
          const cardsInOpponentHand = opponent.hand.cards.filter(
            (card) => card instanceof TrainerCard,
          ).length;
          const damage = opponent.hand.cards.slice(0, cardsInOpponentHand);
          effect.damage = damage.length * 50;
        },
      );
    }
    return state;
  }
}
