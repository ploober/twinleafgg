import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import {
  StoreLike,
  Card,
  State,
  ChooseCardsPrompt,
  ChoosePokemonPrompt,
  PlayerType,
  SlotType,
  ShuffleDeckPrompt,
  StateUtils,
  ConfirmPrompt,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { DiscardCardsEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { GameMessage } from '../../../game/game-message';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { ChooseEnergyPrompt } from '../../../game/store/prompts/choose-energy-prompt';
import { DAMAGE_OPPONENT_POKEMON, WAS_ATTACK_USED, APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS } from '../../../game/store/prefabs/prefabs';

export class Greninjaex extends PokemonCard {
  public tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public regulationMark = 'H';
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Frogadier';
  public cardType = F;
  public hp: number = 310;
  public weakness = [{ type: P }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Shinobi Blade',
      cost: [W],
      damage: 170,
      text: 'You may search your deck for a card and put it into your hand. Then, shuffle your deck.',
    },
    {
      name: 'Mirage Barrage',
      cost: [W, C, C],
      damage: 0,
      text: "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    },
  ];

  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '106';
  public name: string = 'Greninja ex';
  public fullName: string = 'Greninja ex TWM';

  public usedMirageBarrage: boolean = false;

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-83: apply the 170 base damage before the optional search rider (rulebook Step F; #543/#649).
      state = APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS(store, state, effect);

      // TA-97: the search is "you may" (optional) — never block the attack; the 170 always lands
      // (was: throw CANNOT_USE_POWER, #1106/#1458). The "you may" choice is part of resolving the
      // attack and is OFFERED even with an empty deck (the cross-engine re-fuzz showed rotomancer
      // correctly presents the confirm before the KO check); only the search body no-ops when the
      // deck is empty, so we still prompt but guard the ChooseCards with deck.cards.length > 0.
      state = store.prompt(
        state,
        new ConfirmPrompt(effect.player.id, GameMessage.SEARCH_DECK_FOR_CARD),
        (wantToUse) => {
          if (!wantToUse) {
            return;
          }
          // Opted in: "Then, shuffle your deck" ALWAYS happens once you choose to search — even on an
          // empty deck (nothing to find, but the shuffle still occurs). rotomancer emits the shuffled
          // event here and the cross-engine re-fuzz flagged twinleaf for omitting it; only the
          // search-for-a-card (ChooseCards) is skipped when the deck is empty.
          const shuffle = (s: State): State =>
            store.prompt(s, new ShuffleDeckPrompt(player.id), (order) => {
              player.deck.applyOrder(order);
            });
          if (player.deck.cards.length === 0) {
            return shuffle(state);
          }
          return store.prompt(
            state,
            new ChooseCardsPrompt(
              player,
              GameMessage.CHOOSE_CARD_TO_HAND,
              player.deck,
              {},
              { min: 1, max: 1, allowCancel: false },
            ),
            (cards) => {
              player.deck.moveCardsTo(cards, player.hand);
              return shuffle(state);
            },
          );
        },
      );
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
      state = store.reduceEffect(state, checkProvidedEnergy);

      state = store.prompt(
        state,
        new ChooseEnergyPrompt(
          player.id,
          GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
          checkProvidedEnergy.energyMap,
          [CardType.COLORLESS, CardType.COLORLESS],
          { allowCancel: false },
        ),
        (energy) => {
          const max = Math.min(2);
          return store.prompt(
            state,
            new ChoosePokemonPrompt(
              player.id,
              GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
              PlayerType.TOP_PLAYER,
              [SlotType.ACTIVE, SlotType.BENCH],
              { min: 1, max: max, allowCancel: false },
            ),
            (selected) => {
              const targets = selected || [];
              DAMAGE_OPPONENT_POKEMON(store, state, effect, 120, targets);
              const cards: Card[] = (energy || []).map((e) => e.card);
              const discardEnergy = new DiscardCardsEffect(effect, cards);
              discardEnergy.target = player.active;
              store.reduceEffect(state, discardEnergy);
            },
          );
        },
      );
    }

    if (
      effect instanceof PutDamageEffect &&
      effect.target.cards.includes(this) &&
      effect.target.getPokemonCard() === this
    ) {
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
