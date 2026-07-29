import { CardType, EnergyType, Stage, SuperType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { AttachEnergyPrompt, GameMessage, PlayerType, PokemonCard, SlotType, StateUtils } from '../../../game';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Chansey extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = C;
  public weakness = [{ type: F }];
  public hp: number = 120;
  public retreat = [C, C];

  public attacks = [{
    name: 'Lucky Attachment',
    cost: [C],
    damage: 0,
    text: 'Attach a Basic Energy card from your hand to 1 of your Pokémon.'
  },
  {
    name: 'Boundless Power',
    cost: [C, C, C],
    damage: 80,
    text: 'During your next turn, this Pokémon can\'t attack.'
  }];

  public regulationMark = 'H';
  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '133';
  public name: string = 'Chansey';
  public fullName: string = 'Chansey TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-131: an attack is declarable even when its effect can't be carried out
      // (rulebook p.20). With no Basic Energy in hand there is nothing to attach, so
      // the effect simply whiffs — do NOT refuse the attack.
      const hasEnergyInHand = player.hand.cards.some(c => {
        return c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC;
      });
      if (!hasEnergyInHand) {
        return state;
      }

      return store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        player.hand,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { allowCancel: false, min: 1, max: 1 }
      ), transfers => {
        transfers = transfers || [];
        // cancelled by user
        if (transfers.length === 0) {
          return;
        }
        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          player.hand.moveCardTo(transfer.card, target);
        }
      });
    }

    // Boundless Power
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      player.active.cannotAttackNextTurnPending = true;
    }

    return state;
  }
}