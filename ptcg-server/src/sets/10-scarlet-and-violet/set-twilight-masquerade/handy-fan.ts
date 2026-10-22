import { TrainerCard } from '../../../game/store/card/trainer-card';
import { SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State, GamePhase } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { AfterDamageEffect } from '../../../game/store/effects/attack-effects';
import { StateUtils } from '../../../game/store/state-utils';
import { AttachEnergyPrompt, GameMessage, PlayerType, SlotType } from '../../../game';
import { ToolEffect } from '../../../game/store/effects/play-card-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class HandyFan extends TrainerCard {
  public regulationMark = 'H';
  protected _trainerType: TrainerType = TrainerType.TOOL;
  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '150';
  public name = 'Handheld Fan';
  public fullName = 'Handheld Fan TWM';

  public text: string =
    "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), move an Energy from the Attacking Pokémon to 1 of your opponent's Benched Pokémon.";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof AfterDamageEffect && effect.target.tools.includes(this)) {
      const player = effect.player;
      const targetPlayer = StateUtils.findOwner(state, effect.target);

      if (effect.damage <= 0 || player === targetPlayer || targetPlayer.active !== effect.target) {
        return state;
      }

      // Try to reduce ToolEffect, to check if something is blocking the tool from working
      try {
        const stub = new ToolEffect(effect.player, this);
        store.reduceEffect(state, stub);
      } catch {
        return state;
      }

      if (state.phase === GamePhase.ATTACK) {
        const player = effect.player;
        const opponent = StateUtils.getOpponent(state, player);
        // TA-187: "1 of your opponent's Benched Pokémon" — "your" is the Tool's owner, so the destination is the
        // ATTACKER's Bench (`player` here is the attacking player).
        const hasBench = player.bench.some((b) => b.cards.length > 0);

        if (hasBench === false) {
          return state;
        }

        // Nothing to move if the attacking Pokémon carries no Energy (cf. turtonator.ts).
        const attackingPokemon = effect.source || player.active;
        if (attackingPokemon.energies.cards.length === 0) {
          return state;
        }

        return store.prompt(
          state,
          new AttachEnergyPrompt(
            opponent.id,
            GameMessage.ATTACH_ENERGY_TO_BENCH,
            attackingPokemon,
            PlayerType.TOP_PLAYER,
            [SlotType.BENCH],
            { superType: SuperType.ENERGY },
            // TA-187: "move an Energy" has no "may" and no "up to": mandatory once it triggers (§B.18 / #2301).
            { allowCancel: false, min: 1, max: 1 },
          ),
          (transfers) => {
            transfers = transfers || [];
            for (const transfer of transfers) {
              const target = StateUtils.getTarget(state, opponent, transfer.to);
              MOVE_CARDS(store, state, attackingPokemon, target, {
                cards: [transfer.card],
                sourceCard: this,
              });
            }
          },
        );
      }
    }
    return state;
  }
}
