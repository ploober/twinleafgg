import { ChooseEnergyPrompt } from '../../game/store/prompts/choose-energy-prompt';
import { GameMessage } from '../../game/game-message';
import { StateUtils } from '../../game/store/state-utils';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending, END_CHOICE, hasDone } from './decomposer';
import { playerIdToActor } from '../iid-targets';

/**
 * TA-142: `ChooseEnergyPrompt` is overwhelmingly a cost payment — retreat or an attack energy cost —
 * where the chosen energy is DISCARDED, so `discard` is the correct default verb. But a handful of
 * attacks reuse the prompt to pick attached energy that is RELOCATED to a non-discard zone ("put an
 * Energy into your hand", "shuffle 3 Energy into your Deck"). The wire verb is destination-specific
 * (CF-8): a move to hand/deck is a `choose`, not a `discard`. We key off the prompt message — the
 * card declares the destination via `CHOOSE_ENERGIES_TO_HAND` / `CHOOSE_ENERGIES_TO_DECK` — mirroring
 * how `choose-cards` keys `discard` off `CHOOSE_CARD_TO_DISCARD`. Anything else stays `discard`.
 */
function isMovePick(prompt: ChooseEnergyPrompt): boolean {
  return prompt.message === GameMessage.CHOOSE_ENERGIES_TO_HAND
    || prompt.message === GameMessage.CHOOSE_ENERGIES_TO_DECK
    // TA-290: `CHOOSE_CARD_TO_HAND` is the third to-hand spelling and it was missing, so
    // PUT_SPECIFIC_ENERGY_FROM_THIS_POKEMON_INTO_HAND (Ninja Spinner `cri-022`, Tapu Fini-GX,
    // Quaquaval ex) surfaced its return-to-hand pick as `discard` while rotomancer emitted
    // `choose`. Keyed on the destination, per CF-8 — the enum member name is not the criterion.
    || prompt.message === GameMessage.CHOOSE_CARD_TO_HAND;
}

/**
 * CF-14 / TA-201: the energy-prompt mirror of the TA-190 forced-pick collapse.
 *
 * A pick collapses when the decision is internal to an effect's resolution and has exactly one
 * effective outcome. For a ChooseEnergyPrompt the completion test is `checkExactEnergy(picked, cost)`,
 * so if the FULL offered set pays the cost exactly then **no proper subset can** — exact payment is
 * exact — and the player has no decision at all. Wellspring Mask Ogerpon ex `twm-064` is the measured
 * case: "shuffle 3 Energy attached to this Pokémon into your deck" with exactly 3 attached.
 *
 * `allowCancel === false` is REQUIRED and is not a formality. It defaults to TRUE on this prompt, and
 * `validate(null)` returns it — so on a cancelable prompt declining is a legal outcome and the pick is
 * a real decision even when only one set can pay. On `twm-064` the decline lives in a separate
 * preceding `ConfirmPrompt(WANT_TO_USE_ABILITY)`, which is exactly why this prompt is forced.
 *
 * Keyed on forcedness alone — never on the destination zone, never on candidate count, never on who
 * holds the pick. Those were the three terms the re-worded CF-14 forbids and that TA-190 had to strip
 * out of `choose-cards`; this rule is written to that shape from the start rather than rediscovering it.
 *
 * Note `getCostThatCanBePaid()` already reduces `prompt.cost` to the payable part when
 * `allowCancel === false`, so comparing against the full offered set is the right test.
 */
function forcedFullPick(prompt: ChooseEnergyPrompt): boolean {
  if (prompt.options.allowCancel !== false || prompt.energy.length === 0
    || !StateUtils.checkLegalEnergyPayment(prompt.energy, prompt.cost)) {
    return false;
  }
  // TA-398: legality is no longer "exact", so a legal full set does not by itself rule out a legal
  // proper subset ({W, [G][G]} for a [C][C] cost is legal, and so is {[G][G]} alone). The full set is
  // forced only when NO proper subset pays; it suffices to test the (n-1)-subsets: sufficiency is
  // monotone, and a legal set holding more cards than the cost has units is minimal by definition,
  // so any legal proper subset is contained in some legal (n-1)-subset.
  for (let i = 0; i < prompt.energy.length; i++) {
    const rest = prompt.energy.filter((_, j) => j !== i);
    if (StateUtils.checkLegalEnergyPayment(rest, prompt.cost)) {
      return false;
    }
  }
  return true;
}

/**
 * TA-290: which energies may be OFFERED at this point.
 *
 * `prompt.energy` is every Energy attached (the CheckProvidedEnergyEffect map); `prompt.cost` is what
 * the pick has to pay — for a typed rider such as Ninja Spinner's "put a [W] Energy attached to this
 * Pokemon into your hand", `[WATER]`. Offering the whole attached set therefore advertised an
 * out-of-type Energy the prompt's own `validate` (checkExactEnergy) can never accept: taking it was
 * consumed into an accumulator that could no longer complete, so the pick was neither honoured nor
 * rejected — a silently swallowed action, which CF-12 forbids in both directions.
 *
 * An index is offerable iff SOME completion containing it satisfies the very predicate `validate`
 * uses, so this can never offer a pick validate would reject and never withhold one it would accept.
 * The subset walk is exponential in the unpicked count; attachments are single digits in practice and
 * the guard below falls back to offering everything rather than stalling on a pathological board.
 * Note the constructor has already reduced `cost` to the payable part when `allowCancel === false`
 * (`getCostThatCanBePaid`), so an unpayable rider arrives here as an empty cost and completes at once
 * — that is why zero attached Water never raises this prompt at all.
 */
const OFFER_FILTER_MAX_ENERGY = 16;

function offerableIndices(prompt: ChooseEnergyPrompt, picked: number[]): Set<number> {
  const used = new Set(picked);
  const rest: number[] = [];
  for (let i = 0; i < prompt.energy.length; i++) {
    if (!used.has(i)) { rest.push(i); }
  }
  if (rest.length > OFFER_FILTER_MAX_ENERGY) {
    return new Set(rest);
  }
  const base = picked.map(i => prompt.energy[i]);
  const ok = new Set<number>();
  for (let mask = 1; mask < (1 << rest.length); mask++) {
    const chosen: number[] = [];
    for (let b = 0; b < rest.length; b++) {
      if (mask & (1 << b)) { chosen.push(rest[b]); }
    }
    if (chosen.every(i => ok.has(i))) { continue; }
    if (StateUtils.checkLegalEnergyPayment([...base, ...chosen.map(i => prompt.energy[i])], prompt.cost)) {
      for (const i of chosen) { ok.add(i); }
    }
  }
  return ok;
}

/**
 * ChooseEnergyPrompt ('Choose energy'): pick which attached energies pay a cost (retreat, or an
 * energy-cost payment). Each chosen energy is discarded to pay, so it surfaces on the wire as a
 * contract `discard{owner,target}` (design Q2) — unless the message marks a relocation to hand/deck,
 * which surfaces as `choose` (TA-142, see `isMovePick`). One pick = one energy (by iid) → an index
 * into `prompt.energy`; the raw result is `number[]` which `decode` maps to `EnergyMap[]`. There is
 * no `endChoice`: `validate` requires the picked set to pay the cost EXACTLY (`checkExactEnergy`), so
 * the decision is complete the moment the accumulated picks pay it — `next` stops there.
 */
export const chooseEnergyDecomposer: PromptDecomposer<ChooseEnergyPrompt> = {
  type: 'Choose energy',

  next(prompt, picks, ctx, state) {
    // TA-439: once the driver has synthesized the explicit stop (END_CHOICE → `confirm{false}`) the
    // decision is over — assemble the picks so far. Without this the retreat over-payment pending
    // below would re-offer on the stop and loop.
    if (hasDone(picks)) {
      return null;
    }
    const picked = realPicks(picks).map(p => (p as { index: number }).index);
    const selected = picked.map(i => prompt.energy[i]);
    // Complete as soon as the chosen energies LEGALLY pay the cost (TA-398 / #2127: sufficient, and
    // either no more cards than the cost has units or every card necessary) — the same predicate
    // `validate` applies, so a further card is never required once this holds.
    if (StateUtils.checkLegalEnergyPayment(selected, prompt.cost)) {
      // TA-439 / §B.53-family #2127 (CF-4 shape): paying a RETREAT cost, the player MAY discard
      // additional Energy up to the cost's card count — a Retreat Cost of 2 paid by ONE 2-unit Energy
      // (Wild Growth, Double Turbo, Jet Energy) may still discard a second card. Once the cost is
      // legally paid but fewer cards than the cost length have been discarded, offer the remaining
      // attached Energy plus an explicit stop (END_CHOICE → `confirm{false}`), and complete only at the
      // card-count cap. Every unpicked Energy is a legal extension here: sufficiency already holds and
      // adding one keeps the card count ≤ the cost length (`checkLegalEnergyPayment`). Scoped to the
      // retreat message — an exact-count relocation (isMovePick) or an attack-cost discard has no
      // over-payment option and still completes at sufficiency, so their wire shape is unchanged.
      if (prompt.message === GameMessage.CHOOSE_ENERGY_TO_PAY_RETREAT_COST
        && picked.length < prompt.cost.length) {
        const alreadyPicked = new Set(picked);
        const overpay: LegalAction[] = [];
        for (let i = 0; i < prompt.energy.length; i++) {
          if (alreadyPicked.has(i)) {
            continue;
          }
          const iid = ctx.cardToIid.get(prompt.energy[i].card);
          if (iid !== undefined) {
            overpay.push({
              type: 'discard', owner: playerIdToActor(state, prompt.playerId), target: iid,
              op: 'discard', destination: 'discardPile',
            });
          }
        }
        if (overpay.length > 0) {
          overpay.push(END_CHOICE);
          return buildPending(prompt, state, overpay);
        }
      }
      return null;
    }

    // CF-14 / TA-201: forced full pick — auto-resolve atomically, no pending (assemble fills the indices).
    if (picked.length === 0 && forcedFullPick(prompt)) {
      return null;
    }

    const move = isMovePick(prompt);
    // CF-70 Phase 2: a relocation names where the Energy goes; the message is the card's declaration
    // of the destination (the same key `isMovePick` reads). A cost payment is a discard to the pile.
    const destination = prompt.message === GameMessage.CHOOSE_ENERGIES_TO_DECK ? 'deck' : 'hand';
    const used = new Set(picked);
    const offerable = offerableIndices(prompt, picked);
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prompt.energy.length; i++) {
      if (used.has(i) || !offerable.has(i)) {
        continue;
      }
      const iid = ctx.cardToIid.get(prompt.energy[i].card);
      if (iid !== undefined) {
        legalActions.push(move
          ? { type: 'choose', target: iid, op: 'moveTo', destination }
          : { type: 'discard', owner: playerIdToActor(state, prompt.playerId), target: iid, op: 'discard', destination: 'discardPile' });
      }
    }
    if (legalActions.length === 0) {
      return null; // nothing left to offer — assemble what we have (validate adjudicates exactness)
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx) {
    const expected = isMovePick(prompt) ? 'choose' : 'discard';
    if (action.type !== expected) {
      throw new Error(`[conformance] ChooseEnergy expected '${expected}', got '${action.type}'`);
    }
    const iid = action.target as string;
    const index = prompt.energy.findIndex(em => ctx.cardToIid.get(em.card) === iid);
    if (index === -1) {
      throw new Error(`[conformance] ${action.type} target '${iid}' is not an energy offered by the prompt`);
    }
    return { kind: 'index', index };
  },

  assemble(prompt, picks): number[] {
    const picked = realPicks(picks).map(p => (p as { index: number }).index);
    // Auto-resolved forced full pick (next() returned null with no picks): take every offered energy.
    if (picked.length === 0 && forcedFullPick(prompt)) {
      return prompt.energy.map((_, i) => i);
    }
    return picked;
  },
};
