import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { PowerType, StoreLike, State, GameMessage, PlayerType, SlotType, StateUtils, MoveEnergyPrompt, ConfirmPrompt, CardTarget, Card } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { MOVED_TO_ACTIVE_THIS_TURN } from '../../../game/store/prefabs/prefabs';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';

export class Latios extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = N;
  public hp: number = 130;
  public retreat = [C];

  public powers = [{
    name: 'Lustrous Assist',
    // TRIGGERED ability — it auto-fires (via the reduceEffect check below) WHEN Mega Latias ex moves from
    // the Bench to the Active Spot; it is NOT player-activated. `useWhenInPlay: true` wrongly listed it as an
    // activatable `useAbility` in legal-action enumeration (offered ungated with any active — a no-op the
    // engine accepted; rotomancer never offers it). Same class as por-012 Sniper's Eye / RE-31.
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, when your Mega Latias ex moves from the Bench to the Active Spot, you may move any number of Energy from your Benched Pokémon to that Active Pokémon.'
  }];

  public attacks = [{
    name: 'Dragon Claw',
    cost: [W, P, C],
    damage: 130,
    text: ''
  }];

  public regulationMark = 'I';
  public set: string = 'MEG';
  public setNumber: string = '101';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Latios';
  public fullName: string = 'Latios M1S';

  private LUSTER_ASSIST_MARKER = 'LUSTER_ASSIST_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    const player = StateUtils.findOwner(state, StateUtils.findCardList(state, this));
    if (player === undefined) {
      return state;
    }
    const activePokemon = player.active.getPokemonCard();

    // The active must be Mega Latias ex (twinleaf card name 'Mega Latias ex') freshly moved to Active this
    // turn. The prior literal 'M Latias-EX' matched no card, so the trigger never fired — the ability was
    // dead (and only "reachable" via the spurious useWhenInPlay menu offering, which did nothing either).
    if (activePokemon && activePokemon.name === 'Mega Latias ex' && MOVED_TO_ACTIVE_THIS_TURN(player, activePokemon)) {
      if (!player.marker.hasMarker(this.LUSTER_ASSIST_MARKER, this)) {

        let hasEnergyOnBench = false;
        player.bench.forEach((b: PokemonCardList) => {
          if (b.cards.some((c: Card) => c.superType === SuperType.ENERGY)) {
            hasEnergyOnBench = true;
          }
        });

        if (hasEnergyOnBench) {
          state = store.prompt(state, new ConfirmPrompt(
            player.id,
            GameMessage.WANT_TO_USE_ABILITY
          ), wantToUse => {
            if (wantToUse) {
              player.marker.addMarker(this.LUSTER_ASSIST_MARKER, this);

              const blockedFrom: CardTarget[] = [{ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }];
              const blockedTo: CardTarget[] = [];
              player.bench.forEach((b: PokemonCardList, index: number) => {
                blockedTo.push({ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: index });
              });

              store.prompt(state, new MoveEnergyPrompt(
                player.id,
                GameMessage.MOVE_ENERGY_CARDS,
                PlayerType.BOTTOM_PLAYER,
                [SlotType.ACTIVE, SlotType.BENCH],
                { superType: SuperType.ENERGY },
                { allowCancel: true, blockedFrom, blockedTo }
              ), transfers => {
                transfers = transfers || [];
                for (const transfer of transfers) {
                  const source = StateUtils.getTarget(state, player, transfer.from);
                  source.moveCardTo(transfer.card, player.active);
                }
              });
            }
          });
        }
      }
    }

    if (effect instanceof EndTurnEffect) {
      player.marker.removeMarker(this.LUSTER_ASSIST_MARKER, this);
    }

    return state;
  }
} 