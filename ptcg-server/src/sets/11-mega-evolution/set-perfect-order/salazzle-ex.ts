import { PokemonCard, Stage, CardTag, CardType, StoreLike, State, ChooseCardsPrompt, GameMessage, ShuffleDeckPrompt, ChoosePokemonPrompt, PlayerType, SlotType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AfterAttackEffect } from '../../../game/store/effects/game-phase-effects';
import { YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_BURNED, YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_POISIONED } from '../../../game/store/prefabs/attack-effects';
import { WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Salazzleex extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Salandit';
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [R];
  public hp: number = 260;
  public weakness = [{ type: W }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Nasty Plot',
      cost: [R],
      damage: 0,
      text: 'Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.',
    },
    {
      name: 'Dire Nails',
      cost: [R, R],
      damage: 100,
      text: "Your opponent's Active Pokémon is now Burned and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.",
    },
  ];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '16';
  public name: string = 'Salazzle ex';
  public fullName: string = 'Salazzle ex M3';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Nasty Plot - Search deck for up to 2 cards
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-126/CF-9: an empty deck is still a deck you searched — you looked at zero cards and found
      // nothing, which compendium #2171 treats exactly like a voluntary fail: *"you must search and
      // shuffle your deck."* Nasty Plot searches for "up to 2 cards" with no restriction on kind and
      // no destination requirement, so the search instruction is always executable and the trailing
      // shuffle is always owed. Bailing here emitted no `shuffled` at all.
      //
      // This is NOT the RE-38/TA-97 over-shuffle case: that one is a search whose payload has nowhere
      // to GO (an attach with an empty Bench), where per #1108/RE-32 no search happens and no shuffle
      // is owed. The discriminator is whether the search instruction can run at all, not whether it
      // finds anything.
      if (player.deck.cards.length === 0) {
        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      }

      const maxCards = Math.min(2, player.deck.cards.length);
      let cards: any[] = [];

      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck,
        {},
        // TA-163 / compendium #2315, this exact attack: "If I use 'Nasty Plot' and don't find a card
        // that I want in my deck, can I choose to take zero cards? — No, you have to take at least
        // one card if there are any cards in your deck." An UNTYPED search ("up to 2 cards", kind
        // unspecified) floors at 1 — #2301's exception clause — and being inside an ATTACK does not
        // buy back the zero: the attack licence covers "up to X", the untyped carve-out is the
        // exception to it, so the carve-out is checked first. `Math.min(1, …)` keeps it satisfiable
        // if the deck somehow holds nothing.
        { min: Math.min(1, maxCards), max: maxCards, allowCancel: false }
      ), selected => {
        cards = selected || [];
        MOVE_CARDS(store, state, player.deck, player.hand, { cards: cards, sourceCard: this });
        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      });
    }

    // Fatal Nail - Poison + Burn
    if (WAS_ATTACK_USED(effect, 1, this)) {
      // TA-167 / SD-6: both conditions come from the SAME attack, so both must travel the attack
      // route. ADD_BURN_TO_PLAYER_ACTIVE builds an AddSpecialConditionsPowerEffect, which carries no
      // attack identity — so "prevent all effects of attacks" guards (Mist Energy) could not see the
      // Burn and prevented only the Poison. One attack, one target, one instant, two outcomes.
      YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_POISIONED(store, state, effect);
      YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_BURNED(store, state, effect);
    }

    // Fatal Nail - Switch (after attack)
    if (effect instanceof AfterAttackEffect && effect.attack === this.attacks[1]) {
      const player = effect.player;

      // Switch this Pokemon with benched Pokemon
      const hasBench = player.bench.some((b) => b.cards.length > 0);
      if (hasBench) {
        return store.prompt(
          state,
          new ChoosePokemonPrompt(
            player.id,
            GameMessage.CHOOSE_POKEMON_TO_SWITCH,
            PlayerType.BOTTOM_PLAYER,
            [SlotType.BENCH],
            { allowCancel: false },
          ),
          (selected) => {
            const targets = selected || [];
            if (targets.length > 0) {
              player.active.clearEffects();
              player.switchPokemon(targets[0]);
            }
          },
        );
      }
    }

    return state;
  }
}
