import { CardTag, CardType, Stage } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { PowerType } from '../../../game/store/card/pokemon-types';
import { AfterDamageEffect, PutCountersEffect } from '../../../game/store/effects/attack-effects';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';
import { IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { BLOCK_RETREAT } from '../../../game/store/prefabs/effect-of-attack-prefabs';
import { StateUtils } from '../../../game/store/state-utils';
import { GamePhase, State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';

/** TA-634: the attacks each Orthworm ex has already reacted to (once per attack). */
const reactedTo = new WeakMap<object, Set<PokemonCard>>();

export class Orthwormex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [M];
  public hp: number = 220;
  public weakness = [{ type: R }];
  public resistance = [{ type: G, value: -30 }];
  public retreat = [C, C, C, C];

  public powers = [
    {
      name: 'Pummeling Payback',
      powerType: PowerType.ABILITY,
      text: "If this Pokémon is damaged by an attack from your opponent's Pokémon(even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon for each [M] Energy attached to this Pokémon.",
    },
  ];

  public attacks = [
    {
      name: 'Rock Tomb',
      cost: [C, C, C, C],
      damage: 150,
      text: "During your opponent's next turn, the Defending Pokémon can't retreat.",
    },
  ];

  public regulationMark = 'H';
  public set: string = 'SCR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '110';
  public name: string = 'Orthworm ex';
  public fullName: string = 'Orthworm ex SCR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Pummeling Payback. TA-634: "If this Pokémon is damaged by an attack" = an AfterDamageEffect on THIS Pokémon
    // (Active or Benched) from the opponent's attack, in the damage-response window (B.53, after the attack's own
    // effects, before the Knock Out check: "even if this Pokémon is Knocked Out"), once per attack. The [M] Energy
    // counted is what is attached to it then (#2012); the result is damage counters on the Attacking Pokémon, not
    // damage. Same window as Spiky Energy jtg-159 (TA-628): damage an attack deals from inside its own effect, before
    // its other effects, queues the reaction on the in-flight attack.
    if (effect instanceof AfterDamageEffect && effect.target.getPokemonCard() === this && state.phase === GamePhase.ATTACK) {
      const owner = StateUtils.findOwner(state, effect.target);
      if (effect.damage <= 0 || owner === effect.player) {
        return state;
      }
      const attack = effect.attackEffect as object;
      const seen = reactedTo.get(attack) ?? new Set<PokemonCard>();
      if (seen.has(this)) {
        return state;
      }
      seen.add(this);
      reactedTo.set(attack, seen);
      const attacker = effect.source;
      const target = effect.target;
      const react = () => {
        if (target.getPokemonCard() !== this || IS_ABILITY_BLOCKED(store, state, owner, this)) {
          return;
        }
        const checkProvidedEnergyEffect = new CheckProvidedEnergyEffect(owner, target);
        store.reduceEffect(state, checkProvidedEnergyEffect);
        let energyCount = 0;
        checkProvidedEnergyEffect.energyMap.forEach((em) => {
          energyCount += em.provides.filter(
            (cardType) => cardType === CardType.METAL || cardType === CardType.ANY,
          ).length;
        });
        if (energyCount === 0) {
          return;
        }
        const putCountersEffect = new PutCountersEffect(effect, 20 * energyCount);
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

    // Rock Tomb
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return BLOCK_RETREAT(store, state, effect, this);
    }

    return state;
  }
}
