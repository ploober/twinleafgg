import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType, EnergyType } from '../../../game/store/card/card-types';
import { StoreLike, State, GameMessage, ChooseCardsPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { EnergyCard } from '../../../game/store/card/energy-card';

import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Decidueye extends PokemonCard {

  public regulationMark = 'H';
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Dartrix';
  public cardType: CardType = G;
  public hp: number = 150;
  public weakness = [{ type: R }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Stock Up on Feathers',
      cost: [C],
      damage: 0,
      text: 'Draw cards until you have 7 cards in your hand.'
    },
    {
      name: 'Power Shot',
      cost: [G],
      damage: 170,
      text: 'Discard a Basic [G] Energy from your hand. If you can\'t, this attack does nothing.'
    }
  ];

  public set: string = 'SFA';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '5';
  public name: string = 'Decidueye';
  public fullName: string = 'Decidueye SFA';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      while (player.hand.cards.length < 7) {
        if (player.deck.cards.length === 0) {
          break;
        }
        player.deck.moveTo(player.hand, 1);
      }
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      // "Discard a Basic [G] Energy from your hand. If you can't, this attack does nothing." The discard
      // is MANDATORY when able — only the impossibility case (no Basic Grass in hand) whiffs. The former
      // min:0 prompt wrongly let the player DECLINE the discard and keep the 170; it is min:1 (forced).
      const hasBasicGrass = player.hand.cards.some(
        c => c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.provides.includes(G)
      );
      if (!hasBasicGrass) {
        effect.damage = 0;
        return state;
      }

      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        player.hand,
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Grass Energy' },
        { allowCancel: false, min: 1, max: 1 }
      ), cards => {
        cards = cards || [];
        player.hand.moveCardsTo(cards, player.discard);
        return state;
      });
    }
    return state;
  }
}