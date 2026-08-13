import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, EnergyType } from '../../../game/store/card/card-types';
import { StoreLike, State, Card, GameMessage, SuperType, SlotType, StateUtils } from '../../../game';
import { ChooseCardsPrompt, ChoosePokemonPrompt, ShuffleDeckPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PlayerType } from '../../../game';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { AfterAttackEffect } from '../../../game/store/effects/game-phase-effects';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { AFTER_ATTACK, WAS_ATTACK_USED, SHUFFLE_DECK} from '../../../game/store/prefabs/prefabs';

function* useBurningCharge(next: Function, store: StoreLike, state: State,
  effect: AttackEffect | AfterAttackEffect): IterableIterator<State> {

  const player = effect.player;

  // TA-250 / B.33: the search whiffs on an empty deck, but *"Then, shuffle your deck"* is a
  // separate printed instruction whose object survives — so the shuffle is still owed.
  if (player.deck.cards.length === 0) {
    return SHUFFLE_DECK(store, state, player);
  }

  // TA-123: "attach them to 1 of your Pokémon" includes the ACTIVE, so the rider must run even with
  // an empty bench — the attach-target prompt below already offers SlotType.ACTIVE. (Previously an
  // `!hasBenched` early-return dropped the whole search/attach/shuffle rider on a benchless board.)
  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_HAND,
    player.deck,
    { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
    { min: 0, max: 2, allowCancel: false }
  ), selected => {
    cards = selected || [];
    next();
  });

  if (cards.length > 0) {
    yield store.prompt(state, new ChoosePokemonPrompt(
      player.id,
      GameMessage.CHOOSE_POKEMON_TO_ATTACH_CARDS,
      PlayerType.BOTTOM_PLAYER,
      [SlotType.ACTIVE, SlotType.BENCH],
      { allowCancel: false }
    ), targets => {
      if (!targets || targets.length === 0) {
        return;
      }
      const target = targets[0];
      player.deck.moveCardsTo(cards, target);
      next();
    });
  }

  return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
    player.deck.applyOrder(order);
  });
}

export class Flareonex extends PokemonCard {
  public tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Eevee';
  public cardType: CardType = R;
  public hp: number = 270;
  public weakness = [{ type: W }];
  public retreat = [C, C];

  public attacks = [{
    name: 'Burning Charge',
    cost: [R, C],
    damage: 130,
    text: 'Search your deck for up to 2 Basic Energy and attach them to 1 of your Pokemon. Then, shuffle your deck.'
  },
  {
    name: 'Carnelian',
    cost: [R, W, L],
    damage: 280,
    text: 'During your next turn, this Pokemon can\'t attack.'
  }];

  public regulationMark: string = 'H';
  public set: string = 'PRE';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '14';
  public name: string = 'Flareon ex';
  public fullName: string = 'Flareon ex PRE';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Burning Charge — post-damage search/attach/shuffle rider (family A): the 130 lands first
    // (rulebook step F), then the search-and-attach chain (TA-128). The trailing shuffle (CF-9) still
    // fires because the deck is always searched. The rider runs on a benchless board too (TA-123 —
    // "attach to 1 of your Pokémon" includes the Active).
    if (AFTER_ATTACK(effect, 0, this)) {
      const generator = useBurningCharge(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    // Carnelian
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      player.active.cannotAttackNextTurnPending = true;
    }

    if (effect instanceof PutDamageEffect && effect.target.cards.includes(this) && effect.target.getPokemonCard() === this) {
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