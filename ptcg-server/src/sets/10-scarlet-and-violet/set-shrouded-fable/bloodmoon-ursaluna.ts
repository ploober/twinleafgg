import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType, SuperType } from '../../../game/store/card/card-types';
import { PowerType, StoreLike, State, StateUtils, GameMessage, ConfirmPrompt, EnergyCard, CardTarget, PlayerType, SlotType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { ATTACH_ENERGY_PROMPT, IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class BloodmoonUrsaluna extends PokemonCard {

  public regulationMark = 'H';

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.FIGHTING];

  public hp: number = 150;

  public weakness = [{ type: CardType.GRASS }];

  public retreat = [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS];

  public powers = [{
    name: 'Battle-Hardened',
    powerType: PowerType.ABILITY,
    text: 'When you play this Pokémon from your hand onto your Bench during your turn, you may attach up to 2 Basic [F] Energy cards from your hand to this Pokémon.'

  }];

  public attacks = [
    {
      name: 'Mad Bite',
      cost: [CardType.FIGHTING, CardType.FIGHTING, CardType.COLORLESS],
      damage: 100,
      damageCalculation: '+',
      text: 'This attack does 30 more damage for each damage counter on your opponent\'s Active Pokémon.'
    }
  ];

  public set: string = 'SFA';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '25';

  public name: string = 'Bloodmoon Ursaluna';

  public fullName: string = 'Bloodmoon Ursaluna SFA';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if ((effect instanceof PlayPokemonEffect) && effect.pokemonCard === this) {

      const player = effect.player;

      // Try to reduce PowerEffect, to check if something is blocking our ability
      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }
      // TA-759 (B.29 rule 1): no Basic [F] Energy in the hand -> nothing to attach, so it is not offered (the check
      // ran after the yes and threw).
      const hasEnergyInHand = player.hand.cards.some(c => {
        return c instanceof EnergyCard
          && c.energyType === EnergyType.BASIC
          && c.provides.includes(CardType.FIGHTING);
      });
      if (!hasEnergyInHand) {
        return state;
      }
      state = store.prompt(state, new ConfirmPrompt(
        effect.player.id,
        GameMessage.WANT_TO_USE_ABILITY,
      ), wantToUse => {
        if (wantToUse) {

          // TA-819: attach to this newly played Pokemon, including at each intermediate pick.
          const blockedTo: CardTarget[] = [];
          player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (_list, card, target) => {
            if (card !== this) { blockedTo.push(target); }
          });
          const blocked: number[] = [];
          player.hand.cards.forEach((card, index) => {
            if (!(card instanceof EnergyCard && card.energyType === EnergyType.BASIC
                && card.provides.includes(CardType.FIGHTING))) {
              blocked.push(index);
            }
          });
          return ATTACH_ENERGY_PROMPT(
            store, state, player, PlayerType.BOTTOM_PLAYER, SlotType.HAND,
            [SlotType.ACTIVE, SlotType.BENCH],
            { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
            // TA-820: declining happens before this prompt; accepting requires at least one attachment.
            { min: 1, max: 2, allowCancel: false, blocked, blockedTo },
          );
        }
      });
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {

      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (opponent.active.damage > 0) {
        const damage = 100 + (opponent.active.damage * 3);

        effect.damage = damage;
      }
    }
    return state;
  }
}
