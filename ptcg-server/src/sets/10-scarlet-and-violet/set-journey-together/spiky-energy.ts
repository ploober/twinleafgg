import { CardType, EnergyType } from '../../../game/store/card/card-types';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { StoreLike } from '../../../game/store/store-like';
import { State, GamePhase } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { StateUtils } from '../../../game';
import { AfterDamageEffect, PutCountersEffect } from '../../../game/store/effects/attack-effects';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { IS_SPECIAL_ENERGY_BLOCKED } from '../../../game/store/prefabs/prefabs';


export class SpikyEnergy extends EnergyCard {

  public provides: CardType[] = [C];

  public energyType = EnergyType.SPECIAL;

  public regulationMark = 'I';

  public set: string = 'JTG';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '159';

  public name = 'Spiky Energy';

  public fullName = 'Spiky Energy JTG';

  public text =
    'As long as this card is attached to a Pokémon, it provides [C] Energy. \n' +
    'If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack ' +
    'from your opponent\'s Pokémon (even if it is Knocked Out), put 2 damage counters on the Attacking Pokémon.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // TA-628 / B.84 (2), #674 (Dangerous Energy, same wording: an attack that discards it means "You would not receive
    // the 2 damage counters"), #2012: Spiky Energy reacts to the damage in the damage-response window, after the
    // attack's own effects (B.53), and only if it is still attached to the damaged Pokémon then. "is damaged" = the
    // AfterDamageEffect (damage actually placed). During the attack pipeline's damage step that effect is already
    // deferred past the attack's effects (CF-74); damage an attack deals from inside its own effect, before its other
    // effects (APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS, e.g. Crunch twm-094), reaches here at once, so the reaction is
    // queued behind those effects on the in-flight attack (its afterDamageMoves run once they have resolved, before
    // the Knock Out check: "even if it is Knocked Out").
    if (effect instanceof AfterDamageEffect && effect.target.cards.includes(this) && state.phase === GamePhase.ATTACK) {
      const owner = StateUtils.findOwner(state, effect.target);
      if (effect.damage <= 0 || owner === effect.player || owner.active !== effect.target) {
        return state;
      }
      const attacker = effect.source;
      const target = effect.target;
      const react = () => {
        if (!target.cards.includes(this) || IS_SPECIAL_ENERGY_BLOCKED(store, state, effect.player, this, target)) {
          return;
        }
        const putCountersEffect = new PutCountersEffect(effect, 20);
        putCountersEffect.target = attacker;
        store.reduceEffect(state, putCountersEffect);
      };
      const pre = state.preDamageAttack as AttackEffect | undefined;
      if (state.deferAfterDamage !== true && pre !== undefined && pre === effect.attackEffect) {
        pre.afterDamageMoves.push(react);
        return state;
      }
      react();
    }
    return state;
  }

}
