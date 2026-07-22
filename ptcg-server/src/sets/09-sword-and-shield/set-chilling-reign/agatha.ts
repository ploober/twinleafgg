import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { StateUtils } from '../../../game/store/state-utils';
import { PlayerType, SlotType } from '../../../game/store/actions/play-card-action';
import { DamageMap, MoveDamagePrompt } from '../../../game/store/prompts/move-damage-prompt';
import { GameMessage } from '../../../game/game-message';
import { TrainerCard, TrainerType } from '../../../game';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';

export class Agatha extends TrainerCard {

  public regulationMark = 'E';

  public trainerType: TrainerType = TrainerType.SUPPORTER;

  public set: string = 'CRE';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '129';

  public name: string = 'Agatha';

  public fullName: string = 'Agatha CRE';

  public text: string =
    'Move up to 3 damage counters from your Active Pokémon to your opponent\'s Active Pokémon.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Nothing to move if your Active Pokemon carries no damage, or the opponent has no Active to receive it.
      if (player.active.damage <= 0 || opponent.active.cards.length === 0) {
        return state;
      }

      // MoveDamagePrompt's `maxAllowedDamage` is the SOURCE set (Pokemon damage moves FROM), capped at the
      // damage currently on each; `playerType`/`slots` are the DESTINATION set. Agatha moves FROM your
      // Active TO the opponent's Active, so the source is your Active and the destination is TOP_PLAYER ACTIVE.
      const maxAllowedDamage: DamageMap[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
        if (cardList === player.active) {
          maxAllowedDamage.push({ target, damage: player.active.damage });
        }
      });

      player.hand.moveCardTo(effect.trainerCard, player.supporter);
      // We will discard this card after prompt confirmation
      effect.preventDefault = true;

      // PlayerType.ANY (not TOP_PLAYER): the move is cross-player (your Active -> opponent's Active), and
      // MoveDamagePrompt.validate rejects a non-ANY playerType unless BOTH ends match it. With ANY + [ACTIVE]
      // the source is your Active (the sole maxAllowedDamage entry) and the only other Active — the
      // destination the decomposer offers after excluding the source — is the opponent's.
      return store.prompt(state, new MoveDamagePrompt(
        player.id,
        GameMessage.MOVE_DAMAGE,
        PlayerType.ANY,
        [SlotType.ACTIVE],
        maxAllowedDamage,
        { min: 0, max: 3, allowCancel: false, singleSourceTarget: true, singleDestinationTarget: true }
      ), transfers => {
        transfers = transfers || [];
        for (const transfer of transfers) {
          const source = StateUtils.getTarget(state, player, transfer.from);
          const target = StateUtils.getTarget(state, player, transfer.to);
          if (source.damage >= 10) {
            source.damage -= 10;
            target.damage += 10;
          }
        }
        player.supporter.moveCardTo(this, player.discard);
        return state;
      });
    }

    return state;
  }

}
