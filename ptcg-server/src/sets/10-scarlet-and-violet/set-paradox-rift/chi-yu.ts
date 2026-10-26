import { AttachEnergyPrompt, EnergyCard, GameMessage, PlayerType, SlotType, State, StateUtils, StoreLike } from '../../../game';
import { CardType, EnergyType, Stage, SuperType } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import {WAS_ATTACK_USED, WAS_POKEMON_KNOCKED_OUT_DURING_OPPONENTS_LAST_TURN, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class ChiYu extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [R];
  public hp: number = 110;
  public weakness = [{ type: W }];
  public retreat = [C];

  public attacks = [{
    name: 'Flare Bringer',
    cost: [R],
    damage: 0,
    text: 'Attach up to 2 Basic [R] Energy cards from your discard pile to 1 of your Pokémon.'
  },
  {
    name: 'Megafire of Envy',
    cost: [R, R],
    damage: 50,
    damageCalculation: '+',
    text: 'If any of your Pokémon were Knocked Out by damage from an attack during your opponent\'s last turn, this attack does 90 more damage.'
  }];

  public regulationMark = 'G';
  public set: string = 'PAR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '29';
  public name: string = 'Chi-Yu';
  public fullName: string = 'Chi-Yu PAR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Flare Bringer
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const hasEnergyInDiscard = player.discard.cards.some(c => {
        return c.superType === SuperType.ENERGY
          && c.energyType === EnergyType.BASIC
          && (c as EnergyCard).provides.includes(CardType.FIRE);
      });
      // TA-493: with no Basic [R] Energy in the discard the attack is still usable and does nothing (#352, #1962).
      if (!hasEnergyInDiscard) {
        return state;
      }

      state = store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        player.discard,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH, SlotType.ACTIVE],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Fire Energy' },
        // TA-779: "to 1 of your Pokémon": both cards go to one Pokémon (B.120).
        { allowCancel: false, min: 0, max: 2, sameTarget: true }
      ), transfers => {
        transfers = transfers || [];
        // cancelled by user
        if (transfers.length === 0) {
          return;
        }

        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          MOVE_CARDS(store, state, player.discard, target, { cards: [transfer.card], sourceCard: this });
        }
      });

      return state;
    }

    // Megafire of Envy
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      if (WAS_POKEMON_KNOCKED_OUT_DURING_OPPONENTS_LAST_TURN(player, { byAttackDamage: true })) {
        effect.damage += 90;
      }
      return state;
    }

    return state;
  }
}