import { GameMessage } from '../../../game/game-message';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType, SuperType, EnergyType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State, GamePhase } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { AttachEnergyPrompt } from '../../../game/store/prompts/attach-energy-prompt';
import { PlayerType, SlotType, CardTarget } from '../../../game/store/actions/play-card-action';
import { StateUtils } from '../../../game/store/state-utils';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { IS_TOOL_BLOCKED } from '../../../game/store/prefabs/prefabs';
import { ConfirmPrompt } from '../../../game/store/prompts/confirm-prompt';
import { EnergyCard } from '../../../game/store/card/energy-card';

export class ExpShare extends TrainerCard {
  public regulationMark = 'G';

  protected _trainerType: TrainerType = TrainerType.TOOL;

  public set: string = 'SVI';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '174';

  public name: string = 'Exp. Share';

  public fullName: string = 'Exp. Share SVI';

  public text: string =
    "When your Active Pokemon is Knocked Out by damage from an opponent's " +
    'attack, you may move 1 basic Energy card that was attached to that ' +
    'Pokemon to the Pokemon this card is attached to.';

  public readonly EXP_SHARE_MARKER: string = 'EXP_SHARE_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof KnockOutEffect && effect.target === effect.player.active) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const active = effect.target;

      if (IS_TOOL_BLOCKED(store, state, player, this)) {
        return state;
      }

      // Do not activate between turns, or when it's not opponents turn.
      if (state.phase !== GamePhase.ATTACK || state.players[state.activePlayer] !== opponent) {
        return state;
      }

      // TA-475 / CF-32: each Exp. Share is its own trigger with a count-1 "you may" (no inherent zero), so it
      // asks a standalone confirm{true,false} and, on yes, moves exactly 1 basic Energy to ITS OWN holder (a single
      // candidate collapses, CF-14). The old single allowCancel:true prompt pooled every holder and hid the decline.
      let holder: PokemonCardList | undefined;
      const blockedTo: CardTarget[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
        if (cardList !== effect.target && cardList.tools.includes(this)) {
          holder = cardList;
        } else {
          blockedTo.push(target);
        }
      });
      const receiver = holder;
      if (receiver === undefined || receiver === player.active) {
        return state;
      }

      const hasBasicEnergy = active.cards.some(c => c instanceof EnergyCard && c.energyType === EnergyType.BASIC);
      if (!hasBasicEnergy) {
        return state;
      }

      return store.prompt(state, new ConfirmPrompt(player.id, GameMessage.WANT_TO_USE_ABILITY), wantToUse => {
        if (!wantToUse) {
          return state;
        }
        // Make copy of the active pokemon cards, because they will be transfered to discard shortly
        const activeCopy = new PokemonCardList();
        activeCopy.cards = active.cards.slice();
        return store.prompt(state, new AttachEnergyPrompt(
          player.id,
          GameMessage.ATTACH_ENERGY_TO_BENCH,
          activeCopy,
          PlayerType.BOTTOM_PLAYER,
          [SlotType.BENCH],
          { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
          { allowCancel: false, min: 1, max: 1, blockedTo }
        ), transfers => {
          for (const transfer of transfers || []) {
            // TA-445: move the Energy FROM WHEREVER IT IS. This read `player.discard`
            // unconditionally, which was correct only while the Knock Out discard ran BEFORE this
            // prompt was answered. TA-441 ordered the KO window properly, so the Energy is still
            // attached to the dying holder when the player answers: the discard read matched
            // nothing and the decision resolved to nothing.
            const from = active.cards.includes(transfer.card) ? active : player.discard;
            from.moveCardTo(transfer.card, receiver);
          }
        });
      });
    }

    return state;
  }
}
