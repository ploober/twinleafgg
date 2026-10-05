import { CardList } from '../../../game/store/state/card-list';
import { PokemonCard, CardTag, Stage, CardType, StoreLike, State, StateUtils, PowerType, Card, ChooseEnergyPrompt, GameMessage } from '../../../game';
import { DiscardCardsEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';

import {
  DAMAGED_FROM_FULL_HP,
  IS_ABILITY_BLOCKED,
  WAS_ATTACK_USED,
} from '../../../game/store/prefabs/prefabs';

export class Pikachuex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [CardType.LIGHTNING];
  public hp: number = 200;
  public weakness = [{ type: CardType.FIGHTING }];
  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Resolute Heart',
    powerType: PowerType.ABILITY,
    // TA-194 data: was "...would be Knocked Out by an attack" -- it dropped "by DAMAGE FROM", which is
    // the clause that makes an effect-KO (no damage) bypass this Ability. Restored from the unanimous
    // authoritative record. Behaviour already CORRECT and unchanged: measured against Haxorus blk-070
    // "Axe Blast" (KOs a Basic by EFFECT, zero damage) -- BOTH engines KO Pikachu ex, neither saves it.
    text: 'If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10.'
  }];

  public attacks = [
    {
      name: 'Topaz Bolt',
      cost: [CardType.GRASS, CardType.LIGHTNING, CardType.METAL],
      damage: 300,
      text: 'Discard 3 Energy from this Pokémon.',
    },
  ];

  public regulationMark = 'H';
  public set: string = 'SSP';
  public setNumber: string = '57';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Pikachu ex';
  public fullName: string = 'Pikachu ex SSP';

  public damageDealt = false;

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PutDamageEffect && effect.target.cards.includes(this)) {
      const player = StateUtils.findOwner(state, effect.target);
      if (
        !IS_ABILITY_BLOCKED(store, state, player, this) &&
        DAMAGED_FROM_FULL_HP(store, state, effect, player, effect.target)
      ) {
        effect.surviveOnTenHPReason = this.powers[0].name;
      }
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // B.82 (#1834, #2002; reverses FX-0165's B.76 order, TA-609): the choice is made first, the 300 is dealt with
      // the chosen Energy still attached, and they are discarded after it (AttackEffect.afterDamageMoves).
      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
      state = store.reduceEffect(state, checkProvidedEnergy);

      // "Discard 3 Energy from this Pokémon." When the attached cards PROVIDE 3 or fewer
      // Energy, every one of them must go — there is no which-choice, so apply the
      // discard atomically with no prompt (CF-8 forced-discard boundary: a discard
      // whose count >= the available pool is a non-decision). Otherwise it is a genuine
      // "which 3" choice that surfaces the discard picks.
      //
      // TA-560 (2026-10-01): counted in Energy, not cards. TA-40 counted CARDS, so 3 cards
      // providing 4 Energy (Counter Energy provides 2 while its owner is behind on Prize
      // cards) were all discarded with no choice, although compendium #833 makes discarding
      // a 2-Energy card plus one other a legal "Discard 3 Energy" that keeps a card.
      const providedEnergy = checkProvidedEnergy.energyMap.reduce((n, e) => n + e.provides.length, 0);
      const discardAfterDamage = (cards: Card[]): void => {
        effect.afterDamageMoves.push(() => {
          const discardEnergy = new DiscardCardsEffect(effect, cards);
          discardEnergy.target = player.active;
          store.reduceEffect(state, discardEnergy);
        });
      };
      if (providedEnergy <= 3) {
        discardAfterDamage(checkProvidedEnergy.energyMap.map(e => e.card));
        return state;
      }

      const energyPrompt = new ChooseEnergyPrompt(
        player.id,
        GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
        checkProvidedEnergy.energyMap,
        [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS],
        { allowCancel: false }
      );
      energyPrompt.deferredMove = true;
      state = store.prompt(state, energyPrompt, energy => {
        const cards: Card[] = (energy || []).map(e => e.card);
        CardList.chosen?.(cards);
        discardAfterDamage(cards);
      });
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
