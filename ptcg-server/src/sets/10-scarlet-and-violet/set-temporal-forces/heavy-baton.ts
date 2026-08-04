import { TrainerCard } from '../../../game/store/card/trainer-card';
import { EnergyType, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils, GamePhase, CardList, AttachEnergyPrompt, GameMessage, PlayerType, SlotType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { IS_TOOL_BLOCKED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';


export class HeavyBaton extends TrainerCard {

  public regulationMark = 'H';

  public trainerType: TrainerType = TrainerType.TOOL;

  public set: string = 'TEF';

  public name: string = 'Heavy Baton';

  public fullName: string = 'Heavy Baton PAR';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '151';

  public text: string =
    'If the Pokémon this card is attached to has a Retreat Cost of 4 or higher, is in the Active Spot, and is Knocked Out by damage from an attack from your opponent\'s Pokémon, move up to 3 Basic Energy cards from that Pokémon to your Benched Pokémon in any way you like.';

  public readonly HEAVY_BATON_MARKER = 'HEAVY_BATON_MARKER';

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

      if (active.marker.hasMarker(this.HEAVY_BATON_MARKER)) {
        return state;
      }

      // Check if this tool is attached to the active Pokemon
      if (!active.tools.includes(this)) {
        return state;
      }

      // Check if the Pokemon has a retreat cost of 4 or higher
      const pokemonCard = active.getPokemonCard();
      if (!pokemonCard || pokemonCard.retreat.length < 4) {
        return state;
      }

      // Get all basic energy cards from the active Pokemon
      const basicEnergyCards = active.cards.filter(c => c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC);

      if (basicEnergyCards.length === 0) {
        return state;
      }

      // TA-170 face C. The destination is "your Benched Pokemon", so with an EMPTY Bench there is no
      // legal destination and the effect can achieve nothing — #925 ("you cannot ... do what the card
      // is supposed to do at that moment"). This guard is also what makes the `min: 1` below safe:
      // a floor of 1 with no reachable destination is the TA-178 unanswerable-prompt shape, so the
      // two changes are a pair and must not be split.
      const hasBench = player.bench.some(b => b.cards.length > 0);
      if (!hasBench) {
        return state;
      }

      // Add marker, do not invoke this effect for other wishful batons
      active.marker.addMarker(this.HEAVY_BATON_MARKER, this);

      // Make copy of the basic energy cards, because they will be transferred to discard shortly
      const energyToAttach = new CardList();
      energyToAttach.cards = basicEnergyCards.slice();

      state = store.prompt(state, new AttachEnergyPrompt(
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
        { allowCancel: false, min: 1, max: 3, sameTarget: true }
      ), transfers => {
        transfers = transfers || [];
        active.marker.removeMarker(this.HEAVY_BATON_MARKER);

        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          MOVE_CARDS(store, state, player.discard, target, { cards: [transfer.card] });
        }
      });
    }

    return state;
  }
}