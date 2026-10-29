import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { PowerType, StoreLike, State, GameMessage, PlayerType, SlotType, StateUtils, MoveEnergyPrompt, ConfirmPrompt, CardTarget, Card } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { MovedToActiveEffect } from '../../../game/store/effects/game-effects';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { ABILITY_USED, IS_ABILITY_BLOCKED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';

export class Latios extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [N];
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
    const cardList = StateUtils.findCardList(state, this);
    if (!(cardList instanceof PokemonCardList)) { return state; }
    const player = StateUtils.findOwner(state, cardList);
    if (player === undefined) {
      return state;
    }
    // A movement event is a single opportunity. Checking the lasting turn marker
    // on every effect queues duplicate confirmations and reopens a declined use.
    if (effect instanceof MovedToActiveEffect && effect.player === player
      && state.players[state.activePlayer] === player
      && effect.pokemonCard === player.active.getPokemonCard()
      && effect.pokemonCard.name === 'Mega Latias ex'
      && !IS_ABILITY_BLOCKED(store, state, player, this)) {
      if (!player.marker.hasMarker(this.LUSTER_ASSIST_MARKER, this)
        && !cardList.abilitiesUsedThisTurn.includes(this.powers[0].name)) {

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
              ABILITY_USED(player, this);

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
                  MOVE_CARDS(store, state, source, player.active, { cards: [transfer.card], sourceCard: this });
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