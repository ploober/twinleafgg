import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { ConfirmPrompt, GameMessage, StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK, DRAW_CARDS_UNTIL_CARDS_IN_HAND } from '../../../game/store/prefabs/prefabs';

export class Deoxys4 extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = P;
  public hp: number = 100;
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [];

  public attacks = [
    {
      name: 'Psyspeed',
      cost: [P],
      damage: 30,
      text: 'You may draw cards until you have 5 cards in your hand.',
    },
  ];

  public regulationMark: string = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '34';
  public name: string = 'Deoxys';
  public fullName: string = 'Deoxys M4 34';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Attack: Psy Speed - optional draw until 5 cards
    // Ref: set-chilling-reign/tapu-fini.ts (optional effect with ConfirmPrompt)
    if (AFTER_ATTACK(effect, 0, this)) {
      // TA-307 / TA-128 family A. Rulebook attack step F, compendium #543 ("Do damage first,
      // then apply effects") and #649 ("Like all attacks that don't explicitly say otherwise, the
      // effects of attacks are not applied until after damage is done", TPCi Rules Team 2015-05-07):
      // this rider PAUSES, so the base damage must already be on the board when it does. Written on
      // WAS_ATTACK_USED the rider ran inside the pre-damage block and the game paused showing the
      // defender at dmg=0 -- a mid-resolution divergence the end board never shows, which is why
      // nothing downstream reported it. AFTER_ATTACK is dispatched by the attack pipeline AFTER
      // DealDamage and BEFORE the KO sweep (game-effect.ts), which is exactly step F's order --
      // so this does not trade TA-79 (damage deferred) for TA-123 (rider dropped past the KO).
      const player = effect.player;

      // CF-33 (pinned 2026-07-29): a `may` whose effect can achieve NOTHING presents NO decision —
      // both branches leave an identical board, so by CF-14 it has exactly one resolution and collapses.
      // Rotomancer suppresses; twinleaf was offering a phantom `confirm{true,false}`. The condition
      // reads the acting player's OWN hand and deck, which are open to them, so suppressing on it leaks
      // nothing (CF-33 Boundary 1). BOTH arms are needed: at hand >= target there is nothing to draw
      // toward, and at deck 0 there is nothing to draw. Shape copied from `cynthias-garchomp-ex.ts`
      // Corkscrew Dive, which already carries it and is the in-class positive control — the correct
      // form is expressible, so this is a per-card omission and not a framework gap.
      // Found by the mandated TA-307 re-fuzz: the step-F fix let the walk past the first attack, and
      // the SECOND use (hand already at 6) is where it showed. [[collapse-fix-widens-fuzzer-reach]]
      if (player.hand.cards.length >= 5 || player.deck.cards.length === 0) {
        return state;
      }

      return store.prompt(
        state,
        new ConfirmPrompt(player.id, GameMessage.WANT_TO_DRAW_CARDS),
        (wantToDraw) => {
          if (wantToDraw) {
            DRAW_CARDS_UNTIL_CARDS_IN_HAND(player, 5);
          }
        },
      );
    }

    return state;
  }
}
