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
import { evalPredicate } from './ir-predicates';
import { executeCardsMove } from './ir-cards';

/**
 * A minimal interpreter that executes a Rotomancer IR program as a Twinleaf card. Each ATTACK
 * fragment becomes an Attack whose printed damage is 0; the fragment `body` is the program and
 * is executed op-by-op into Twinleaf effects when the attack is used. This is the Phase-4 core:
 * imperative ops (damage.deal, damage.placeCounters, condition.apply, heal); count forms const,
 * forEach (pokemonInPlay/benchedPokemon/energyAttached/discardCards), perCount, and plusIf
 * (predicate-gated bonus, see ir-predicates); and direct selectors (self/ownActive/opponentActive).
 * Anything else throws — visible gaps.
 */

export interface CountForm {
  kind: string;        // const | forEach | perCount | plusIf
  value?: number;      // const
  of?: string;         // forEach: pokemonInPlay | benchedPokemon | energyAttached | discardCards
  who?: string;        // forEach: self | opponent
  base?: number;       // perCount / plusIf
  per?: number;        // perCount
  count?: CountForm;   // perCount inner count
  bonus?: number;      // plusIf
  when?: any;          // plusIf predicate
}

export interface IrOp {
  kind: string;
  amount?: CountForm;
  count?: number | CountForm;
  condition?: string;
  removeMode?: boolean;
  modifiers?: string[];
  target?: { selector?: string };
  kind2?: string;       // flow.control: predicate | coinFlip | costGate | playerChoice | ...
  predicate?: any;      // flow.control kind2=predicate
  then?: IrOp[];        // flow.control heads/true branch
  else?: IrOp[];        // flow.control tails/false branch
}

// Damage modifiers that are no-ops in a mirror match (weakness/resistance never apply there).
const NOOP_MODIFIERS = new Set(['applyWeakness:false', 'applyResistance:false']);

function assertModifiersSupported(op: IrOp): void {
  for (const m of op.modifiers ?? []) {
    if (!NOOP_MODIFIERS.has(m)) {
      throw new Error(`[ir-interpreter] unsupported damage modifier "${m}"`);
    }
  }
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

function countOf(effect: AttackEffect, of?: string, who?: string): number {
  const p = who === 'opponent' ? effect.opponent : effect.player;
  const bench = p.bench.filter(b => b.getPokemonCard() !== undefined).length;
  switch (of) {
    case 'pokemonInPlay': return (p.active.getPokemonCard() ? 1 : 0) + bench;
    case 'benchedPokemon': return bench;
    case 'energyAttached': return p.active.energies.cards.length;
    case 'discardCards': return p.discard.cards.length;
    default: throw new Error(`[ir-interpreter] unsupported forEach.of "${of}"`);
  }
}

function evalAmount(state: State, effect: AttackEffect, amount?: number | CountForm): number {
  if (typeof amount === 'number') {
    return amount;
  }
  if (!amount) {
    throw new Error('[ir-interpreter] missing count/amount');
  }
  switch (amount.kind) {
    case 'const':
      if (amount.value === undefined) throw new Error('[ir-interpreter] const missing value');
      return amount.value;
    case 'forEach':
      return countOf(effect, amount.of, amount.who);
    case 'perCount':
      return (amount.base ?? 0) + (amount.per ?? 0) * evalAmount(state, effect, amount.count);
    case 'plusIf':
      return (amount.base ?? 0) + (evalPredicate(state, effect, amount.when) ? (amount.bonus ?? 0) : 0);
    default:
      throw new Error(`[ir-interpreter] unsupported count form "${amount.kind}"`);
  }
}

interface Target { player: Player; list: PokemonCardList; }

function benched(p: Player): Target[] {
  return p.bench.filter(b => b.getPokemonCard() !== undefined).map(list => ({ player: p, list }));
}

// A per-target predicate restricts WHICH resolved targets are actually affected (e.g. only
// Pokémon that already have damage, or that have an Ability). Unknown leaves throw.
function matchesTargetPredicate(list: PokemonCardList, pred: any): boolean {
  if (!pred) return true;
  if (Array.isArray(pred.and)) return pred.and.every((p: any) => matchesTargetPredicate(list, p));
  if (Array.isArray(pred.or)) return pred.or.some((p: any) => matchesTargetPredicate(list, p));
  if (pred.not !== undefined) return !matchesTargetPredicate(list, pred.not);
  if (pred.damageState) {
    if (pred.damageState.hasAny !== undefined) return pred.damageState.hasAny ? list.damage > 0 : list.damage === 0;
    if (pred.damageState.full !== undefined) return pred.damageState.full ? list.damage === 0 : list.damage > 0;
  }
  if (pred.hasAbility !== undefined) {
    const card = list.getPokemonCard();
    return !!card && card.powers.length > 0;
  }
  throw new Error(`[ir-interpreter] unsupported target predicate "${Object.keys(pred).join(',')}"`);
}

function selectByName(effect: AttackEffect, selector?: string): Target[] {
  const own = effect.player, opp = effect.opponent;
  switch (selector) {
    case undefined:
    case 'self':
    case 'ownActive': return [{ player: own, list: own.active }];
    case 'opponentActive':
    case 'defendingPokemon': return [{ player: opp, list: opp.active }];
    case 'eachOwnBench': return benched(own);
    case 'eachOpponentBench': return benched(opp);
    case 'bothActives': return [{ player: own, list: own.active }, { player: opp, list: opp.active }];
    case 'allOwnPokemon':
    case 'ownPokemon': return [{ player: own, list: own.active }, ...benched(own)];
    case 'allOpponentPokemon':
    case 'opponentPokemon': return [{ player: opp, list: opp.active }, ...benched(opp)];
    default:
      throw new Error(`[ir-interpreter] unsupported selector "${selector}"`);
  }
}

// Resolves an op `target` ({selector, predicate?}) to the concrete targets that are affected.
function resolveTargets(effect: AttackEffect, target?: { selector?: string; predicate?: any }): Target[] {
  const targets = selectByName(effect, target?.selector).filter(t => t.list.getPokemonCard() !== undefined);
  return target?.predicate ? targets.filter(t => matchesTargetPredicate(t.list, target.predicate)) : targets;
}

function executeOp(store: StoreLike, state: State, effect: AttackEffect, op: IrOp): State {
  switch (op.kind) {
    case 'damage.deal': {
      assertModifiersSupported(op);
      const value = evalAmount(state, effect, op.amount);
      const sel = op.target?.selector;
      const viaEngine = sel === 'opponentActive' || sel === 'defendingPokemon';
      for (const { list } of resolveTargets(effect, op.target)) {
        if (viaEngine && list === effect.opponent.active) {
          // Defender damage goes through the normal pipeline so weakness/resistance/prevention apply.
          effect.damage += value;
        } else {
          // Multi-target / non-defender damage is spread damage — direct, weakness-free.
          const put = new PutDamageEffect(effect, value);
          put.target = list;
          state = store.reduceEffect(state, put);
        }
      }
      return state;
    }
    case 'damage.placeCounters': {
      // Damage counters bypass weakness/resistance; 1 counter = 10 HP.
      const value = evalAmount(state, effect, op.count) * 10;
      for (const { list } of resolveTargets(effect, op.target)) {
        const put = new PutDamageEffect(effect, value);
        put.target = list;
        state = store.reduceEffect(state, put);
      }
      return state;
    }
    case 'condition.apply': {
      if (op.removeMode) {
        throw new Error('[ir-interpreter] condition removeMode not yet supported');
      }
      const condition = CONDITIONS[String(op.condition).toUpperCase()];
      if (condition === undefined) {
        throw new Error(`[ir-interpreter] unknown condition "${op.condition}"`);
      }
      for (const { list } of resolveTargets(effect, op.target)) {
        const add = new AddSpecialConditionsEffect(effect, [condition]);
        add.target = list;
        state = store.reduceEffect(state, add);
      }
      return state;
    }
    case 'heal': {
      const value = evalAmount(state, effect, op.amount);
      for (const { player, list } of resolveTargets(effect, op.target)) {
        state = store.reduceEffect(state, new HealEffect(player, list, value));
      }
      return state;
    }
    case 'cards.move':
      return executeCardsMove(store, state, effect, op);
    case 'flow.control': {
      // Under the test harness (ALL_HEADS, no choices) a coin flip is heads → the `then` branch.
      let branch: IrOp[];
      if (op.kind2 === 'predicate') {
        branch = evalPredicate(state, effect, op.predicate) ? (op.then ?? []) : (op.else ?? []);
      } else if (op.kind2 === 'coinFlip') {
        branch = op.then ?? [];
      } else {
        throw new Error(`[ir-interpreter] unsupported flow.control kind2 "${op.kind2}"`);
      }
      let next = state;
      for (const sub of branch) {
        next = executeOp(store, next, effect, sub);
      }
      return next;
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
    cost: fr.cost.filter(c => c.toUpperCase() !== 'FREE').map(costToCardType),
    damage: 0,
    text: '',
  }));
  card.program = fragments;
  return card;
}
