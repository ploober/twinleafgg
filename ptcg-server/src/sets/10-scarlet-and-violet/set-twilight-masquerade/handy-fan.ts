import { TrainerCard } from '../../../game/store/card/trainer-card';
import { SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State, GamePhase } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { AfterDamageEffect } from '../../../game/store/effects/attack-effects';
import { StateUtils } from '../../../game/store/state-utils';
import { AttachEnergyPrompt, GameMessage, PlayerType, SlotType } from '../../../game';
import { ToolEffect } from '../../../game/store/effects/play-card-effects';


export class HandyFan extends TrainerCard {
  public regulationMark = 'H';
  public trainerType: TrainerType = TrainerType.TOOL;
  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '150';
  public name = 'Handheld Fan';
  public fullName = 'Handheld Fan TWM';

  public text: string = 'Whenever the Active Pokémon this card is attached to takes damage from an opponent\'s attack, move an Energy from the attacking Pokémon to 1 of your opponent\'s Benched Pokémon.';

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

        // TA-187: "move an Energy from the attacking Pokémon to 1 of **your opponent's** Benched
        // Pokémon". "Your" is the TOOL'S OWNER, so "your opponent" is the ATTACKER — the Energy
        // moves off the attacking Pokémon and onto the ATTACKER's own Bench. `effect.player` is the
        // attacking player, so `opponent` here is the Tool's owner, and this guard was checking the
        // TOOL OWNER's bench for a destination. On any board where the Tool's owner had an empty
        // Bench the reaction bailed out entirely — even though the attacker had Benched Pokémon
        // perfectly able to receive the Energy. That is the whole defect: the destination
        // resolution below was already correct (`getTarget` flips on `TOP_PLAYER`), only the
        // achievability test looked at the wrong side of the board.
        const hasBench = player.bench.some(b => b.cards.length > 0);

        if (hasBench === false) {
          return state;
        }

        // Nothing to move if the attacking Pokémon carries no Energy (cf. turtonator.ts).
        const attackingPokemon = effect.source || player.active;
        if (attackingPokemon.energies.cards.length === 0) {
          return state;
        }

        return store.prompt(state, new AttachEnergyPrompt(
          opponent.id,
          GameMessage.ATTACH_ENERGY_TO_BENCH,
          attackingPokemon,
          PlayerType.TOP_PLAYER,
          [SlotType.BENCH],
          { superType: SuperType.ENERGY },
          // TA-187: was `min: 0`, which offered a decline. The text is "move an Energy" with no
          // "may" and no "up to", so the move is MANDATORY once the trigger fires — §B.18/#2301.
          // Rotomancer offers no `confirm{false}` here either.
          { allowCancel: false, min: 1, max: 1 }
        ), transfers => {
          transfers = transfers || [];
          for (const transfer of transfers) {
            // `opponent` is the Tool's owner and `transfer.to.player` is TOP_PLAYER, so getTarget
            // flips to the ATTACKER's bench — the correct destination.
            const target = StateUtils.getTarget(state, opponent, transfer.to);
            attackingPokemon.moveCardTo(transfer.card, target);
          }
        });
      }
    }
    return state;
  }
}
