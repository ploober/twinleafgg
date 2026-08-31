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
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { BLOCK_RETREAT, OPPONENT_CANNOT_PLAY_ITEM_CARDS } from '../../../game/store/prefabs/effect-of-attack-prefabs';
import { NEXT_TURN_ATTACK_BONUS, NEXT_TURN_ATTACK_BASE_DAMAGE } from '../../../game/store/prefabs/attack-effects';
import { PUT_X_DAMAGE_COUNTERS_IN_ANY_WAY_YOU_LIKE } from '../../../game/store/prefabs/attack-effects';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { CardList } from '../../../game/store/state/card-list';
import { ChoosePokemonPrompt } from '../../../game/store/prompts/choose-pokemon-prompt';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { ShuffleDeckPrompt } from '../../../game/store/prompts/shuffle-prompt';
import { ConfirmPrompt } from '../../../game/store/prompts/confirm-prompt';
import { SlotType } from '../../../game/store/actions/play-card-action';
import { GameMessage } from '../../../game/game-message';
import { costToCardType } from './bridge';
import { evalPredicate, matchesV2Where } from './ir-predicates';
import { executeCardsMove, matchesCardPredicate } from './ir-cards';
import { resolveV2Selector, resolveChoiceTarget, isSingleChoiceTarget, spatialPool, Target, V2Selector } from './ir-selectors';

// A fragment-scoped binding register: a producing op (`energy.discard` with `bindAs`) records the
// card list it discarded under a name, and a later `countOf` amount reads its cardinality ("90 damage
// for each card you discarded in this way"). Single-assignment, fragment-execution lifetime; threaded
// as one mutable object through runOps so a producer's write is visible to a later consumer — even
// across a deferred-prompt continuation (the same object is captured in the prompt callback).
export type Bindings = Record<string, Card[]>;

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
  n?: number;          // coinFlipHeads: number of coins flipped; exactly: count
  max?: number;        // upTo: the upper bound (discard/move up to N)
  ref?: string;        // countOf: name of the runtime binding whose cardinality this returns
  bothSides?: boolean; // forEach: count over BOTH players' Pokémon (e.g. "tools attached to all Pokémon")
}

export interface IrOp {
  kind: string;
  amount?: CountForm;
  count?: number | CountForm;
  bindAs?: string;            // energy.discard / cards.move: name the moved card list for a later countOf
  untilHpRemaining?: number;  // damage.placeCounters: place counters until the target has N HP left
  targetCount?: number;       // affect-target ops: choose N distinct Pokémon, each taking `amount` ("2 of your opponent's Pokémon")
  condition?: string;
  removeMode?: boolean;
  ignore?: string[];    // damage.deal: weakness | resistance | defenderEffects (all no-op in a mirror)
  target?: { of?: V2Selector; where?: any };
  when?: any;           // `if` op condition predicate
  then?: IrOp[];        // coinFlip heads branch / `if` true branch / `choice` "you may" branch
  else?: IrOp[];        // `if` false branch (always empty for `choice`)
  chooser?: string;     // `choice`: who decides (self) — a "you may" optional effect
  over?: CountForm;     // `iterate`: how many times to run `body`
  body?: IrOp[];        // `iterate`: the per-iteration ops
  card?: any;           // energy.discard / energy.move: { from: { owner, zone }, predicate }
  source?: V2Selector;  // energy.move: the Pokémon to take energy FROM
  select?: any;         // cards.move: { chooser, where }
  from?: any;           // cards.move: { owner, zone }
  to?: any;             // cards.move: { owner, zone }
  visibility?: string;  // cards.move: 'search' → deck search (unsupported)
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
    case 'toolsAttached': {
      // Tools attached across a player's Pokémon (active + bench). `bothSides` ("attached to all
      // Pokémon") sums both players. Tools live on PokemonCardList.tools (the engine's real storage).
      const toolsOf = (pl: any) => [pl.active, ...pl.bench].reduce((s: number, l: any) => s + l.tools.length, 0);
      return form.bothSides ? toolsOf(effect.player) + toolsOf(effect.opponent) : toolsOf(p);
    }
    case 'damageCounters': {
      // Damage counters on the form's explicit target, else on `who`'s active.
      const targets = form.selector ? resolveV2Selector(effect, form.selector) : [{ player: p, list: p.active }];
      return targets.reduce((sum, t) => sum + t.list.damage, 0) / 10;
    }
    default: throw new Error(`[ir-interpreter] unsupported forEach.of "${of}"`);
  }
}

function evalAmount(state: State, effect: AttackEffect, amount?: number | CountForm, bindings?: Bindings): number {
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
      return (amount.base ?? 0) + (amount.per ?? 0) * evalAmount(state, effect, amount.count, bindings);
    case 'minusPerCount':
      // "base, minus per for each X" — damage can't go negative.
      return Math.max(0, (amount.base ?? 0) - (amount.per ?? 0) * evalAmount(state, effect, amount.count, bindings));
    case 'plusIf':
      return (amount.base ?? 0) + (evalPredicate(state, effect, amount.when) ? (amount.bonus ?? 0) : 0);
    case 'countOf': {
      // Cardinality of a runtime binding a PRECEDING op named via `bindAs` ("90 damage for each card
      // you discarded in this way"). Unbound → a producer shape we don't reproduce; throw → the card
      // is a counted skip (never a false count).
      const ref = amount.ref;
      if (ref === undefined || !bindings || !(ref in bindings)) {
        throw new Error(`[ir-interpreter] countOf ref "${ref}" not bound`);
      }
      return bindings[ref].length;
    }
    default:
      throw new Error(`[ir-interpreter] unsupported count form "${amount.kind}"`);
  }
}

// First eligible target of a selector — for a single-pick (`quantity:'one'`/`chooser`) selector use the
// choice candidates (active-before-bench, low-index, the harness order); otherwise the first resolved.
function firstTarget(effect: AttackEffect, sel?: V2Selector): Target | undefined {
  if (sel === undefined) { return undefined; }
  if (isSingleChoiceTarget(sel)) {
    const c = resolveChoiceTarget(effect, sel).candidates;
    return c.length ? { player: c[0].player, list: c[0].list } : undefined;
  }
  const targets = resolveV2Selector(effect, sel).filter(t => t.list.getPokemonCard() !== undefined);
  return targets.length ? targets[0] : undefined;
}

// Resolves an op `target` ({ of: Selector, where?: Predicate }) to the concrete targets affected.
function resolveTargets(state: State, effect: AttackEffect, target?: { of?: V2Selector; where?: any }): Target[] {
  const targets = resolveV2Selector(effect, target?.of).filter(t => t.list.getPokemonCard() !== undefined);
  return target?.where ? targets.filter(t => matchesV2Where(state, effect, t.list, target.where)) : targets;
}

// energy.discard. Discards attached energy (optionally filtered by an isa predicate, e.g. a [R]
// Energy) from the resolved source(s). Counts: `exactly`/`all`, plus the player-chosen `anyAmount`
// ("discard any amount") and `upTo {max}` — collapsed to the greedy maximum, which is exactly what the
// harness resolves native's DiscardEnergyPrompt to (first-eligible up to max; it never bumps the
// ambiguity guard), so the two engines discard the same set. When the source is a player-choice pool
// ("from among your Pokémon", chooser/quantity:'one'), resolve the spatial pool directly (the per-pick
// choice is forced by the greedy resolution). With `bindAs`, record the discarded list for a later
// `countOf` ("90 damage for each card you discarded in this way"). (Non-`attached` sources are a
// separate v2 kind / unsupported — they throw → card skipped.)
function executeEnergyDiscard(store: StoreLike, state: State, effect: AttackEffect, op: IrOp, bindings: Bindings): State {
  const from = op.card?.from;
  if (from?.zone !== 'attached') {
    throw new Error(`[ir-interpreter] energy.discard from ${from?.owner}/${from?.zone} not supported`);
  }
  const count: any = op.count;
  // How many of `available` eligible energies to discard — the greedy upper bound (the harness resolves
  // native's prompt to the same first-eligible-up-to-max set). `exactly`/`upTo` clamp to availability.
  const take = (available: number): number => {
    if (count?.kind === 'all' || count?.kind === 'anyAmount') { return available; }
    if (count?.kind === 'exactly') { return Math.min(count.n ?? 0, available); }
    if (count?.kind === 'upTo') { return Math.min(count.max ?? count.n ?? 0, available); }
    throw new Error(`[ir-interpreter] energy discard count "${count?.kind}" not supported`);
  };
  // NB: the predicate lives at op.card.predicate (a sibling of op.card.from), not op.card.from.predicate.
  const predicate = op.card?.predicate;
  const discarded: Card[] = [];
  const sel = op.target?.of;

  if (isSingleChoiceTarget(sel)) {
    // "Discard <amount> Energy from among your Pokémon" — the per-Pokémon / per-energy pick is a player
    // choice the harness collapses to greedy first-eligible across the pool. Take the matching energy in
    // harness order (active before bench, low index), so we discard exactly the set native discards.
    const eligible: Array<Target & { card: Card }> = [];
    for (const { player, list } of spatialPool(effect, sel!).filter(t => t.list.getPokemonCard() !== undefined)) {
      for (const card of list.cards) {
        if (card instanceof EnergyCard && matchesCardPredicate(card, predicate)) { eligible.push({ player, list, card }); }
      }
    }
    for (const { player, list, card } of eligible.slice(0, take(eligible.length))) {
      list.moveCardsTo([card], player.discard);
      discarded.push(card);
    }
  } else {
    // Forced (non-choice) source: discard from each resolved target (a single Pokémon in the corpus).
    for (const { player, list } of resolveTargets(state, effect, op.target)) {
      const energies = list.cards.filter(c => c instanceof EnergyCard && matchesCardPredicate(c, predicate));
      const chosen = energies.slice(0, take(energies.length));
      list.moveCardsTo(chosen, player.discard);
      discarded.push(...chosen);
    }
  }

  if (op.bindAs) { bindings[op.bindAs] = discarded; }
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
  ops: IrOp[], index: number, done: (state: State) => State, bindings: Bindings
): State {
  if (index >= ops.length) { return done(state); }
  return executeOp(store, state, effect, ops[index],
    next => runOps(store, next, effect, ops, index + 1, done, bindings), bindings);
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

// energy.attach: attach matching energy from a source zone onto the target Pokémon. From hand/discard it's
// the first-N matching (deterministic; a non-trivial pick over many matching energies is flagged by the
// ambiguity guard and skipped). From the DECK it's a search — emit the same ChooseCardsPrompt native does,
// pick first-eligible up to N, then shuffle. The predicate lives at op.card.predicate (sibling of
// op.card.from). The destination is the shared Stage-B logic (a player-choice target → a ChoosePokemonPrompt;
// else the forced target, e.g. role:'self').
function executeEnergyAttach(store: StoreLike, state: State, effect: AttackEffect, op: IrOp, cont: (state: State) => State): State {
  const from = op.card?.from;
  const owner = from?.owner === 'opponent' ? effect.opponent : effect.player;
  const count: any = op.count;
  let n: number;
  if (count?.kind === 'exactly') { n = count.n ?? 0; }
  else if (count?.kind === 'upTo') { n = count.max ?? 0; }
  else if (count?.kind === 'all') { n = Infinity; }
  else { throw new Error(`[ir-interpreter] energy.attach count "${count?.kind}" not supported`); }

  // Attach the resolved `toAttach` energies to the destination, then run `after`. Player-choice target →
  // the same ChoosePokemonPrompt native emits, attaching all N to the one chosen Pokémon (native's
  // any-way-you-like AttachEnergyPrompt geometry differs and is ambiguity-skipped when >1 dest is eligible);
  // else the forced target. Nothing to attach → no prompt, no move (matches native).
  const attachThen = (s: State, src: CardList, toAttach: Card[], after: (s: State) => State): State => {
    if (toAttach.length === 0) { return after(s); }
    if (isSingleChoiceTarget(op.target?.of)) {
      return affectChoiceTarget(store, s, effect, op, (s2, t) => { src.moveCardsTo(toAttach, t.list); return s2; }, after);
    }
    const targets = resolveTargets(s, effect, op.target);
    if (targets.length > 0) { src.moveCardsTo(toAttach, targets[0].list); }
    return after(s);
  };

  // Deck source = "search your deck for up to N <Energy>, attach …, then shuffle." Emit the ChooseCardsPrompt
  // over the deck native does (energy predicate → `blocked`), pick first-eligible up to N, attach, then a
  // ShuffleDeckPrompt (auto-resolved to NO_SHUFFLE). §12.19 seeds the deck for a non-vacuous check.
  if (from?.zone === 'deck') {
    const deck = owner.deck;
    const blocked: number[] = [];
    deck.cards.forEach((c, i) => { if (!(c instanceof EnergyCard) || !matchesCardPredicate(c, op.card?.predicate)) { blocked.push(i); } });
    const max = n === Infinity ? deck.cards.length - blocked.length : n;
    const prompt = new ChooseCardsPrompt(
      owner, GameMessage.CHOOSE_CARD_TO_ATTACH, deck, {}, { min: 0, max, allowCancel: false, blocked }
    );
    return store.prompt(state, prompt, (selected: Card[] | null) =>
      attachThen(state, deck, selected ?? [], (s) =>
        store.prompt(s, new ShuffleDeckPrompt(owner.id), (order: number[] | null) => { if (order) { deck.applyOrder(order); } return cont(s); })));
  }

  let source: CardList;
  switch (from?.zone) {
    case 'hand': source = owner.hand; break;
    case 'discard': source = owner.discard; break;
    default: throw new Error(`[ir-interpreter] energy.attach from zone "${from?.zone}" not supported`);
  }
  const matching = source.cards.filter((c: Card) => c instanceof EnergyCard && matchesCardPredicate(c, op.card?.predicate));
  const toAttach = matching.slice(0, n === Infinity ? matching.length : n);
  return attachThen(state, source, toAttach, cont);
}

function executeOp(store: StoreLike, state: State, effect: AttackEffect, op: IrOp, cont: (state: State) => State, bindings: Bindings): State {
  switch (op.kind) {
    case 'damage.deal': {
      if (isSingleChoiceTarget(op.target?.of)) {
        // Chosen-target damage is weakness-free (like native DAMAGE_OPPONENT_POKEMON), applied in the callback.
        return affectChoiceTarget(store, state, effect, op, (s, t) => {
          const put = new PutDamageEffect(effect, evalAmount(s, effect, op.amount, bindings));
          put.target = t.list;
          return store.reduceEffect(s, put);
        }, cont);
      }
      // `ignore` (weakness/resistance/defenderEffects) is inert in a mirror match — no-op.
      const value = evalAmount(state, effect, op.amount, bindings);
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
          value = evalAmount(s, effect, op.count, bindings) * 10;
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
          (s, t) => store.reduceEffect(s, new HealEffect(t.player, t.list, evalAmount(s, effect, op.amount, bindings))), cont);
      }
      const value = evalAmount(state, effect, op.amount, bindings);
      for (const { player, list } of resolveTargets(state, effect, op.target)) {
        state = store.reduceEffect(state, new HealEffect(player, list, value));
      }
      return cont(state);
    }
    case 'cards.move':
      return executeCardsMove(store, state, effect, op, cont, bindings);
    case 'energy.discard':
      return cont(executeEnergyDiscard(store, state, effect, op, bindings));
    case 'energy.attach':
      return executeEnergyAttach(store, state, effect, op, cont);
    case 'energy.move': {
      // Move attached energy from a source Pokémon to a (usually player-chosen) destination. Resolved
      // deterministically to the first-eligible source/destination — the same target the harness's
      // resolveMoveEnergyRaw picks for the native MoveEnergyPrompt, so the two engines agree. Energy
      // prompts don't touch the ambiguity guard, so a prompt isn't needed to stay comparable.
      const src = firstTarget(effect, op.source);
      const dst = firstTarget(effect, op.target?.of);
      if (!src || !dst || src.list === dst.list) { return cont(state); }
      const count: any = op.count;
      let n: number;
      if (count?.kind === 'exactly') { n = count.n ?? 0; }
      else if (count?.kind === 'all') { n = Infinity; }
      else { throw new Error(`[ir-interpreter] energy.move count "${count?.kind}" not supported`); }
      const matching = src.list.cards.filter(c => c instanceof EnergyCard && matchesCardPredicate(c, op.card?.predicate));
      src.list.moveCardsTo(matching.slice(0, n === Infinity ? matching.length : n), dst.list);
      return cont(state);
    }
    case 'hand.reveal':
      // Revealing a hand moves no cards and changes no observable zone — snapshot-neutral no-op.
      return cont(state);
    case 'pokemon.knockOut': {
      // Knock out each resolved target by dealing lethal damage through the normal pipeline, so the
      // engine awards the prize, discards, and promotes (a direct KnockOutEffect skips the prize
      // flow). Mirrors how native "knock out" attacks do it (e.g. KnockOutOpponentEffect(_, 999)).
      const ko = (s: State, list: any): State => {
        const put = new PutDamageEffect(effect, 999);
        put.target = list;
        return store.reduceEffect(s, put);
      };
      // Player-choice target ("knock out 1 of your opponent's Pokémon …") → emit the same
      // ChoosePokemonPrompt native does (Stage B), so the harness aligns first-eligible on both engines.
      if (isSingleChoiceTarget(op.target?.of)) {
        return affectChoiceTarget(store, state, effect, op, (s, t) => ko(s, t.list), cont);
      }
      for (const { list } of resolveTargets(state, effect, op.target)) { state = ko(state, list); }
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
        // "The Defending Pokémon can't retreat during the opponent's next turn." Reproduce it with the
        // exact native prefab: BLOCK_RETREAT reduces a PreventRetreatEffect that sets the defender's
        // `cannotRetreatNextTurn` field (remapped from the removed DEFENDING_POKEMON_CANNOT_RETREAT_MARKER
        // during the upstream merge), just like every native retreat-lock card. The engine enforces the
        // field centrally, so no per-card enforcement is needed in reduceEffect. `self` is this
        // interpreted card (the attacker's own active in a mirror), so the effect source matches.
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
      } else if (ovr?.kind === 'itemPlayRestriction' && ovr.target?.side === 'opponent' && op.scope === 'opponentNextTurn') {
        // "During your opponent's next turn, they can't play Item cards." Remapped during the upstream
        // merge from the removed ATTACK_EFFECT_ITEM_LOCK marker to the new PlayLockEffect: reduce the
        // exact native prefab OPPONENT_CANNOT_PLAY_ITEM_CARDS, which sets the opponent's
        // `cannotPlayItemCards` play-lock field. CAN_PLAY_TRAINER_CARD then refuses a PlayItemEffect while
        // the field is set, and Player.tickPlayLocksAtEndOfTurn clears it at the opponent's turn end —
        // the same observable native item-lock cards produce, so the block probe compares it.
        const self = effect.player.active.getPokemonCard();
        if (self) { state = OPPONENT_CANNOT_PLAY_ITEM_CARDS(store, state, effect, self); }
      }
      return cont(state);
    }
    case 'coinFlip':
      // Under the harness (ALL_HEADS) a coin flip is heads → the `then` branch, then the rest of the body.
      return runOps(store, state, effect, op.then ?? [], 0, cont, bindings);
    case 'if':
      return runOps(store, state, effect,
        (evalPredicate(state, effect, op.when) ? op.then : op.else) ?? [], 0, cont, bindings);
    case 'choice': {
      // A "you may <then>" optional effect (corpus `else` is always empty). Native emits a
      // ConfirmPrompt, which the harness always resolves to `true` (and never increments the
      // ambiguity guard) — so emit the same prompt and run `then` when confirmed, mirroring native.
      if (op.chooser !== undefined && op.chooser !== 'self') {
        throw new Error(`[ir-interpreter] choice chooser "${op.chooser}" not supported`);
      }
      const prompt = new ConfirmPrompt(effect.player.id, GameMessage.WANT_TO_USE_ABILITY);
      return store.prompt(state, prompt, (use: boolean) =>
        use ? runOps(store, state, effect, op.then ?? [], 0, cont, bindings) : cont(state));
    }
    case 'iterate': {
      // The only corpus shape: "put N damage counters on your opponent's <spot> in any way you like"
      // — `iterate over exactly:N { damage.placeCounters count:k, target quantity:'one' opponent <spot> }`.
      // Native does this with one PutDamagePrompt (PUT_X_DAMAGE_COUNTERS_IN_ANY_WAY_YOU_LIKE), which the
      // harness now resolves to the first in-slot target; a per-iteration ChoosePokemonPrompt loop would
      // instead increment the ambiguity guard N× and get the attack skipped. So use the exact same prefab.
      const body = op.body ?? [];
      const inner = body.length === 1 ? body[0] : undefined;
      const sel = inner?.target?.of;
      if (op.over?.kind !== 'exactly' || !inner || inner.kind !== 'damage.placeCounters'
        || sel?.side !== 'opponent' || sel?.quantity !== 'one') {
        throw new Error('[ir-interpreter] iterate shape not supported (only "put N counters on opponent")');
      }
      const counters = (op.over.n ?? 0) * evalAmount(state, effect, inner.count, bindings);
      state = PUT_X_DAMAGE_COUNTERS_IN_ANY_WAY_YOU_LIKE(counters, store, state, effect, slotsOf(sel.spot));
      return cont(state);
    }
    default:
      // costGate and the new pokemon.* / damage.move ops are unsupported.
      throw new Error(`[ir-interpreter] unsupported op "${op.kind}"`);
  }
}

// Map an IR selector `spot` to the Twinleaf SlotType[] (used by the distribute-counters prefab).
function slotsOf(spot?: string): SlotType[] {
  switch (spot) {
    case 'active': return [SlotType.ACTIVE];
    case 'bench': return [SlotType.BENCH];
    case 'anywhere': return [SlotType.ACTIVE, SlotType.BENCH];
    default: throw new Error(`[ir-interpreter] iterate unsupported spot "${spot}"`);
  }
}

export class InterpretedCard extends PokemonCard {
  public set = 'IR';
  public name = '';
  public fullName = '';
  public program: IrFragment[] = [];
  // Next-turn damage buffs (continuous.modifier damageBuff / attackBaseDamageOverride) reproduced with
  // the exact native prefabs; each closure is called on every effect (install / apply / cleanup). Empty
  // for cards without such a modifier, so reduceEffect is unchanged for them.
  public nextTurnBuffs: Array<(effect: Effect) => void> = [];

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Retreat-lock enforcement was remapped during the upstream merge. Retreat-lock is no longer a
    // per-card marker enforced here but the `cannotRetreatNextTurn` field that BLOCK_RETREAT (the
    // rule.override install above) sets via PreventRetreatEffect. The engine now enforces it centrally
    // (retreat-effect.ts assertCanRetreat) and the conformance retreatMenu gates the menu on that same
    // field, so no per-card BLOCK_RETREAT_IF_MARKER call is needed — the lock still blocks retreat.
    // Run the next-turn-buff prefabs AFTER the attack body (so a base-damage override overwrites the
    // body's base) and on non-attack effects (so the EndTurn marker lifecycle runs). Inert when empty.
    const applyBuffs = (s: State): State => { for (const buff of this.nextTurnBuffs) { buff(effect); } return s; };
    for (let i = 0; i < this.program.length; i++) {
      if (WAS_ATTACK_USED(effect, i, this)) {
        // Continuation-passing so a player-choice op can emit a prompt and resume the rest of the body
        // in its callback (Stage B); the terminal continuation applies the next-turn buffs. A fresh
        // binding register per fragment execution holds any `bindAs` collection for a later `countOf`.
        const bindings: Bindings = {};
        return runOps(store, state, effect as AttackEffect, this.program[i].body, 0, applyBuffs, bindings);
      }
    }
    return applyBuffs(state);
  }
}

// Precompute the next-turn damage-buff closures from the program. Each `continuous.modifier` of kind
// damageBuff / attackBaseDamageOverride (self, ownNextAttack, const amount) becomes a call to the exact
// native prefab — mechanism-identical to native, so a probe sees the same observable. The boosted attack
// must be one of this card's attacks (its fragment was provided); else the buff is inert here.
function buildNextTurnBuffs(card: InterpretedCard, fragments: IrFragment[]): Array<(effect: Effect) => void> {
  const buffs: Array<(effect: Effect) => void> = [];
  const findAttack = (name: string): Attack | undefined => card.attacks.find(a => a.name === name);
  for (const fr of fragments) {
    const setupAttack = findAttack(fr.label);
    if (!setupAttack) { continue; }
    for (const op of fr.body) {
      const mod = op.modifier;
      if (op.kind !== 'continuous.modifier' || !mod) { continue; }
      if (mod.kind !== 'damageBuff' && mod.kind !== 'attackBaseDamageOverride') { continue; }
      if (op.appliesTo?.role !== 'self' || op.scope !== 'ownNextAttack') { continue; }
      const value = mod.amount?.kind === 'const' ? mod.amount.value : undefined;
      const boostedAttack = typeof mod.attackName === 'string' ? findAttack(mod.attackName) : undefined;
      if (value === undefined || !boostedAttack) { continue; } // non-const amount or boosted attack absent → inert
      const bonusMarker = `IR_NTB::${mod.attackName}`;
      const clearMarker = `IR_NTB_CLEAR::${mod.attackName}`;
      if (mod.kind === 'damageBuff') {
        buffs.push(effect => NEXT_TURN_ATTACK_BONUS(effect, { attack: boostedAttack, source: card, bonusDamage: value, bonusMarker, clearMarker }));
      } else {
        buffs.push(effect => NEXT_TURN_ATTACK_BASE_DAMAGE(effect, { setupAttack, boostedAttack, source: card, baseDamage: value, bonusMarker, clearMarker }));
      }
    }
  }
  return buffs;
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
  card.nextTurnBuffs = buildNextTurnBuffs(card, fragments);
  return card;
}
