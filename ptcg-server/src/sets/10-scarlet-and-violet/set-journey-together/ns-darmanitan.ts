import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, EnergyType } from '../../../game/store/card/card-types';
import { StoreLike, State, EnergyCard, StateUtils, Card, ChoosePokemonPrompt, GameMessage, PlayerType, SlotType, PokemonCardList } from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { DiscardCardsEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class NsDarmanitan extends PokemonCard {
  protected _tags = [CardTag.NS];

  public stage: Stage = Stage.STAGE_1;

  public evolvesFrom = "N's Darumaka";

  public cardType: CardType[] = [R];

  public weakness = [{ type: W }];

  public hp: number = 140;

  public retreat = [C, C, C];

  public attacks = [
    {
      name: 'Back Draft',
      cost: [C, C],
      damage: 30,
      text: "This attack does 30 damage for each Basic Energy card in your opponent's discard pile.",
    },
    {
      name: 'Flamebody Cannon',
      cost: [R, R, C],
      damage: 90,
      text: "Discard all Energy from this Pokémon. This attack also does 90 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    },
  ];

  public regulationMark = 'I';

  public cardImage: string = 'assets/cardback.png';

  public set: string = 'JTG';

  public setNumber = '27';

  public name: string = "N's Darmanitan";

  public fullName: string = "N's Darmanitan JTG";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      let energyCount = 0;
      opponent.discard.cards.forEach((c) => {
        if (c instanceof EnergyCard && c.energyType === EnergyType.BASIC) {
          energyCount += 1;
        }
      });

      effect.damage = energyCount * 30;
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // "Discard all Energy" is FORCED (no which/how-many choice); the 90 damage to a Benched
      // Pokemon is the Step-D choice. CF-10 (=> TA-39 Thunder Raid): make the Step-D bench choice
      // FIRST, then discard + place damage. The final board is identical either way — this only
      // corrects the decision ORDER (twinleaf previously discarded before surfacing the choice).
      const discardThenDamage = (target?: PokemonCardList): State => {
        const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
        state = store.reduceEffect(state, checkProvidedEnergy);
        const cards: Card[] = checkProvidedEnergy.energyMap.map(e => e.card);
        const discardEnergy = new DiscardCardsEffect(effect, cards);
        discardEnergy.target = player.active;
        store.reduceEffect(state, discardEnergy);
        if (target !== undefined) {
          const damageEffect = new PutDamageEffect(effect, 90);
          damageEffect.target = target;
          store.reduceEffect(state, damageEffect);
        }
        return state;
      };

      const hasBench = opponent.bench.some(b => b.cards.length > 0);
      if (hasBench === false) {
        return discardThenDamage();
      }

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.BENCH],
        { min: 1, max: 1, allowCancel: false }
      ), selected => {
        const targets = selected || [];
        return discardThenDamage(targets[0]);
      });
    }
    return state;
  }
}
