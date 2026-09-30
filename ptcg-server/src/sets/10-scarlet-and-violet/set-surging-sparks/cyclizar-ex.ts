import { PokemonCard } from '../../../game/store/card/pokemon-card';
import {
  StoreLike,
  State,
  StateUtils,
  CardTag,
  CardType,
  Stage,
  GameMessage,
  ConfirmPrompt,
  ChoosePokemonPrompt,
  PlayerType,
  SlotType,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { AFTER_ATTACK, WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Cyclizarex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [C];
  public hp: number = 210;
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Break Through',
      cost: [C, C, C],
      damage: 130,
      text: "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    },
    {
      name: 'Zircon Road',
      cost: [G, R, P],
      damage: 180,
      text: 'You may draw 5 cards.',
    },
  ];

  public set: string = 'SSP';
  public regulationMark = 'H';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '159';
  public name: string = 'Cyclizar ex';
  public fullName: string = 'Cyclizar ex SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Break Through
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const hasBenched = opponent.bench.some((b) => b.cards.length > 0);
      if (!hasBenched) {
        return state;
      }

      return store.prompt(
        state,
        new ChoosePokemonPrompt(
          player.id,
          GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
          PlayerType.TOP_PLAYER,
          [SlotType.BENCH],
          { allowCancel: false },
        ),
        (targets) => {
          if (!targets || targets.length === 0) {
            return;
          }
          const damageEffect = new PutDamageEffect(effect, 30);
          damageEffect.target = targets[0];
          store.reduceEffect(state, damageEffect);
        },
      );
    }

    // Zircon Road — post-damage draw rider (family A): "You may draw 5" runs AFTER the 180 lands (TA-128).
    if (AFTER_ATTACK(effect, 1, this)) {
      const player = effect.player;

      // CF-33 (pinned 2026-07-29): a `may` whose effect can achieve NOTHING presents NO decision —
      // both branches leave an identical board, so by CF-14 it has exactly one resolution and collapses.
      // Rotomancer suppresses; twinleaf was offering a phantom `confirm{true,false}`. The condition
      // reads the acting player's OWN hand and deck, which are open to them, so suppressing on it leaks
      // nothing (CF-33 Boundary 1). Only the DECK arm applies here: *"draw 5 cards"* is a
      // fixed count with no hand target, so it is zero-achievable exactly when the deck is empty. Shape copied from `cynthias-garchomp-ex.ts`
      // Corkscrew Dive, which already carries it and is the in-class positive control — the correct
      // form is expressible, so this is a per-card omission and not a framework gap.
      // Found by the mandated TA-307 re-fuzz: the step-F fix let the walk past the first attack, so
      // a SECOND use on a board the first use had drawn down became reachable at all.
      // [[collapse-fix-widens-fuzzer-reach]]
      if (player.deck.cards.length === 0) {
        return state;
      }

      state = store.prompt(state, new ConfirmPrompt(
        player.id,
        GameMessage.WANT_TO_USE_ABILITY,
      ), wantToUse => {
        if (wantToUse) {
          MOVE_CARDS(store, state, player.deck, player.hand, { count: 5, sourceCard: this });
        }
      });
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
