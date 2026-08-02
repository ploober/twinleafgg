import { TrainerCard } from '../../../game/store/card/trainer-card';
import { SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { Effect } from '../../../game/store/effects/effect';
import { GameError, GameMessage, MoveEnergyPrompt, Player, StateUtils, PlayerType, SlotType } from '../../../game';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class NsPlan extends TrainerCard {
  public trainerType: TrainerType = TrainerType.SUPPORTER;
  public regulationMark = 'I';
  public set: string = 'BLK';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '83';
  public name: string = 'N\'s Plan';
  public fullName: string = 'N\'s Plot SV11B';
  public text: string = 'Move up to 2 Energy from your Benched Pokémon to your Active Pokémon.';

  /**
   * TA-182 / §B.18. "Move up to 2 Energy from your **Benched** Pokémon to your Active Pokémon."
   *
   * This counted Energy on ALL of the player's Pokémon — the Active included — so a board whose
   * Active carried Energy but whose Bench carried none answered "playable", the Supporter was burned
   * and nothing moved. The Energy has to come off the BENCH, so only the Bench can satisfy it.
   *
   * #2301 floors a Trainer's "up to X" at 1 (not 0, which is the *attack* rule), and #925 makes an
   * unreachable floor unplayable rather than a legal no-op.
   */
  private hasBenchedEnergy(player: Player): boolean {
    let benchedEnergy = false;
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
      if (target.slot === SlotType.BENCH && cardList.cards.some(c => c.superType === SuperType.ENERGY)) {
        benchedEnergy = true;
      }
    });
    return benchedEnergy;
  }

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    // An Active is also required as the destination; a player mid-promote has none.
    if (player.active.cards.length === 0) {
      return false;
    }
    return this.hasBenchedEnergy(player);
  }


  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const supporterTurn = player.supporterTurn;

      if (supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      // Same test as `canPlay`, via the same helper, so the menu and the dispatcher cannot disagree
      // — that split is exactly the TA-181 shape. (The old comment here said "no Basic Energy in the
      // discard pile", which describes a different card entirely.)
      if (player.active.cards.length === 0 || !this.hasBenchedEnergy(player)) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      player.hand.moveCardTo(effect.trainerCard, player.supporter);
      // We will discard this card after prompt confirmation
      effect.preventDefault = true;

      // Prepare blockedMap for MoveEnergyPrompt
      const blockedMap: { source: any, blocked: number[] }[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
        if (target.slot === SlotType.ACTIVE) {
          // Block all energy on Active (can't move from Active)
          blockedMap.push({ source: target, blocked: Array.from({ length: cardList.cards.length }, (_, i) => i) });
        }
      });

      // Only allow moving to Active
      const blockedTargets: any[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
        if (target.slot !== SlotType.ACTIVE) {
          blockedTargets.push(target);
        }
      });

      return store.prompt(state, new MoveEnergyPrompt(
        player.id,
        GameMessage.MOVE_ENERGY_CARDS,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH, SlotType.ACTIVE],
        { superType: SuperType.ENERGY },
        { allowCancel: false, min: 1, max: 2, blockedMap, blockedTo: blockedTargets }
      ), transfers => {
        if (transfers && transfers.length > 0) {
          for (const transfer of transfers) {
            const source = StateUtils.getTarget(state, player, transfer.from);
            if (source) {
              const target = player.active;
              MOVE_CARDS(store, state, source, target, { cards: [transfer.card], sourceCard: this });
            }
          }
        }
      });
    }
    return state;
  }
} 