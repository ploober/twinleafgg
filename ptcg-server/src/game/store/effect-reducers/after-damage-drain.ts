import { AfterDamageEffect } from '../effects/attack-effects';
import { Effect } from '../effects/effect';
import { State } from '../state/state';
import { StoreLike } from '../store-like';

/**
 * TA-460 — dispatch ONE deferred damage-response effect (the CF-74 / §B.53 `pendingAfterDamage` queue)
 * while keeping the rulebook's Special-Condition invariant across it.
 *
 * Since FX-0314 the "when damaged by an attack" window drains AFTER the attack's own trailing effects
 * (#2172, Advanced Rulebook II E-03). That is the pinned order — but it means the Attacking Pokémon may
 * already have LEFT the Active Spot when the response fires (Strafe's "you may switch", meg-181), and a
 * response that afflicts "the Attacking Pokémon" (Incandescent Body asc-027 / twm-123: "is now Burned")
 * then wrote the condition onto a Benched Pokémon. Special Conditions can only exist on an Active Pokémon
 * (rulebook, "Special Conditions": "They can only happen to an Active Pokémon — when a Pokémon goes to
 * the Bench, it recovers from all Special Conditions"; compendium #891). The switched-out attacker is
 * therefore simply not afflicted — rotomancer's outcome under the same order.
 *
 * The choke point is the drain, not the cards: the three drain sites (useAttack + both copy-attack
 * delegations) are the ONLY place a damage response runs after the attacker could have moved, and the
 * cards write the condition directly (`effect.source.addSpecialCondition`), so a card-level guard would
 * miss by construction. Damage counters are NOT undone — #534 (Rock Guard) places them on the switched-out
 * attacker on purpose; only Special Conditions cannot follow it to the Bench.
 */
export function reduceDeferredAfterDamage(store: StoreLike, state: State, effect: Effect): State {
  if (!(effect instanceof AfterDamageEffect)) {
    return store.reduceEffect(state, effect);
  }
  const attacker = effect.source;
  const before = {
    conditions: [...attacker.specialConditions],
    poison: attacker.poisonDamage,
    burn: attacker.burnDamage,
    confusion: attacker.confusionDamage,
  };
  state = store.reduceEffect(state, effect);
  const owner = state.players.find(p => p.active === attacker || p.bench.includes(attacker));
  const gained = attacker.specialConditions.some(sp => !before.conditions.includes(sp));
  if (owner !== undefined && owner.active !== attacker && gained) {
    attacker.specialConditions = [...before.conditions];
    attacker.poisonDamage = before.poison;
    attacker.burnDamage = before.burn;
    attacker.confusionDamage = before.confusion;
  }
  return state;
}
