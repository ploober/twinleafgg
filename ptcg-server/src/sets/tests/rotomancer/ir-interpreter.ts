import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Card } from '../../../game/store/card/card';
import { Attack } from '../../../game/store/card/pokemon-types';
import { SpecialCondition } from '../../../game/store/card/card-types';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { HealEffect } from '../../../game/store/effects/game-effects';
import { PutDamageEffect, PutCountersEffect, AddSpecialConditionsEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED, BLOCK_RETREAT, BLOCK_RETREAT_IF_MARKER } from '../../../game/store/prefabs/prefabs';
import { MarkerConstants } from '../../../game/store/markers/marker-constants';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { ChoosePokemonPrompt } from '../../../game/store/prompts/choose-pokemon-prompt';
import { GameMessage } from '../../../game/game-message';
import { costToCardType } from './bridge';
import { evalPredicate, matchesV2Where } from './ir-predicates';
import { executeCardsMove, matchesCardPredicate } from './ir-cards';
import { resolveV2Selector, resolveChoiceTarget, isSingleChoiceTarget, Target, V2Selector } from './ir-selectors';

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
  untilHpRemaining?: number;  // damage.placeCounters: place counters until the target has N HP left
  targetCount?: number;       // affect-target ops: choose N distinct Pokémon, each taking `amount` ("2 of your opponent's Pokémon")
  condition?: string;
  removeMode?: boolean;
  ignore?: string[];    // damage.deal: weakness | resistance | defenderEffects (all no-op in a mirror)
  target?: { of?: V2Selector; where?: any };
  when?: any;           // `if` op condition predicate
  then?: IrOp[];        // coinFlip heads branch / `if` true branch
  else?: IrOp[];        // `if` false branch
  card?: any;           // energy.discard: { from: { owner, zone }, predicate }
  scope?: string;       // continuous.modifier / rule.override: opponentNextTurn | ownNextAttack | …
  appliesTo?: any;      // continuous.modifier: selector the modifier attaches to
  modifier?: any;       // continuous.modifier: { kind, amount?, attackName?, matching? }
  override?: any;       // rule.override: { kind, target?, attackName? }
}

export interface IrFragment {
  label: string;
  cost: string[];
  body: IrOp[];
}

// "Prevent all damage" modeled as an unreachably-large damageReductionNextTurn: any probe (sized
// under the card's max HP, ≤ ~340) is reduced to 0, matching the native preventDefault path.
const PREVENT_ALL_DAMAGE_SENTINEL = 1_000_000;

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
  // owner's discard), matching the card predicate (Energy supertype / specific type / Special).
  // NB: the predicate lives at op.card.predicate (a sibling of op.card.from), not op.card.from.predicate.
  const predicate = op.card?.predicate;
  for (const { player, list } of resolveTargets(state, effect, op.target)) {
    const energies = list.cards.filter(c => c instanceof EnergyCard && matchesCardPredicate(c, predicate));
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

// Continuation-passing op runner. Runs ops[index..] then calls `done(state)`. A synchronous op hands
// its post-op state straight to the continuation; a prompt-emitting op (Stage B) emits a real engine
// prompt and resumes the remaining ops inside the prompt callback, so a player choice mid-body (or
// inside an if/coinFlip branch) is faithful for any op order. An all-synchronous body recurses fully
// synchronously and returns the same final state as a plain loop — no behavior change for cards that
// emit no prompt.
function runOps(
  store: StoreLike, state: State, effect: AttackEffect,
  ops: IrOp[], index: number, done: (state: State) => State
): State {
  if (index >= ops.length) { return done(state); }
  return executeOp(store, state, effect, ops[index],
    next => runOps(store, next, effect, ops, index + 1, done));
}

// Stage B: a single player-choice affect-target. Emit the SAME ChoosePokemonPrompt native emits
// (geometry from the selector; a `where` predicate → the failing candidates marked `blocked`) and
// apply the op to the chosen Pokémon in the callback — the way native cards damage a chosen target
// (PutDamageEffect inside the callback, never effect.damage +=, which the attack reducer has already
// consumed by the time a deferred prompt resolves). State is mutated in place, so the captured `state`
// is the live object; the continuation runs the rest of the body once the choice resolves.
function affectChoiceTarget(
  store: StoreLike, state: State, effect: AttackEffect, op: IrOp,
  apply: (state: State, target: Target) => State, cont: (state: State) => State
): State {
  const choice = resolveChoiceTarget(effect, op.target!.of!);
  const where = op.target?.where;
  const eligible = where
    ? choice.candidates.filter(c => matchesV2Where(state, effect, c.list, where))
    : choice.candidates;
  // No legal target → snapshot-neutral no-op (native deals nothing when nothing is targetable).
  if (eligible.length === 0) { return cont(state); }
  const blocked = choice.candidates.filter(c => eligible.indexOf(c) === -1).map(c => c.target);
  // `targetCount` ("50 damage to 2 of your opponent's Pokémon") chooses N distinct Pokémon, each
  // taking `amount`; default 1. Pick as many as exist (min) up to N (max), as native does on a short board.
  const pick = op.targetCount ?? 1;
  const prompt = new ChoosePokemonPrompt(
    effect.player.id, GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
    choice.playerType, choice.slots,
    { min: Math.min(pick, eligible.length), max: pick, allowCancel: false, blocked }
  );
  return store.prompt(state, prompt, (chosen: PokemonCardList[] | null) => {
    let next = state;
    for (const list of chosen ?? []) {
      const cand = choice.candidates.find(c => c.list === list);
      const player = cand ? cand.player
        : (list === effect.opponent.active || effect.opponent.bench.indexOf(list) !== -1 ? effect.opponent : effect.player);
      next = apply(next, { player, list });
    }
    return cont(next);
  });
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

  // The predicate lives at op.card.predicate (sibling of op.card.from), not op.card.from.predicate.
  const matching = source.cards.filter((c: any) => c instanceof EnergyCard && matchesCardPredicate(c, op.card?.predicate));
  const toAttach = matching.slice(0, n === Infinity ? matching.length : n);
  const targets = resolveTargets(state, effect, op.target);
  if (targets.length > 0) {
    source.moveCardsTo(toAttach, targets[0].list);
  }
  return state;
}

function executeOp(store: StoreLike, state: State, effect: AttackEffect, op: IrOp, cont: (state: State) => State): State {
  switch (op.kind) {
    case 'damage.deal': {
      if (isSingleChoiceTarget(op.target?.of)) {
        // Chosen-target damage is weakness-free (like native DAMAGE_OPPONENT_POKEMON), applied in the callback.
        return affectChoiceTarget(store, state, effect, op, (s, t) => {
          const put = new PutDamageEffect(effect, evalAmount(s, effect, op.amount));
          put.target = t.list;
          return store.reduceEffect(s, put);
        }, cont);
      }
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
      return cont(state);
    }
    case 'damage.placeCounters': {
      // "Put damage counters" — direct counter placement via PutCountersEffect (bypasses
      // weakness/resistance and applies to any Pokémon, including the bench; PutDamageEffect only
      // lands on the defender). 1 counter = 10 HP. `untilHpRemaining` brings each target down to N
      // HP remaining (never heals).
      const place = (s: State, list: PokemonCardList): State => {
        let value: number;
        if (op.untilHpRemaining !== undefined) {
          const card = list.getPokemonCard() as PokemonCard;
          value = Math.max(0, (card.hp - list.damage) - op.untilHpRemaining);
        } else {
          value = evalAmount(s, effect, op.count) * 10;
        }
        const put = new PutCountersEffect(effect, value);
        put.target = list;
        return store.reduceEffect(s, put);
      };
      if (isSingleChoiceTarget(op.target?.of)) {
        return affectChoiceTarget(store, state, effect, op, (s, t) => place(s, t.list), cont);
      }
      for (const { list } of resolveTargets(state, effect, op.target)) {
        state = place(state, list);
      }
      return cont(state);
    }
    case 'condition.apply': {
      if (op.removeMode) {
        throw new Error('[ir-interpreter] condition removeMode not yet supported');
      }
      const condition = CONDITIONS[String(op.condition).toUpperCase()];
      if (condition === undefined) {
        throw new Error(`[ir-interpreter] unknown condition "${op.condition}"`);
      }
      const applyCond = (s: State, list: PokemonCardList): State => {
        const add = new AddSpecialConditionsEffect(effect, [condition]);
        add.target = list;
        return store.reduceEffect(s, add);
      };
      if (isSingleChoiceTarget(op.target?.of)) {
        return affectChoiceTarget(store, state, effect, op, (s, t) => applyCond(s, t.list), cont);
      }
      for (const { list } of resolveTargets(state, effect, op.target)) {
        state = applyCond(state, list);
      }
      return cont(state);
    }
    case 'heal': {
      if (isSingleChoiceTarget(op.target?.of)) {
        return affectChoiceTarget(store, state, effect, op,
          (s, t) => store.reduceEffect(s, new HealEffect(t.player, t.list, evalAmount(s, effect, op.amount))), cont);
      }
      const value = evalAmount(state, effect, op.amount);
      for (const { player, list } of resolveTargets(state, effect, op.target)) {
        state = store.reduceEffect(state, new HealEffect(player, list, value));
      }
      return cont(state);
    }
    case 'cards.move':
      return cont(executeCardsMove(store, state, effect, op));
    case 'energy.discard':
      return cont(executeEnergyDiscard(store, state, effect, op));
    case 'energy.attach':
      return cont(executeEnergyAttach(store, state, effect, op));
    case 'hand.reveal':
      // Revealing a hand moves no cards and changes no observable zone — snapshot-neutral no-op.
      return cont(state);
    case 'pokemon.knockOut': {
      // Knock out each resolved target by dealing lethal damage through the normal pipeline, so the
      // engine awards the prize, discards, and promotes (a direct KnockOutEffect skips the prize
      // flow). Mirrors how native "knock out" attacks do it (e.g. KnockOutOpponentEffect(_, 999)).
      for (const { list } of resolveTargets(state, effect, op.target)) {
        const put = new PutDamageEffect(effect, 999);
        put.target = list;
        state = store.reduceEffect(state, put);
      }
      return cont(state);
    }
    case 'pokemon.discard': {
      // Literal "discard this Pokémon and everything attached" — no prize (cf. a knock-out).
      for (const { player, list } of resolveTargets(state, effect, op.target)) {
        list.moveCardsTo(list.cards.slice().concat(list.tools.slice()), player.discard);
      }
      return cont(state);
    }
    case 'continuous.modifier': {
      // The v2 split of attack.lockOrModify (next-turn riders). These don't change the immediate
      // post-attack snapshot, so most stay no-ops there — but the lock differential probes them on
      // the following turn, so the ones backed by an engine-enforced property are applied here.
      const mod = op.modifier;
      if (mod?.kind === 'damageReduction') {
        // "this Pokémon takes N less damage during the opponent's next turn" — the engine reduces
        // incoming damage by damageReductionNextTurn and clears it at the opponent's turn end.
        const amount = evalAmount(state, effect, mod.amount);
        for (const { list } of resolveTargets(state, effect, { of: op.appliesTo })) {
          list.damageReductionNextTurn += amount;
        }
      } else if (mod?.kind === 'preventDamage') {
        // "During the opponent's next turn, prevent all damage done to this Pokémon by attacks from
        // <matching> Pokémon." The native card installs a marker and zeroes the incoming PutDamage
        // (preventDefault) iff the *attacker* satisfies `matching`. In the mirror lock probe the
        // next-turn attacker is the same printing as this Pokémon, so `matching` is decided now
        // against self; when it holds (or there's no predicate → prevent all) the prevention is
        // total, modeled by a large damageReductionNextTurn sentinel the engine already enforces.
        const selfCard = effect.player.active.getPokemonCard();
        const applies = mod.matching === undefined
          || (selfCard !== undefined && matchesCardPredicate(selfCard, mod.matching));
        if (applies) {
          for (const { list } of resolveTargets(state, effect, { of: op.appliesTo })) {
            list.damageReductionNextTurn += PREVENT_ALL_DAMAGE_SENTINEL;
          }
        }
      } else if (mod?.kind === 'damageDebuff') {
        // "Attacks used by the Defending Pokémon do N less damage during the opponent's next turn"
        // (Growl/Charm). Natively a marker on the defender that reduces *that Pokémon's outgoing*
        // damage. In the mirror lock probe the defender's only next-turn attack hits this Pokémon,
        // so the observable — this Pokémon takes N less — is reproduced by the same incoming
        // damageReductionNextTurn property applied to self (the lock user's active). Only the
        // attacker-side `defending` shape maps this way; anything else is an unmodeled geometry.
        if (op.appliesTo?.role !== 'defending') {
          throw new Error(`[ir-interpreter] damageDebuff appliesTo "${JSON.stringify(op.appliesTo)}" not modeled`);
        }
        effect.player.active.damageReductionNextTurn += evalAmount(state, effect, mod.amount);
      }
      return cont(state);
    }
    case 'rule.override': {
      // Next-turn rule bans (retreat/attack shutoff, item lock). Snapshot-neutral, so inert in the
      // single-turn differential — but the lock spec probes them on the following turn.
      const ovr = op.override;
      if (ovr?.kind === 'retreatShutoff' && ovr.target?.role === 'defending') {
        // "The Defending Pokémon can't retreat during the opponent's next turn." Reproduce it with
        // the exact native prefab: BLOCK_RETREAT installs DEFENDING_POKEMON_CANNOT_RETREAT_MARKER on
        // the defender keyed to this card; InterpretedCard.reduceEffect enforces it with
        // BLOCK_RETREAT_IF_MARKER, just like every native retreat-lock card. `self` is this
        // interpreted card (the attacker's own active in a mirror), so the marker source matches.
        const self = effect.player.active.getPokemonCard();
        if (self) { state = BLOCK_RETREAT(store, state, effect, self); }
      } else if (ovr?.kind === 'attackShutoff' && ovr.target?.role === 'self'
        && op.scope === 'ownNextAttack' && typeof ovr.attackName === 'string') {
        // "During your next turn, this Pokémon can't use <attackName>" — the recharge lock (e.g.
        // Mega Lucario ex / Mega Brave). Push the name to the engine's central
        // cannotUseAttacksNextTurnPending; the engine promotes it at this turn's end and throws
        // BLOCKED_BY_EFFECT (game-effect.ts) if the attack is attempted next turn. Identical to how
        // the native cards do it, so the probe verifies the IR names the right attack.
        const pending = effect.player.active.cannotUseAttacksNextTurnPending;
        if (!pending.includes(ovr.attackName)) { pending.push(ovr.attackName); }
      }
      return cont(state);
    }
    case 'coinFlip':
      // Under the harness (ALL_HEADS) a coin flip is heads → the `then` branch, then the rest of the body.
      return runOps(store, state, effect, op.then ?? [], 0, cont);
    case 'if':
      return runOps(store, state, effect,
        (evalPredicate(state, effect, op.when) ? op.then : op.else) ?? [], 0, cont);
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
    // Enforce any next-turn retreat lock this card installed (mirrors native retreat-lock cards,
    // which call this same prefab in their reduceEffect). Throws BLOCKED_BY_EFFECT on a blocked
    // RetreatEffect; inert for every other effect.
    BLOCK_RETREAT_IF_MARKER(effect, MarkerConstants.DEFENDING_POKEMON_CANNOT_RETREAT_MARKER, this);
    for (let i = 0; i < this.program.length; i++) {
      if (WAS_ATTACK_USED(effect, i, this)) {
        // Continuation-passing so a player-choice op can emit a prompt and resume the rest of the body
        // in its callback (Stage B); the terminal continuation is the identity (return the final state).
        return runOps(store, state, effect as AttackEffect, this.program[i].body, 0, s => s);
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
