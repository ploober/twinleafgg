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
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget, findPokemonSlot, playerIdToActor } from '../iid-targets';
import { placeOnPokemon } from '../transit-projection';

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
    if (prompt.options.allowCancel !== false) {
      return false;
    }
    const remaining = prompt.options.min - realPicks(picks).length;
    return remaining > 1 && forcedCount <= remaining;
  },

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks) as Array<{ to: CardTarget; index: number }>;
    const { min, max } = prompt.options;
    if (rp.length >= max) {
      return null;
    }

    const player = promptPlayer(state, prompt.playerId);
    const blocked = new Set(prompt.options.blocked);
    const usedIndices = new Set(rp.map(p => p.index));
    const usedTypes = new Set(rp.map(p => primaryEnergyType(prompt.cardList.cards[p.index])));
    const typeCounts = new Map<number, number>();
    rp.forEach(p => {
      const t = primaryEnergyType(prompt.cardList.cards[p.index]);
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    });
    const usedTargetKeys = new Set(rp.map(p => targetKey(p.to)));
    const firstTargetKey = rp.length > 0 ? targetKey(rp[0].to) : undefined;

    const targets = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedTo);
    const legalActions: LegalAction[] = [];

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
        const targetIid = pokemonTargetToIid(state, player, ctx, t);
        legalActions.push(sourceIid !== undefined
          ? { type: 'moveEnergy', card: energyIid, source: sourceIid, target: targetIid }
          : { type: 'attachEnergy', card: energyIid, target: targetIid });
      }
    }

    // B.114 (TA-740): with an Energy requirement the stop also needs the picked cards to provide it.
    const units = prompt.options.energyUnits;
    const energyMet = prompt.options.minEnergy === undefined || units === undefined
      || rp.reduce((sum, p) => sum + (units[p.index] ?? 1), 0) >= prompt.options.minEnergy;
    if (rp.length >= min && max > min && energyMet) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx, state) {
    if (action.type === 'endChoice') {
      return { kind: 'done' };
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
    const player = promptPlayer(state, prompt.playerId);
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
    return (realPicks(picks) as Array<{ to: CardTarget; index: number }>).map(p => ({ to: p.to, index: p.index }));
  },

  /** B.82 / CF-93: the cards an attack's pre-damage choice picked (the engine marked the prompt `deferredMove`: Power
   *  Cyclone obf-085 moving its own Energy to the Bench). They stay attached until after the damage; the adapter
   *  records them as `chosen`.
   *  TA-674 / TA-675 (B.103, B.105): a card the player had to take is not a card choice, even when its destination was
   *  chosen (Iron Roar with one [M]; Genome Spiral's "Move all"): no stop was offered and no more cards were left
   *  than the picks still owed. */
  pickedCards(prompt, picks, ctx, state) {
    const rp = realPicks(picks) as Array<{ index: number }>;
    const out: Card[] = [];
    rp.forEach((p, i) => {
      const card = prompt.cardList.cards[p.index];
      if (card === undefined) { return; }
      const offered = attachEnergyDecomposer.next(prompt, rp.slice(0, i) as WirePick[], ctx, state)?.legalActions ?? [];
      const canStop = offered.some(a => a.type === 'endChoice');
      const cardsLeft = new Set(offered.filter(a => a.type !== 'endChoice').map(a => (a as { card?: string }).card)).size;
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
    for (const p of realPicks(picks) as Array<{ to: CardTarget; index: number }>) {
      const card = prompt.cardList.cards[p.index];
      const iid = card === undefined ? undefined : ctx.cardToIid.get(card);
      if (iid === undefined) { continue; }
      placeOnPokemon(projected, iid, pokemonTargetToIid(state, player, ctx, p.to));
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
    const actor = playerIdToActor(state, prompt.playerId);
    const out: NeutralEvent[] = [];
    for (const p of realPicks(picks) as Array<{ to: CardTarget; index: number }>) {
      const card = prompt.cardList.cards[p.index];
      if (card === undefined || findPokemonSlot(state, card) !== undefined) { continue; }
      out.push({ kind: 'energyAttached', player: actor, card: card.name, pokemon: pokemonTargetToIid(state, player, ctx, p.to) });
    }
    return out;
  },

};
