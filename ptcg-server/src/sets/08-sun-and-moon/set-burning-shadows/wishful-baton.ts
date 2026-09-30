import { GameMessage } from '../../../game/game-message';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType, SuperType, EnergyType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State, GamePhase } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { AttachEnergyPrompt } from '../../../game/store/prompts/attach-energy-prompt';
import { CardTarget, PlayerType, SlotType } from '../../../game/store/actions/play-card-action';
import { StateUtils } from '../../../game/store/state-utils';
import { IS_TOOL_BLOCKED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { CardList } from '../../../game/store/state/card-list';

export class WishfulBaton extends TrainerCard {

  public trainerType: TrainerType = TrainerType.TOOL;

  public set: string = 'BUS';

  public name: string = 'Wishful Baton';

  public fullName: string = 'Wishful Baton BUS';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '128';

  public text: string =
    'If the Pokémon this card is attached to is your Active Pokémon and is Knocked Out by damage from an opponent\'s attack, move up to 3 basic Energy cards from that Pokémon to 1 of your Benched Pokémon.';

  public readonly WISHFUL_BATON_MARKER: string = 'WISHFUL_BATON_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof KnockOutEffect && effect.target.tools.includes(this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const active = effect.target;

      if (IS_TOOL_BLOCKED(store, state, player, this)) { return state; }

      // Do not activate between turns, or when it's not opponents turn.
      if (state.phase !== GamePhase.ATTACK || state.players[state.activePlayer] !== opponent) {
        return state;
      }

      if (active.marker.hasMarker(this.WISHFUL_BATON_MARKER)) {
        return state;
      }

      // Check if this tool is attached to the active Pokemon
      if (!active.tools.includes(this)) {
        return state;
      }

      // Get all basic energy cards from the active Pokemon
      const basicEnergyCards = active.cards.filter(c => c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC);

      if (basicEnergyCards.length === 0) {
        return state;
      }

      // Add marker, do not invoke this effect for other wishful batons
      active.marker.addMarker(this.WISHFUL_BATON_MARKER, this);

      // TA-441: the HOLDER ITSELF is not a destination. "to 1 of your Benched Pokemon" cannot mean the
      // card the Energy is already attached to, and a holder Knocked Out ON the Bench — or pushed there
      // by the attack that Knocked it out — occupies a Bench slot at this step. That was invisible
      // while the KO discard ran before the prompt (the holder was simply off the board by then).
      const blockedTo: CardTarget[] = [];
      player.bench.forEach((b, index) => {
        if (b === active) {
          blockedTo.push({ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index });
        }
      });

      // Make copy of the basic energy cards, because the prompt reads a detached list
      const energyToAttach = new CardList();
      energyToAttach.cards = basicEnergyCards.slice();

      state = store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        energyToAttach,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { allowCancel: true, min: 0, max: 3, sameTarget: true, blockedTo }
      ), transfers => {
        transfers = transfers || [];
        active.marker.removeMarker(this.WISHFUL_BATON_MARKER);

        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          // TA-441: move the Energy FROM WHEREVER IT IS. This read `player.discard` unconditionally,
          // which was written for an engine that discarded the Knocked Out Pokemon and everything
          // attached to it BEFORE this prompt was answered ("they will be transferred to discard
          // shortly"). With the KO window correctly ordered the Energy is still attached to the dying
          // holder when the player answers, so the discard read moved nothing at all and the Energy
          // then went to the discard with its bearer — the decision was offered and silently dropped.
          // Measured by the targeted re-fuzz, not by the suite: every guard on this card asserts the
          // OFFER and none of them drives the pick.
          const from = active.cards.includes(transfer.card) ? active : player.discard;
          MOVE_CARDS(store, state, from, target, { cards: [transfer.card] });
        }
      });
    }

    return state;
  }
}