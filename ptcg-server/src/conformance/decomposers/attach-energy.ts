import { AttachEnergyPrompt } from '../../game/store/prompts/attach-energy-prompt';
import { EnergyCard } from '../../game/store/card/energy-card';
import { Card } from '../../game/store/card/card';
import { SuperType } from '../../game/store/card/card-types';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { LegalAction, NeutralEvent } from '../neutral-types';
import {
  PromptDecomposer, WirePick, realPicks, hasDone, buildPending, END_CHOICE,
  matchesFilter, primaryEnergyType, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget, findPokemonSlot } from '../iid-targets';
import { placeOnPokemon, liftToTransit } from '../transit-projection';
import { State } from '../../game/store/state/state';
import { CardList } from '../../game/store/state/card-list';
import { IidContext } from '../state-adapter';

type Assign = { to: CardTarget; index: number };

/**
 * The completed (card, Pokémon) assignments of the picks so far, whatever step shape made them. TA-769 / B.120 (amended,
 * owner 2026-10-25): the cards of a same-target attach are picked first (`energyCard`), and the one Pokémon they all go
 * to (`energyDest`) assigns every one of them.
 */
function assignments(picks: WirePick[]): Assign[] {
  const out: Assign[] = [];
  let held: number[] = [];
  for (const p of realPicks(picks)) {
    if (p.kind === 'assign') { out.push({ to: p.to, index: p.index }); }
    else if (p.kind === 'energyCard') { held.push(p.index); }
    else if (p.kind === 'energyDest') { for (const index of held) { out.push({ to: p.to, index }); } held = []; }
    else if (p.kind === 'energyAll') { for (const index of p.indices) { out.push({ to: p.to, index }); } }
  }
  return out;
}

/** The cards of a same-target attach picked so far and still waiting for their Pokémon (TA-769 / B.120), in pick order. */
function openCards(picks: WirePick[]): number[] {
  let held: number[] = [];
  for (const p of realPicks(picks)) {
    if (p.kind === 'energyCard') { held.push(p.index); } else if (p.kind === 'energyDest') { held = []; }
  }
  return held;
}

interface Candidate { index: number; energyIid: string; sourceIid?: string; target: CardTarget; targetIid: string }

/**
 * Every legal (card, Pokémon) pair after the assignments `as`, and whether the decision may stop there. `held` (TA-769 /
 * B.120) are cards already picked whose Pokémon is not chosen yet: they count as used for the card constraints and the
 * stop, but fix no target.
 */
function candidatePairs(prompt: AttachEnergyPrompt, as: Assign[], ctx: IidContext, state: State, held: number[] = []):
    { pairs: Candidate[]; canStop: boolean } {
  const { min } = prompt.options;
  const player = promptPlayer(state, prompt.playerId);
  const blocked = new Set(prompt.options.blocked);
  const picked = [...as.map(p => p.index), ...held];
  const usedIndices = new Set(picked);
  const usedTypes = new Set(picked.map(i => primaryEnergyType(prompt.cardList.cards[i])));
  const typeCounts = new Map<number, number>();
  picked.forEach(i => {
    const t = primaryEnergyType(prompt.cardList.cards[i]);
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  });
  const usedTargetKeys = new Set(as.map(p => targetKey(p.to)));
  const firstTargetKey = as.length > 0 ? targetKey(as[0].to) : undefined;

  const targets = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedTo);
  const pairs: Candidate[] = [];

  for (let i = 0; i < prompt.cardList.cards.length; i++) {
    const card = prompt.cardList.cards[i];
    if (usedIndices.has(i) || blocked.has(i) || card.superType !== SuperType.ENERGY) {
      continue;
    }
    if (!matchesFilter(card, prompt.filter)) {
      continue;
    }
    if (prompt.options.validCardTypes) {
      const provides = card instanceof EnergyCard ? card.provides : [];
      if (!provides.some(t => prompt.options.validCardTypes!.includes(t))) {
        continue;
      }
    }
    const type = primaryEnergyType(card);
    if (prompt.options.differentTypes && usedTypes.has(type)) {
      continue;
    }
    if (prompt.options.maxPerType !== undefined && (typeCounts.get(type) ?? 0) >= prompt.options.maxPerType) {
      continue;
    }
    const energyIid = ctx.cardToIid.get(card);
    if (energyIid === undefined) {
      continue;
    }
    // CF-34: a candidate that currently sits ON an in-play Pokemon is being RELOCATED, not attached.
    const sourceSlot = findPokemonSlot(state, card);
    const sourceIid = sourceSlot !== undefined
      ? pokemonTargetToIid(state, player, ctx, resolveAnyPokemonTarget(state, player, card))
      : undefined;
    for (const t of targets) {
      const tk = targetKey(t);
      if (prompt.options.sameTarget && firstTargetKey !== undefined && tk !== firstTargetKey) {
        continue;
      }
      if (prompt.options.differentTargets && usedTargetKeys.has(tk)) {
        continue;
      }
      pairs.push({ index: i, energyIid, sourceIid, target: t, targetIid: pokemonTargetToIid(state, player, ctx, t) });
    }
  }

  // B.114 (TA-740): with an Energy requirement the stop also needs the picked cards to provide it.
  const units = prompt.options.energyUnits;
  const energyMet = prompt.options.minEnergy === undefined || units === undefined
    || picked.reduce((sum, i) => sum + (units[i] ?? 1), 0) >= prompt.options.minEnergy;
  return { pairs, canStop: picked.length >= min && prompt.options.max > min && energyMet };
}

/**
 * The shape of the next step:
 *  - `pairs`: one `attachEnergy` / `moveEnergy {card, target}` per legal pair (CF-5, CF-34) — both dimensions open.
 *  - TA-769 / B.120 (amended, owner 2026-10-25), several cards to ONE Pokémon (`sameTarget`, max > 1; see sameTargetStep):
 *    `card` asks the cards first (with the stop where the count is "up to"), then `dest` asks the one Pokémon they all go
 *    to; `all` asks only the Pokémon when every card is forced; `fixed` asks the cards alone when only one Pokémon can
 *    take them (B.116: the card offers carry op and recipient).
 *  - TA-770 / B.121 (owner 2026-10-23): a forced single-card attach over the card already picked (Waitress asc-215,
 *    TA-386's prompt over the chosen card) asks only the Pokémon: `single`, choose {target} (op: attach, CF-70).
 *  - TA-772 / B.116 (owner 2026-10-23): every candidate card has the same single legal target: `collapsed`, the card
 *    alone as choose {target: card} (op: attach); a pair there is not offered (invalidAction). TA-786 / SR-6: a move
 *    of an Energy already on a Pokémon too (the moveEnergy triple is not offered).
 */
/**
 * The prompt is raised over a card-local list holding the card(s) already picked (Waitress's `chosen` list, TA-386), not
 * over a zone: no player's hand, deck, discard pile, Lost Zone or Pokémon in play. A lone card in a ZONE (Iron Roar
 * par-136 with one [M] in the discard pile) has not been picked; its pick stays a (card, Pokémon) pair.
 */
function isPickedCardList(state: State, list: CardList): boolean {
  return !state.players.some(p => list === p.hand || list === p.deck || list === p.discard || list === p.lostzone
    || list === p.active || p.bench.some(b => b === list));
}

type StepMode = 'pairs' | 'card' | 'dest' | 'all' | 'fixed' | 'single' | 'collapsed';
type Plan = { mode: StepMode; pairs: Candidate[]; canStop: boolean; recipient?: string; cards?: number[] };

/** TA-769 / B.120: the shared-decomposer key — several cards to one chosen Pokémon. */
function isSameTarget(prompt: AttachEnergyPrompt): boolean {
  return prompt.options.sameTarget === true && prompt.options.max > 1;
}

/**
 * TA-769 / B.120 (amended, owner 2026-10-25, supersedes the first-card-then-its-Pokémon order of 2026-10-23): when several
 * cards go to ONE Pokémon ("Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon",
 * "Move all Energy from this Pokémon to 1 of your Benched Pokémon"), every card is picked first, with the stop in the
 * same pending where the count is "up to", then the one Pokémon they all go to: choose {target: pokemon} (op: attach).
 * A card is offered only while a Pokémon remains that could take it with every card already picked, and only such a
 * Pokémon is offered. Every card forced (the stop never offered and no more cards than the picks owed: Tropic Breeze's
 * "all Energy", Jet Cyclone's three of three): the cards are no decision and only the Pokémon is asked (`all`). One
 * legal Pokémon (B.116): it is not asked; each card offer carries op: attach and recipient, and the card goes to it
 * (`fixed`). The source of a move from an AttachEnergyPrompt is the prompt's own card list ("this Pokémon"): fixed and
 * not asked. Keyed on the prompt's shape (sameTarget, max > 1), so every card that raises it gets this.
 */
function sameTargetStep(prompt: AttachEnergyPrompt, picks: WirePick[], ctx: IidContext, state: State): Plan | null {
  if (realPicks(picks).some(p => p.kind === 'energyDest' || p.kind === 'energyAll')) {
    return null;
  }
  const as = assignments(picks);          // `fixed` picks only (the single legal Pokémon)
  const held = openCards(picks);
  const closed = hasDone(picks);
  if (closed && held.length === 0) {
    return null;
  }
  const player = promptPlayer(state, prompt.playerId);
  // Card legality is per card and per Pokémon: the Pokémon that could take every card of `cards`.
  const base = candidatePairs(prompt, [], ctx, state).pairs;
  const destsFor = (cards: number[]): Candidate[] => {
    const byTarget = new Map<string, Candidate>();
    for (const c of base) {
      if (!byTarget.has(targetKey(c.target)) && cards.every(i => base.some(b => b.index === i && targetKey(b.target) === targetKey(c.target)))) {
        byTarget.set(targetKey(c.target), c);
      }
    }
    return [...byTarget.values()];
  };
  const allTargets = destsFor([]);
  if (allTargets.length === 1) {
    // B.116: one legal Pokémon — the cards are asked alone and go to it.
    if (closed || as.length >= prompt.options.max) {
      return null;
    }
    const { pairs, canStop } = candidatePairs(prompt, as, ctx, state);
    const n = new Set(pairs.map(c => c.index)).size;
    if (as.length === 0 && !canStop && prompt.options.allowCancel === false && n > 0 && n <= prompt.options.min) {
      return { mode: 'all', pairs: allTargets, canStop: false, cards: [...new Set(pairs.map(c => c.index))] };
    }
    if (pairs.length === 0) {
      return null;
    }
    return { mode: 'fixed', pairs, canStop, recipient: pokemonTargetToIid(state, player, ctx, allTargets[0].target) };
  }
  if (!closed && held.length < prompt.options.max) {
    const { pairs, canStop } = candidatePairs(prompt, [], ctx, state, held);
    const cards = pairs.filter(c => destsFor([...held, c.index]).length > 0);
    const n = new Set(cards.map(c => c.index)).size;
    if (held.length === 0 && !canStop && prompt.options.allowCancel === false && n > 0 && n <= prompt.options.min) {
      const forced = [...new Set(cards.map(c => c.index))];
      return { mode: 'all', pairs: destsFor(forced), canStop: false, cards: forced };
    }
    if (n > 0) {
      return { mode: 'card', pairs: cards, canStop };
    }
  }
  if (held.length === 0) {
    return null;
  }
  return { mode: 'dest', pairs: destsFor(held), canStop: false };
}

function planStep(prompt: AttachEnergyPrompt, picks: WirePick[], ctx: IidContext, state: State): Plan | null {
  if (isSameTarget(prompt)) {
    return sameTargetStep(prompt, picks, ctx, state);
  }
  if (hasDone(picks)) {
    return null;
  }
  const as = assignments(picks);
  if (as.length >= prompt.options.max) {
    return null;
  }
  const { pairs, canStop } = candidatePairs(prompt, as, ctx, state);
  const cards = new Set(pairs.map(c => c.index)).size;
  const targets = new Set(pairs.map(c => targetKey(c.target))).size;
  if (!canStop && prompt.options.max === 1 && prompt.cardList.cards.length === 1 && cards === 1 && targets > 1
      && isPickedCardList(state, prompt.cardList)) {
    return { mode: 'single', pairs, canStop: false };
  }
  // TA-772 / B.116 (owner 2026-10-23, amended; CF-14): every candidate card of this attach step has the same single
  // legal target ("attach it to this Pokémon", one Benched Pokémon for "your Benched Pokémon in any way you like", the
  // last Pokémon of a "for each" iteration, the fixed Pokémon of a same-target attach). The target is not a decision:
  // the card is asked alone, choose {target: card} with op: attach (CF-70), and it goes to that Pokémon. Pairs (CF-5)
  // stay whenever any candidate has two or more legal targets. Keyed on the step's own target set, not the card, so
  // every card that reaches AttachEnergyPrompt gets it. TA-786 / SR-6: a relocation (CF-34, a candidate already on a
  // Pokémon: Power Cyclone obf-085 with one Benched Pokémon) is the same shape; its source is the prompt's own card
  // list, fixed and not asked, so the card offer replaces the moveEnergy triple there too.
  if (pairs.length > 0 && targets === 1) {
    return { mode: 'collapsed', pairs, canStop };
  }
  return { mode: 'pairs', pairs, canStop };
}

/**
 * AttachEnergyPrompt: one pick = {to, index} (energy index in cardList × target); raw = {to,index}[].
 *
 * VERB (CF-34): keyed on the ACTUAL source zone per candidate card, not the prompt type — card
 * implementations reach this prompt for genuine zone attaches (hand/deck/discard sources, CF-5
 * `attachEnergy`) AND for in-play relocations (`player.active`/`opponent.active` sources — Volt
 * Cyclone, Jamming Wing, Void Gale, …), which CF-34 pins as `moveEnergy{card, source, target}`.
 * A candidate currently attached to an in-play Pokemon surfaces `moveEnergy`; a zone-resident (or
 * temp-list-homeless, e.g. Heavy Baton — whose cards `fixupProjection` re-homes to the deck on the
 * wire) candidate surfaces `attachEnergy`, keeping the verb consistent with the projected state.
 * (The TA-142 lesson: keying a verb on the prompt/message instead of the actual zone misstates it.)
 */
export const attachEnergyDecomposer: PromptDecomposer<AttachEnergyPrompt> = {
  type: 'Attach energy',

  /**
   * CF-14 (TA-124): a SINGLE attach/relocation (`max === 1`) forced to exactly one (card, destination)
   * pair has no decision content, so the driver applies it atomically rather than surfacing a 1-option
   * pending. One pick here is one complete attach or relocation, so `max === 1` means the whole decision
   * is forced — the same gate choose-pokemon / choose-cards / move-energy use, not a mid-aggregate
   * sub-pick collapse. A multi-attach prompt (`max > 1`) stays excluded: it can be momentarily narrowed
   * to one option without the overall decision being forced. The driver's `!canStopNow` gate keeps an
   * optional "you may attach 1" (min:0) surfacing its decline.
   *
   * Measured divergence: `dri-070` Team Rocket's Zapdos "Jamming Wing" (*"You may move an Energy from
   * your opponent's Active Pokémon to 1 of their Benched Pokémon"*) with B holding exactly one Benched
   * Pokemon and one Energy on its Active — a single legal `moveEnergy`. Rotomancer applied it and handed
   * the turn to B; twinleaf pended the lone pick. Note the card expresses a MOVE via
   * `AttachEnergyPrompt` (hence the CF-34 `moveEnergy` verb this decomposer derives from the source
   * zone), which is why the sibling move-energy decomposer's gate does not reach it.
   *
   * ── ENABLED 2026-08-11 (TA-239) ───────────────────────────────────────────────────────────────
   *
   * Deferred 2026-07-29 for two reasons; both are now discharged rather than argued away.
   *
   * The CF-34 "re-pin, not a bug fix" objection is answered by the measurement that prompted TA-239:
   * this is not a free choice of convention. Rotomancer applies the forced relocation and moves on,
   * and CF-14 already adjudicated which side is right — *a decision with exactly one possible
   * resolution has no decision content*. Leaving it surfaced is not a neutral alternative pin, it is
   * the non-conforming side of a settled question, and it was a standing noise source in every run.
   *
   * The harder objection was concrete: the F-027 Dragonite `ds-003` guard FAULTED outright
   * (`attachEnergy.card is not in A's hand`) because the recorded `attachEnergy` became surplus once
   * the prompt self-resolved, and was then re-read as a top-level main-phase attach. That is the
   * generic hazard of ANY new collapse — it invalidates logs recorded against the surfaced form — and
   * the answer is to re-record those logs, deliberately, checking that the same board still reaches
   * the same place. Done with this change; the affected guards keep their original state assertions,
   * which is what makes the re-record verifiable rather than a blind re-bless.
   *
   * The gate stays `max === 1`: one pick is one complete attach or relocation, so a single (card,
   * destination) candidate means the WHOLE decision is forced. A multi-attach prompt (`max > 1`) is
   * still excluded — it can be momentarily narrowed to one option without being forced — and an
   * optional "you may attach 1" (`min:0`) still surfaces its decline via the driver's `!canStopNow`
   * gate, because `next` advertises `END_CHOICE` whenever `max > min`.
   *
   * NOTE: turning it on is what EXPOSED the TA-147 wrong-perspective bug in
   * `team-rockets-zapdos.ts`, which is real and stays fixed; see its own driven guard.
   */
  atomicResolvable: prompt => prompt.options.max === 1,

  // TA-400 / CF-14 (2026-09-09): the STEP-level gate for a FORCED attach whose current step has exactly
  // one legal (card, target) pair — Golden Flame asc-026 with one Basic [R] in hand, Overvolt Discharge
  // ssp-059 with one Basic Energy in the discard and one [L] Pokemon. `max > 1` kept `atomicResolvable`
  // off, so the sole pick surfaced as a 1-option pending while rotomancer attached it. The driver only
  // consults this when the step offers no stop and one candidate; applying that candidate carries no
  // decision, and `next` then decides whether anything further is offered (nothing left -> done).
  // Keyed on forcedness (`allowCancel === false`), never on count alone (TA-190's lesson).
  //
  // TA-463 / CF-14 (2026-09-28): FX-0331 (2026-09-21) had excluded every in-play RELOCATION from this gate
  // so that Photon Cord pbl-028 ("move up to 2 [L] ... to 1 of your Benched Pokemon", one eligible Energy,
  // one bencher) would agree with rotomancer, which SURFACES that forced single move. That surfacing is
  // rotomancer's own CF-14 non-conformance (RE-174, the RE-60 shape), not a convention to match — and the
  // exclusion bought agreement on Photon Cord at the price of correctness on Heavy Baton tef-151, where
  // rotomancer DOES apply the forced relocation: the lone pick was surfaced as a 1-option moveEnergy with
  // the KO unresolved, the only FAIL of the 2026-09-28 scenario suite. A forced single relocation has no
  // decision content and collapses exactly like a forced single attach (TA-400). Correctness, not agreement.
  atomicStep: prompt => prompt.options.allowCancel === false,

  // TA-491 / CF-14 addendum: an N-of-exactly-N forced attach or relocation — Energizer Wheel par-121 moving
  // its two [D] to the only bencher — has no decision in any pick; the first pick was surfaced while
  // rotomancer applied the set. Candidates are (card, target) pairs, so `forcedCount <= remaining` also
  // means each card has exactly one target (a second target would put the pair count above the cards
  // still to move). Mirrors discard-energy / choose-pokemon.
  collapseWholeSet: (prompt, picks, _state, forcedCount) => {
    // TA-769 / B.120: a same-target prompt's steps offer cards or Pokémon one dimension at a time, not (card, target)
    // pairs, so a candidate count says nothing about the cards still owed; its forced shapes collapse step by step
    // (`all`: only the Pokémon is asked).
    if (prompt.options.allowCancel !== false || isSameTarget(prompt)) {
      return false;
    }
    const remaining = prompt.options.min - assignments(picks).length;
    return remaining > 1 && forcedCount <= remaining;
  },

  next(prompt, picks, ctx, state) {
    const plan = planStep(prompt, picks, ctx, state);
    if (plan === null) {
      return null;
    }
    const legalActions: LegalAction[] = [];
    const seen = new Set<string>();
    const push = (a: LegalAction, key: string) => { if (!seen.has(key)) { seen.add(key); legalActions.push(a); } };
    if (plan.mode === 'pairs') {
      for (const c of plan.pairs) {
        push(c.sourceIid !== undefined
          ? { type: 'moveEnergy', card: c.energyIid, source: c.sourceIid, target: c.targetIid }
          : { type: 'attachEnergy', card: c.energyIid, target: c.targetIid }, `${c.energyIid}>${c.targetIid}`);
      }
    } else if (plan.mode === 'card' || plan.mode === 'collapsed' || plan.mode === 'fixed') {
      // B.116 / B.122: where the Pokémon is not asked (one legal value) the card offer states it (recipient).
      const recipient = plan.recipient ?? (plan.mode === 'collapsed' && plan.pairs.length > 0 ? plan.pairs[0].targetIid : undefined);
      for (const c of plan.pairs) {
        push(recipient === undefined
          ? { type: 'choose', target: c.energyIid, op: 'attach' }
          : { type: 'choose', target: c.energyIid, op: 'attach', recipient }, c.energyIid);
      }
    } else {
      // 'dest' / 'all' / 'single': the Pokémon is the only open dimension.
      for (const c of plan.pairs) { push({ type: 'choose', target: c.targetIid, op: 'attach' }, c.targetIid); }
    }
    if (plan.canStop && plan.mode !== 'dest') {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx, state, picks = []) {
    if (action.type === 'endChoice') {
      return { kind: 'done' };
    }
    const player = promptPlayer(state, prompt.playerId);
    if (action.type === 'choose') {
      // TA-769 / TA-770 (B.120, B.121): a one-dimension step of a same-target attach, or the destination of a single
      // forced card. The step's plan says which dimension `target` names.
      const plan = planStep(prompt, picks, ctx, state);
      const iid = action.target as string;
      const card = ctx.iidToCard.get(iid);
      if (plan === null || card === undefined) {
        throw new Error(`[conformance] AttachEnergy choose '${iid}' is not offered here`);
      }
      if (plan.mode === 'collapsed') {
        // TA-772 / B.116: the card alone; it goes to the step's one legal target.
        const index = prompt.cardList.cards.indexOf(card);
        const c = plan.pairs.find(p => p.index === index);
        if (c === undefined) {
          throw new Error(`[conformance] AttachEnergy choose '${iid}' is not a candidate card`);
        }
        return { kind: 'assign', to: c.target, index };
      }
      if (plan.mode === 'card' || plan.mode === 'fixed') {
        // TA-769 / B.120: a card of a same-target attach; its Pokémon is asked after the last card (`card`), or is the
        // one legal Pokémon (`fixed`, B.116).
        const index = prompt.cardList.cards.indexOf(card);
        const c = plan.pairs.find(p => p.index === index);
        if (c === undefined) {
          throw new Error(`[conformance] AttachEnergy choose '${iid}' is not a candidate card`);
        }
        return plan.mode === 'fixed' ? { kind: 'assign', to: c.target, index } : { kind: 'energyCard', index };
      }
      const to = resolveAnyPokemonTarget(state, player, card);
      if (!plan.pairs.some(c => targetKey(c.target) === targetKey(to))) {
        throw new Error(`[conformance] AttachEnergy choose '${iid}' is not a candidate Pokémon`);
      }
      if (plan.mode === 'dest') {
        return { kind: 'energyDest', to };
      }
      if (plan.mode === 'all') {
        return { kind: 'energyAll', to, indices: plan.cards ?? [] };
      }
      return { kind: 'assign', to, index: plan.pairs[0].index };
    }
    if (action.type !== 'attachEnergy' && action.type !== 'moveEnergy') {
      throw new Error(`[conformance] AttachEnergy expected 'attachEnergy'/'moveEnergy', got '${action.type}'`);
    }
    const cardIid = action.card as string;
    const targetIid = action.target as string;
    const energy = ctx.iidToCard.get(cardIid);
    if (energy === undefined) {
      throw new Error(`[conformance] ${action.type}.card iid '${cardIid}' unknown`);
    }
    const index = prompt.cardList.cards.indexOf(energy);
    if (index === -1) {
      throw new Error(`[conformance] ${action.type}.card '${cardIid}' is not in the prompt's energy source`);
    }
    // CF-34 strictness (CF-12): the verb must match the card's ACTUAL zone — exactly what next()
    // offered. A board-resident card answers `moveEnergy` (with a source that matches reality); a
    // zone/temp-resident card answers `attachEnergy`.
    const sourceSlot = findPokemonSlot(state, energy);
    if (action.type === 'moveEnergy') {
      if (sourceSlot === undefined) {
        throw new Error(`[conformance] moveEnergy.card '${cardIid}' is not attached to an in-play Pokemon — this pick is an attach ('attachEnergy')`);
      }
      const actualSource = pokemonTargetToIid(state, player, ctx, resolveAnyPokemonTarget(state, player, energy));
      const claimedSource = action.source as string | undefined;
      if (claimedSource !== undefined && claimedSource !== actualSource) {
        throw new Error(`[conformance] moveEnergy.source '${claimedSource}' does not match the Pokemon '${cardIid}' is attached to`);
      }
    } else if (sourceSlot !== undefined) {
      throw new Error(`[conformance] attachEnergy.card '${cardIid}' is attached to an in-play Pokemon — this pick is a relocation ('moveEnergy', CF-34)`);
    }
    const targetCard = ctx.iidToCard.get(targetIid);
    if (targetCard === undefined) {
      throw new Error(`[conformance] ${action.type}.target iid '${targetIid}' unknown`);
    }
    return { kind: 'assign', to: resolveAnyPokemonTarget(state, player, targetCard), index };
  },

  assemble(_prompt, picks): Array<{ to: CardTarget; index: number }> {
    return assignments(picks);
  },

  /** B.82 / CF-93: the cards an attack's pre-damage choice picked (the engine marked the prompt `deferredMove`: Power
   *  Cyclone obf-085 moving its own Energy to the Bench). They stay attached until after the damage; the adapter
   *  records them as `chosen`.
   *  TA-674 / TA-675 (B.103, B.105): a card the player had to take is not a card choice, even when its destination was
   *  chosen (Iron Roar with one [M]; Genome Spiral's "Move all"): no stop was offered and no more cards were left
   *  than the picks still owed. */
  pickedCards(prompt, picks, ctx, state) {
    // TA-769 / B.120: the cards picked before their Pokémon (the destination step still open) are chosen at their picks.
    const as = assignments(picks);
    const indices = [...as.map(p => p.index), ...openCards(picks)];
    const out: Card[] = [];
    indices.forEach((index, i) => {
      const card = prompt.cardList.cards[index];
      if (card === undefined) { return; }
      const { pairs, canStop } = candidatePairs(prompt, [], ctx, state, indices.slice(0, i));
      const cardsLeft = new Set(pairs.map(c => c.index)).size;
      if (!canStop && cardsLeft <= prompt.options.min - i) { return; }
      out.push(card);
    });
    return out;
  },

  fixupProjection(prompt, picks, ctx, state, projected) {
    if ((prompt as { deferredMove?: boolean }).deferredMove) { return; }   // B.82: the picked Energy stays attached
    // B.80 / CF-91. The source pile ("look at the top N and attach any Energy you find there": Lapras ex
    // Larimar Rain, Max Elixir, Heavy Baton) is a card-local temp CardList: those cards are LIFTED and the
    // detached-pile pass (state-adapter detachedTransitCards) has already put them in their owner's transit
    // with `origin: deck` — it USED to re-home them to the deck top (CF-61, RA-5), which B.80 overturned.
    // Here: each `assign` pick already made PLACES its Energy on the chosen Pokémon (the player attaches
    // it), out of transit / hand / discard, wherever the projection holds it.
    const player = promptPlayer(state, prompt.playerId);
    for (const p of assignments(picks)) {
      const card = prompt.cardList.cards[p.index];
      const iid = card === undefined ? undefined : ctx.cardToIid.get(card);
      if (iid === undefined) { continue; }
      placeOnPokemon(projected, iid, pokemonTargetToIid(state, player, ctx, p.to));
    }
    // TA-769 / B.120: a card picked before its Pokémon is in the player's fingers (B.80): lifted into transit from the
    // hand (seen by its owner), the discard pile or a Pokémon in play (public). A card of a card-local pile is already in
    // transit (the detached-pile pass).
    for (const index of openCards(picks)) {
      const card = prompt.cardList.cards[index];
      const iid = card === undefined ? undefined : ctx.cardToIid.get(card);
      if (card === undefined || iid === undefined) { continue; }
      const inHand = state.players.some(pl => pl.hand.cards.includes(card));
      const inPublic = findPokemonSlot(state, card) !== undefined || state.players.some(pl => pl.discard.cards.includes(card));
      if (inHand || inPublic) { liftToTransit(projected, iid, { visibility: inHand ? 'owner' : 'public' }); }
    }
  },

  /**
   * TA-696 (B.81 (6): an event belongs in the step whose pause first shows its effect). Each `assign` pick already
   * made has PLACED its Energy (the fix-up above; the state and the `moved` leg show it), so its `energyAttached` is
   * this pause's too. The engine logs the attach only when the whole prompt resolves (Inferno Fandango wht-013's
   * "as often as you like" loop: the event lagged the board by one pause). A relocation (a candidate that sits on an
   * in-play Pokemon, CF-34 `moveEnergy`) emits none, as the dispatch's log-derived event never does. A replay that runs
   * on past this pause emits the engine's own event at the close instead, so nothing is counted twice in one trace.
   */
  pauseEvents(prompt, picks, ctx, state) {
    if ((prompt as { deferredMove?: boolean }).deferredMove) { return []; }
    const player = promptPlayer(state, prompt.playerId);
    const out: NeutralEvent[] = [];
    for (const p of assignments(picks)) {
      const card = prompt.cardList.cards[p.index];
      if (card === undefined || findPokemonSlot(state, card) !== undefined) { continue; }
      out.push({ kind: 'energyAttached', card: card.name, pokemon: pokemonTargetToIid(state, player, ctx, p.to) });   // B.134: no player
    }
    return out;
  },

};
