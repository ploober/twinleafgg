import { CardType, Stage } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { PokemonCard, StoreLike, State, StateUtils } from '../../../game';
import { AFTER_ATTACK, CONFIRMATION_PROMPT } from '../../../game/store/prefabs/prefabs';
import { AttachEnergyPrompt } from '../../../game/store/prompts/attach-energy-prompt';
import { SuperType } from '../../../game/store/card/card-types';
import { GameMessage } from '../../../game/game-message';
import { PlayerType } from '../../../game/store/actions/play-card-action';
import { SlotType } from '../../../game/store/actions/play-card-action';

export class Meowstic extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Espurr';
  public hp: number = 100;
  public cardType: CardType[] = [P];
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Tricky Steps',
      cost: [P, C],
      damage: 80,
      text: "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon. ",
    },
  ];

  public regulationMark = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '37';
  public name: string = 'Meowstic';
  public fullName: string = 'Meowstic M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
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
      const opponent = StateUtils.getOpponent(state, player);

      // CF-32 second class (PINNED 2026-07-28), the count-1 arm, quoted because this card is the rule's
      // own worked example by text: *"when the effect has no inherent zero (\"you may move AN Energy\" --
      // a fixed count-1, the gate is the only decline), it STAYS a standalone confirm {true,false}.
      // Jamming Wing dri-070 (count-1) -- which is exactly why BOTH engines already externalise it."*
      // `dri-070` prints THIS EXACT rider and is already written this way; this card was not, so twinleaf
      // inlined the decline as a `confirm{false}` option inside a flat min:0 object pick while rotomancer
      // externalised the gate. Same rule, two shapes, one repo. Made to match its sibling.
      //
      // The two eligibility guards are LOAD-BEARING for the new shape, not an optimisation: with the gate
      // externalised the inner pick is min:1, so a board with nothing to move would offer a confirm that
      // cannot be honoured. CF-33: a `may` whose effect can achieve NOTHING presents no decision at all.
      // Both conditions read zones OPEN to the acting player (the opponent's Active's attached Energy and
      // their Bench are public), so suppressing on them leaks nothing -- CF-33 Boundary 1.
      const hasBench = opponent.bench.some((b) => b.cards.length > 0);
      const hasEnergy = opponent.active.cards.some((c) => c.superType === SuperType.ENERGY);
      if (!hasBench || !hasEnergy) {
        return state;
      }

      CONFIRMATION_PROMPT(store, state, player, result => {
        if (result) {
          return store.prompt(
            state,
            new AttachEnergyPrompt(
              player.id,
              GameMessage.ATTACH_ENERGY_TO_BENCH,
              opponent.active,
              PlayerType.TOP_PLAYER,
              [SlotType.BENCH],
              { superType: SuperType.ENERGY },
              { allowCancel: false, min: 1, max: 1 },
            ),
            (transfers) => {
              const list = transfers || [];
              for (const t of list) {
                // TA-147: resolve the destination in the PROMPT's frame -- `player` -- not `opponent`.
                // The prompt is built with player.id + PlayerType.TOP_PLAYER, so `t.to` already means
                // "the opponent's side as seen by the attacker"; passing `opponent` flips it twice and
                // lands the Energy on the ATTACKER's bench, i.e. the attacker STEALS it.
                const target = StateUtils.getTarget(state, player, t.to);
                opponent.active.moveCardTo(t.card, target);
              }
            },
          );
        }
      });
    }
    return state;
  }
}
