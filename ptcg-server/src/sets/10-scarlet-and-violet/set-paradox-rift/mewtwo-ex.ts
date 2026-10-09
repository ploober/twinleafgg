import { PokemonCard } from '../../../game/store/card/pokemon-card';
import {
  Stage,
  CardType,
  CardTag,
  EnergyType,
  SuperType,
} from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  PlayerType,
  AttachEnergyPrompt,
  SlotType,
  EnergyCard,
  GameMessage,
  StateUtils,
} from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import {WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Mewtwoex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public cardType: CardType[] = [L];
  public hp: number = 230;
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Transfer Charge',
      cost: [P],
      damage: 0,
      text: 'Attach up to 2 Basic [P] Energy cards from your discard pile to your Pokémon in any way you like.',
    },
    {
      name: 'Photon Kinesis',
      cost: [P, P],
      damage: 10,
      damageCalculation: '+',
      text: 'This attack does 30 more damage for each [P] Energy attached to all of your Pokémon.',
    },
  ];

  public regulationMark = 'G';
  public set: string = 'PAR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '58';
  public name: string = 'Mewtwo ex';
  public fullName: string = 'Mewtwo ex PAR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-676 (card text; B.89 (5), B.102): "to your Pokémon in any way you like": each Energy and the Pokémon it goes to
    // are chosen together at Step D (it attached them all to this Pokémon); they attach after the picks (MOVE_CARDS).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const blocked: number[] = [];
      player.discard.cards.forEach((card, index) => {
        if (!(card instanceof EnergyCard) || card.energyType !== EnergyType.BASIC || !card.provides.includes(CardType.PSYCHIC)) {
          blocked.push(index);
        }
      });
      if (blocked.length === player.discard.cards.length) {
        return state;
      }
      return store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_CARDS,
        player.discard,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { allowCancel: false, min: 0, max: 2, blocked },
      ), transfers => {
        for (const transfer of transfers || []) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          MOVE_CARDS(store, state, player.discard, target, { cards: [transfer.card], sourceCard: this });
        }
      });
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      let psychicEnergies = 0;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
        const checkProvidedEnergyEffect = new CheckProvidedEnergyEffect(player, cardList);
        store.reduceEffect(state, checkProvidedEnergyEffect);
        checkProvidedEnergyEffect.energyMap.forEach((energy) => {
          if (energy.provides.includes(CardType.PSYCHIC)) {
            psychicEnergies += 1;
          }
        });
      });
      effect.damage = 10 + psychicEnergies * 30;
    }

    if (
      effect instanceof PutDamageEffect &&
      effect.target.cards.includes(this) &&
      effect.target.getPokemonCard() === this
    ) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Target is not Active
      if (effect.target === player.active || effect.target === opponent.active) {
        return state;
      }

      effect.preventDefault = true;
    }
    return state;
  }
}
