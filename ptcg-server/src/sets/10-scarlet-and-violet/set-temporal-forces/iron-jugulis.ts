import { CardTag, CardType, PokemonCard, PowerType, Stage, State, StateUtils, StoreLike } from '../../../game';
import { AfterDamageEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';
import { IS_ABILITY_BLOCKED } from '../../../game/store/prefabs/prefabs';

export class IronJugulis extends PokemonCard {
  public stage: Stage = Stage.BASIC;

  public regulationMark = 'H';

  protected _tags = [CardTag.FUTURE];

  public cardType: CardType[] = [CardType.COLORLESS];

  public hp: number = 130;

  public weakness = [{ type: CardType.LIGHTNING }];

  public resistance = [{ type: CardType.FIGHTING, value: -30 }];

  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    {
      name: 'Blasting Wind',
      cost: [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS],
      damage: 110,
      text: '',
    },
  ];

  public powers = [{
    name: 'Automated Combat',
    powerType: PowerType.ABILITY,
    // TA-193: this text was missing the leading "is in the Active Spot and" condition (and a space
    // before the parenthesis). Restored from the UNANIMOUS authoritative record; rotomancer matches.
    text: 'If this Pokémon is in the Active Spot and is damaged by an attack from your opponent\'s Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon.'
  }];

  public set: string = 'TEF';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '139';

  public name: string = 'Iron Jugulis';

  public fullName: string = 'Iron Jugulis TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // "If this Pokémon is damaged by an attack from your opponent's Pokémon (even if this Pokémon is
    // Knocked Out), put 3 damage counters on the Attacking Pokémon." Trigger on AfterDamageEffect, which
    // fires exactly once per attack. (Reacting to DealDamageEffect *and* PutDamageEffect double-fired: one
    // attack flows through as a DealDamageEffect that then spawns a PutDamageEffect, so the ability applied
    // 6 counters instead of 3 — invisible on idempotent siblings that apply Burn, but wrong here.)
    if (effect instanceof AfterDamageEffect && effect.target.cards.includes(this)) {
      const player = effect.player;
      const targetPlayer = StateUtils.findOwner(state, effect.target);

      // Only react to damage from the OPPONENT's attack (not self-inflicted), and only if damage landed.
      if (effect.damage <= 0 || player === targetPlayer) {
        return state;
      }

      // TA-193: the ability is gated on "If this Pokémon is IN THE ACTIVE SPOT and is damaged...".
      // That clause was absent from both our printed text and this reducer, so a BENCHED Iron Jugulis
      // punished the attacker — measured live: on a board where Iron Jugulis sits on the Bench and takes
      // the 30 sub-damage from Hop's Zacian ex jtg-111 "Insta-Strike", twinleaf put 3 counters on the
      // attacker (A.damage=30) while rotomancer correctly put none (A.damage=0). The control (Iron
      // Jugulis ACTIVE) converged at 30 on both engines before and after this fix.
      //
      // Checked against the ACTIVE SLOT, not against a "was Active" marker: the clause is a condition on
      // the ability's state at damage time, not a memory of where the Pokémon used to be. The
      // "(even if this Pokémon is Knocked Out)" parenthetical is about surviving its OWN KO from that
      // damage, which is why the counters still land when it dies in the Active Spot.
      if (targetPlayer.active !== effect.target) {
        return state;
      }

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      // TA-195: route the punish through PutDamageEffect instead of `effect.source.damage += 30`.
      //
      // The direct mutation placed the counters but wrote NO log line, and the conformance
      // projection derives `damaged` by conservation: `pool = dealt - survivorDamage`, where `dealt`
      // sums the damage LOGS. A silent placement raises `survivorDamage` without raising `dealt`, so
      // the pool for a Pokemon KO'd in the same step collapsed to 0 and its `damaged` was never
      // reconstructed. Measured on the KO cell: rotomancer emitted damaged x3, twinleaf x2 —
      // and the missing one was Iron Jugulis' OWN lethal hit, not the punish.
      //
      // Going through the effect is also correct independently of events: a placement dispatched
      // this way is visible to damage-modifying and prevention effects, which a raw field write
      // silently bypasses. No recursion risk — the new effect targets the ATTACKER, and this
      // ability only reacts when `effect.target.cards.includes(this)`.
      // Chosen over RetaliateDamageEffect, which reads like the perfect fit ("places revenge-trap
      // damage counters on the Attacking Pokémon") but is an EffectOfAttackEffect — it is
      // deliberately blockable by "prevent all effects of attacks" (Mist Energy). This punish comes
      // from an ABILITY, not an attack, so that blocking would be wrong. It also has zero users
      // across all of src/sets, so it is untrodden. PutDamageEffect is the ordinary counter-placement
      // path, applies no Weakness/Resistance, and logs.
      const punish = new PutDamageEffect(effect.attackEffect, 30);
      punish.target = effect.source;
      store.reduceEffect(state, punish);
    }

    return state;
  }
}
