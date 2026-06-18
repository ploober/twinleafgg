import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Card } from '../../../game/store/card/card';
import { Attack } from '../../../game/store/card/pokemon-types';
import { SpecialCondition } from '../../../game/store/card/card-types';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { Effect } from '../../../game/store/effects/effect';
import { Player } from '../../../game/store/state/player';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { HealEffect } from '../../../game/store/effects/game-effects';
import { PutDamageEffect, AddSpecialConditionsEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { costToCardType } from './bridge';

/**
 * A minimal interpreter that executes a Rotomancer IR program as a Twinleaf card. Each ATTACK
 * fragment becomes an Attack whose printed damage is 0; the fragment `body` is the program and
 * is executed op-by-op into Twinleaf effects when the attack is used. This is the Phase-4 core:
 * imperative ops (damage.deal, damage.placeCounters, condition.apply, heal), const counts, and
 * direct selectors (self / ownActive / opponentActive). Anything else throws — visible gaps.
 */

export interface IrOp {
  kind: string;
  amount?: { kind: string; value?: number };
  count?: number;
  condition?: string;
  removeMode?: boolean;
  target?: { selector?: string };
}

export interface IrFragment {
  label: string;
  cost: string[];
  body: IrOp[];
}

const CONDITIONS: Record<string, SpecialCondition> = {
  POISONED: SpecialCondition.POISONED,
  BURNED: SpecialCondition.BURNED,
  ASLEEP: SpecialCondition.ASLEEP,
  PARALYZED: SpecialCondition.PARALYZED,
  CONFUSED: SpecialCondition.CONFUSED,
};

function constValue(op: IrOp): number {
  const amount = op.amount;
  if (amount) {
    if (amount.kind !== 'const' || amount.value === undefined) {
      throw new Error(`[ir-interpreter] unsupported count form "${amount.kind}" for ${op.kind}`);
    }
    return amount.value;
  }
  if (op.count === undefined) {
    throw new Error(`[ir-interpreter] missing count for ${op.kind}`);
  }
  return op.count;
}

function resolveTarget(effect: AttackEffect, selector?: string): { player: Player; list: PokemonCardList } {
  switch (selector) {
    case 'self':
    case 'ownActive':
      return { player: effect.player, list: effect.player.active };
    case 'opponentActive':
    case 'defendingPokemon':
      return { player: effect.opponent, list: effect.opponent.active };
    default:
      throw new Error(`[ir-interpreter] unsupported selector "${selector}"`);
  }
}

function executeOp(store: StoreLike, state: State, effect: AttackEffect, op: IrOp): State {
  switch (op.kind) {
    case 'damage.deal': {
      const value = constValue(op);
      const selector = op.target?.selector;
      if (selector === 'opponentActive' || selector === 'defendingPokemon') {
        // Let the engine deal it (applies weakness/resistance), matching native attacks.
        effect.damage += value;
        return state;
      }
      const { list } = resolveTarget(effect, selector);
      const put = new PutDamageEffect(effect, value);
      put.target = list;
      return store.reduceEffect(state, put);
    }
    case 'damage.placeCounters': {
      // Damage counters bypass weakness/resistance; 1 counter = 10 HP.
      const { list } = resolveTarget(effect, op.target?.selector);
      const put = new PutDamageEffect(effect, constValue(op) * 10);
      put.target = list;
      return store.reduceEffect(state, put);
    }
    case 'condition.apply': {
      if (op.removeMode) {
        throw new Error('[ir-interpreter] condition removeMode not yet supported');
      }
      const condition = CONDITIONS[String(op.condition).toUpperCase()];
      if (condition === undefined) {
        throw new Error(`[ir-interpreter] unknown condition "${op.condition}"`);
      }
      const { list } = resolveTarget(effect, op.target?.selector);
      const add = new AddSpecialConditionsEffect(effect, [condition]);
      add.target = list;
      return store.reduceEffect(state, add);
    }
    case 'heal': {
      const { player, list } = resolveTarget(effect, op.target?.selector);
      return store.reduceEffect(state, new HealEffect(player, list, constValue(op)));
    }
    default:
      throw new Error(`[ir-interpreter] unsupported op "${op.kind}"`);
  }
}

export class InterpretedCard extends PokemonCard {
  public set = 'IR';
  public name = '';
  public fullName = '';
  public program: IrFragment[] = [];

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    for (let i = 0; i < this.program.length; i++) {
      if (WAS_ATTACK_USED(effect, i, this)) {
        let next = state;
        for (const op of this.program[i].body) {
          next = executeOp(store, next, effect as AttackEffect, op);
        }
        return next;
      }
    }
    return state;
  }
}

const COPIED_FIELDS = [
  'hp', 'cardType', 'weakness', 'resistance', 'retreat', 'stage', 'evolvesFrom',
  'name', 'fullName', 'set', 'setNumber', 'regulationMark', 'tags', 'superType',
] as const;

/**
 * Builds an InterpretedCard with the same engine-relevant stats as a native card (so a
 * differential run isolates the attack *effect*), but whose attacks execute the IR fragments.
 */
export function buildInterpretedCard(native: Card, fragments: IrFragment[]): InterpretedCard {
  const card = new InterpretedCard();
  for (const field of COPIED_FIELDS) {
    (card as any)[field] = (native as any)[field];
  }
  card.attacks = fragments.map((fr): Attack => ({
    name: fr.label,
    cost: fr.cost.map(costToCardType),
    damage: 0,
    text: '',
  }));
  card.program = fragments;
  return card;
}
