import { TrainerCard } from '../../../game/store/card/trainer-card';
import { EnergyType, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils, GamePhase, CardList, AttachEnergyPrompt, GameMessage, PlayerType, SlotType, CardTarget } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { BeginTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { IS_TOOL_BLOCKED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class HeavyBaton extends TrainerCard {
  public regulationMark = 'H';

  protected _trainerType: TrainerType = TrainerType.TOOL;

  public set: string = 'TEF';

  public name: string = 'Heavy Baton';

  public fullName: string = 'Heavy Baton PAR';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '151';

  public text: string =
    "If the Pokémon this card is attached to has a Retreat Cost of 4 or higher, is in the Active Spot, and is Knocked Out by damage from an attack from your opponent's Pokémon, move up to 3 Basic Energy cards from that Pokémon to your Benched Pokémon in any way you like.";

  public readonly HEAVY_BATON_MARKER = 'HEAVY_BATON_MARKER';

  /**
   * TA-170 / #1992. "is in the Active Spot … and is Knocked Out by damage from an attack" is read at
   * the moment the damage LANDS, not at the deferred Knock Out check — *"even though you don't check
   * for a KO until the attack is completed, the criteria for using Heavy Baton has been met, so it can
   * be used."* So the criterion is ARMED here and READ at the KnockOutEffect: a holder damaged while
   * Active and then pushed to the Bench by the same attack still qualifies, and a holder that was on
   * the Bench when the damage landed never does.
   */
  public readonly HEAVY_BATON_ARMED_MARKER = 'HEAVY_BATON_ARMED_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // Arm the position criterion at damage time (see HEAVY_BATON_ARMED_MARKER).
    if (effect instanceof PutDamageEffect && effect.target.tools.includes(this) && effect.damage > 0) {
      const player = StateUtils.findOwner(state, effect.target);
      const opponent = StateUtils.getOpponent(state, player);
      if (state.phase === GamePhase.ATTACK
        && state.players[state.activePlayer] === opponent
        && effect.target === player.active) {
        // On the PLAYER, not the slot: the criterion is a historical fact about this attack, and a
        // slot's own markers are wiped when the Pokemon leaves the Active Spot — which is exactly what
        // #1992's board does between the damage and the Knock Out (measured: armed, then empty at the
        // read). The marker's SOURCE is this Tool instance, so it names its own holder.
        player.marker.addMarker(this.HEAVY_BATON_ARMED_MARKER, this);
      }
    }

    // The criterion is about ONE attack, so it must not outlive the turn it was armed in — but it must
    // survive to the KO window, and `EndTurnEffect` does NOT: an attack ends the turn and only THEN does
    // `checkState` open the KO window (measured — clearing there wiped the marker before every read).
    // The next turn's start is the first boundary strictly after this turn's KO window and Checkup.
    if (effect instanceof BeginTurnEffect) {
      for (const player of state.players) {
        player.marker.removeMarker(this.HEAVY_BATON_ARMED_MARKER, this);
      }
    }

    if (effect instanceof KnockOutEffect && effect.target.tools.includes(this)) {
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

      if (active.marker.hasMarker(this.HEAVY_BATON_MARKER)) {
        return state;
      }

      // TA-170: "is in the Active Spot", read at the moment the damage landed. Before TA-441 deferred
      // the KO discard past the open prompt, this branch read POSITION NOT AT ALL — its only saving
      // grace was that the holder and its Energy were already in the discard by the time the prompt was
      // answered, which left the destination set empty on every board where the criterion was unmet.
      // With the discard correctly ordered after the reactions that accident is gone, so the criterion
      // has to be checked for real.
      if (!player.marker.hasMarker(this.HEAVY_BATON_ARMED_MARKER, this)) {
        return state;
      }

      // Check if the Pokemon has a retreat cost of 4 or higher
      const pokemonCard = active.getPokemonCard();
      if (!pokemonCard || pokemonCard.retreat.length < 4) {
        return state;
      }

      // Get all basic energy cards from the active Pokemon
      const basicEnergyCards = active.cards.filter(
        (c) => c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC,
      );

      if (basicEnergyCards.length === 0) {
        return state;
      }

      // TA-170 face C. The destination is "your Benched Pokemon", so with no legal destination the
      // effect can achieve nothing — #925 ("you cannot ... do what the card is supposed to do at that
      // moment"). This guard is also what makes the `min: 1` below safe: a floor of 1 with no reachable
      // destination is the TA-178 unanswerable-prompt shape, so the two changes are a pair and must not
      // be split.
      //
      // TA-441: the HOLDER ITSELF is not a destination. A Pokemon pushed to the Bench by the attack
      // that Knocked it out occupies a Bench slot at this step, and the Energy is being moved FROM it
      // — "to your Benched Pokemon" cannot mean back onto the card it is already attached to. This was
      // invisible while the KO discard ran before the prompt (the holder was simply not on the board
      // any more); with the discard deferred it is the difference between the one-Bencher push row
      // offering nothing, as #1992's own reading requires, and offering a self-move.
      const blockedTo: CardTarget[] = [];
      let destinations = 0;
      player.bench.forEach((b, index) => {
        if (b.cards.length === 0) {
          return;
        }
        if (b === active) {
          blockedTo.push({ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index });
          return;
        }
        destinations += 1;
      });
      if (destinations === 0) {
        return state;
      }

      // Add marker, do not invoke this effect for other wishful batons
      active.marker.addMarker(this.HEAVY_BATON_MARKER, this);

      // Make copy of the basic energy cards, because they will be transferred to discard shortly
      const energyToAttach = new CardList();
      energyToAttach.cards = basicEnergyCards.slice();

      state = store.prompt(
        state,
        new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        energyToAttach,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        // TA-170 face C. This was `{ allowCancel: true, min: 0 }`, which offered a decline at ZERO on
        // "move **up to 3** Basic Energy cards". Heavy Baton is a Pokemon **Tool**, i.e. a Trainer card,
        // and #2301 splits the floor by effect type: *"For effects of attacks ... you can choose any
        // number between 0 and the maximum. For other effects (such as the effects of **Trainer cards**
        // and Abilities), you can choose any number between **1** and the maximum."* The attack rule
        // does not reach this — the Baton's effect is the Tool's, not the attacker's. Note the ruling's
        // final clause licenses 0 only for the phrases "any amount"/"any number"; this card says
        // "up to 3", so the floor is 1. Confirmed live 2026-08-03: rotomancer offers no decline here.
        // `allowCancel` goes with it — cancelling is the decline by another name.
        { allowCancel: false, min: 1, max: 3, sameTarget: true, blockedTo }
      ), transfers => {
        transfers = transfers || [];
        active.marker.removeMarker(this.HEAVY_BATON_MARKER);

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
        },
      );
    }

    return state;
  }
}