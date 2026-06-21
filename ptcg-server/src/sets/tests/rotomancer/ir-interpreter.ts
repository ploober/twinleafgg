import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Card } from '../../../game/store/card/card';
import { Attack } from '../../../game/store/card/pokemon-types';
import { SpecialCondition } from '../../../game/store/card/card-types';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { HealEffect } from '../../../game/store/effects/game-effects';
import { PutDamageEffect, AddSpecialConditionsEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { costToCardType } from './bridge';
import { evalPredicate, matchesV2Where } from './ir-predicates';
import { executeCardsMove, matchesCardPredicate } from './ir-cards';
import { resolveV2Selector, Target, V2Selector } from './ir-selectors';

/**
 * A minimal interpreter that executes a Rotomancer IR **v2** program as a Twinleaf card. Each
 * ATTACK fragment becomes an Attack whose printed damage is 0; the fragment `body` is executed
 * op-by-op into Twinleaf effects when the attack is used. Imperative ops (damage.deal,
 * damage.placeCounters, condition.apply, heal, energy.discard, cards.move); count forms const,
 * forEach, perCount, plusIf, coinFlipHeads; v2 compositional selectors ({side,spot}/{role}) and
 * sum-type predicates (see ir-selectors / ir-predicates). Control flow is the v2 top-level
 * `coinFlip`/`if` kinds (no more flow.control + kind2). Anything else throws — visible gaps.
 */

export interface CountForm {
  kind: string;        // const | forEach | perCount | plusIf | coinFlipHeads
  value?: number;      // const
  of?: string;         // forEach: pokemonInPlay | benchedPokemon | energyAttached | discardCards | …
  who?: string;        // forEach: self | opponent
  selector?: V2Selector;  // forEach with an explicit target (e.g. damageCounters on X)
  base?: number;       // perCount / plusIf
  per?: number;        // perCount
  count?: CountForm;   // perCount inner count
  bonus?: number;      // plusIf
  when?: any;          // plusIf predicate
  n?: number;          // coinFlipHeads: number of coins flipped
}

export interface IrOp {
  kind: string;
  amount?: CountForm;
  count?: number | CountForm;
  condition?: string;
  removeMode?: boolean;
  ignore?: string[];    // damage.deal: weakness | resistance | defenderEffects (all no-op in a mirror)
  target?: { of?: V2Selector; where?: any };
  when?: any;           // `if` op condition predicate
  then?: IrOp[];        // coinFlip heads branch / `if` true branch
  else?: IrOp[];        // `if` false branch
  card?: any;           // energy.discard: { from: { owner, zone }, predicate }
  scope?: string;       // continuous.modifier / rule.override: opponentNextTurn | ownNextAttack | …
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

// Heads count when flipping n coins under the harness's ALL_HEADS (heads unless the 10th flip,
// matching BotArbiter.flipCoin). A fresh game's only flip source is this attack, so this exactly
// reproduces what the native card's real flips would yield.
function headsOf(n: number): number {
  let heads = 0;
  for (let i = 1; i <= n; i++) {
    if (i % 10 !== 9) { heads++; }
  }
  return heads;
}

function countOf(effect: AttackEffect, form: CountForm): number {
  const of = form.of, who = form.who;
  const p = who === 'opponent' ? effect.opponent : effect.player;
  const bench = p.bench.filter(b => b.getPokemonCard() !== undefined).length;
  switch (of) {
    case 'pokemonInPlay': return (p.active.getPokemonCard() ? 1 : 0) + bench;
    case 'benchedPokemon': return bench;
    case 'energyAttached': return p.active.energies.cards.length;
    case 'discardCards': return p.discard.cards.length;
    case 'handCards': return p.hand.cards.length;
    case 'prizesTaken': return 6 - p.getPrizeLeft();
    case 'retreatCost': return p.active.getPokemonCard()?.retreat?.length ?? 0;
    case 'toolsAttached': return p.active.tools.length;
    case 'damageCounters': {
      // Damage counters on the form's explicit target, else on `who`'s active.
      const targets = form.selector ? resolveV2Selector(effect, form.selector) : [{ player: p, list: p.active }];
      return targets.reduce((sum, t) => sum + t.list.damage, 0) / 10;
    }
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
      return countOf(effect, amount);
    case 'coinFlipHeads':
      return headsOf(amount.n ?? 0);
    case 'perCount':
      return (amount.base ?? 0) + (amount.per ?? 0) * evalAmount(state, effect, amount.count);
    case 'minusPerCount':
      // "base, minus per for each X" — damage can't go negative.
      return Math.max(0, (amount.base ?? 0) - (amount.per ?? 0) * evalAmount(state, effect, amount.count));
    case 'plusIf':
      return (amount.base ?? 0) + (evalPredicate(state, effect, amount.when) ? (amount.bonus ?? 0) : 0);
    default:
      throw new Error(`[ir-interpreter] unsupported count form "${amount.kind}"`);
  }
}

// Resolves an op `target` ({ of: Selector, where?: Predicate }) to the concrete targets affected.
function resolveTargets(state: State, effect: AttackEffect, target?: { of?: V2Selector; where?: any }): Target[] {
  const targets = resolveV2Selector(effect, target?.of).filter(t => t.list.getPokemonCard() !== undefined);
  return target?.where ? targets.filter(t => matchesV2Where(state, effect, t.list, target.where)) : targets;
}

// energy.discard. The deterministic forms: discard exactly-N / all attached energy (optionally
// filtered by an isa predicate, e.g. a [R] Energy) from the target Pokémon — self or opponent's
// active. (energy.attach / energy.move, and upTo/anyAmount counts, are player-choice or
// zone-dependent and are separate v2 kinds / forms left unsupported — they throw → card skipped.)
function executeEnergyDiscard(store: StoreLike, state: State, effect: AttackEffect, op: IrOp): State {
  const from = op.card?.from;
  if (from?.zone !== 'attached') {
    throw new Error(`[ir-interpreter] energy.discard from ${from?.owner}/${from?.zone} not supported`);
  }
  const count: any = op.count;
  // The energies discarded are those attached to the resolved target Pokémon (each goes to its
  // owner's discard), matching the from-card predicate (Energy supertype / specific type).
  for (const { player, list } of resolveTargets(state, effect, op.target)) {
    const energies = list.cards.filter(c => c instanceof EnergyCard && matchesCardPredicate(c, from.predicate));
    let n: number;
    if (count?.kind === 'all') {
      n = energies.length;
    } else if (count?.kind === 'exactly') {
      n = count.n ?? 0;
    } else {
      throw new Error(`[ir-interpreter] energy discard count "${count?.kind}" not supported`);
    }
    list.moveCardsTo(energies.slice(0, n), player.discard);
  }
  return state;
}

function runBranch(store: StoreLike, state: State, effect: AttackEffect, branch?: IrOp[]): State {
  let next = state;
  for (const sub of branch ?? []) {
    next = executeOp(store, next, effect, sub);
  }
  return next;
}

// energy.attach: move the first-N matching energy from a source zone (hand/deck/discard) onto the
// target Pokémon. On the differential's board the source is usually empty (→ no-op, a genuine
// forced outcome); a non-trivial pick (e.g. a deck search over many energies) is flagged by the
// harness's ambiguity guard and skipped, so this never false-mismatches.
function executeEnergyAttach(store: StoreLike, state: State, effect: AttackEffect, op: IrOp): State {
  const from = op.card?.from;
  const owner = from?.owner === 'opponent' ? effect.opponent : effect.player;
  let source: any;
  switch (from?.zone) {
    case 'hand': source = owner.hand; break;
    case 'discard': source = owner.discard; break;
    // 'deck' is a search (a player choice over the whole deck — and the differential's deck is
    // filler energy), so attaching from it isn't a genuine forced outcome → leave unsupported.
    default: throw new Error(`[ir-interpreter] energy.attach from zone "${from?.zone}" not supported`);
  }
  const count: any = op.count;
  let n: number;
  if (count?.kind === 'exactly') { n = count.n ?? 0; }
  else if (count?.kind === 'upTo') { n = count.max ?? 0; }
  else if (count?.kind === 'all') { n = Infinity; }
  else { throw new Error(`[ir-interpreter] energy.attach count "${count?.kind}" not supported`); }

  const matching = source.cards.filter((c: any) => c instanceof EnergyCard && matchesCardPredicate(c, from.predicate));
  const toAttach = matching.slice(0, n === Infinity ? matching.length : n);
  const targets = resolveTargets(state, effect, op.target);
  if (targets.length > 0) {
    source.moveCardsTo(toAttach, targets[0].list);
  }
  return state;
}

function executeOp(store: StoreLike, state: State, effect: AttackEffect, op: IrOp): State {
  switch (op.kind) {
    case 'damage.deal': {
      // `ignore` (weakness/resistance/defenderEffects) is inert in a mirror match — no-op.
      const value = evalAmount(state, effect, op.amount);
      const of = op.target?.of;
      const toDefender = !!of && (of.role === 'defending' || (of.side === 'opponent' && of.spot === 'active'));
      for (const { list } of resolveTargets(state, effect, op.target)) {
        if (toDefender && list === effect.opponent.active) {
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
      for (const { list } of resolveTargets(state, effect, op.target)) {
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
      for (const { list } of resolveTargets(state, effect, op.target)) {
        const add = new AddSpecialConditionsEffect(effect, [condition]);
        add.target = list;
        state = store.reduceEffect(state, add);
      }
      return state;
    }
    case 'heal': {
      const value = evalAmount(state, effect, op.amount);
      for (const { player, list } of resolveTargets(state, effect, op.target)) {
        state = store.reduceEffect(state, new HealEffect(player, list, value));
      }
      return state;
    }
    case 'cards.move':
      return executeCardsMove(store, state, effect, op);
    case 'energy.discard':
      return executeEnergyDiscard(store, state, effect, op);
    case 'energy.attach':
      return executeEnergyAttach(store, state, effect, op);
    case 'hand.reveal':
      // Revealing a hand moves no cards and changes no observable zone — snapshot-neutral no-op.
      return state;
    case 'pokemon.knockOut': {
      // Knock out each resolved target by dealing lethal damage through the normal pipeline, so the
      // engine awards the prize, discards, and promotes (a direct KnockOutEffect skips the prize
      // flow). Mirrors how native "knock out" attacks do it (e.g. KnockOutOpponentEffect(_, 999)).
      for (const { list } of resolveTargets(state, effect, op.target)) {
        const put = new PutDamageEffect(effect, 999);
        put.target = list;
        state = store.reduceEffect(state, put);
      }
      return state;
    }
    case 'pokemon.discard': {
      // Literal "discard this Pokémon and everything attached" — no prize (cf. a knock-out).
      for (const { player, list } of resolveTargets(state, effect, op.target)) {
        list.moveCardsTo(list.cards.slice().concat(list.tools.slice()), player.discard);
      }
      return state;
    }
    case 'continuous.modifier':
    case 'rule.override':
      // The v2 split of attack.lockOrModify. Every scope (opponentNextTurn, ownNextAttack,
      // yourNextTurn, untilLeavesActive) is a future/persistent rider — attack/retreat shutoff,
      // damage debuff/reduction, prevent-damage, etc. None change the immediate post-attack
      // snapshot the differential compares, so both are recognized no-ops. (A multi-turn
      // differential would be needed to exercise these; out of scope here.)
      return state;
    case 'coinFlip':
      // Under the harness (ALL_HEADS) a coin flip is heads → the `then` branch.
      return runBranch(store, state, effect, op.then);
    case 'if':
      return evalPredicate(state, effect, op.when)
        ? runBranch(store, state, effect, op.then)
        : runBranch(store, state, effect, op.else);
    default:
      // choice / iterate / costGate and the new pokemon.* / damage.move ops are unsupported.
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
