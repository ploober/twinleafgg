import { AttachEnergyPrompt } from '../../game/store/prompts/attach-energy-prompt';
import { EnergyCard } from '../../game/store/card/energy-card';
import { SuperType } from '../../game/store/card/card-types';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { LegalAction, PokemonInPlay } from '../neutral-types';
import {
  PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE,
  matchesFilter, primaryEnergyType, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget, findPokemonSlot, playerIdToActor } from '../iid-targets';
import { toPrinting } from '../printing';

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

    if (rp.length >= min && max > min) {
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

  fixupProjection(prompt, _picks, ctx, state, projected) {
    // "Look at the top N cards of your deck and attach any Energy you find there…" (Lapras ex "Larimar
    // Rain", Blastoise, Rayquaza-GX, Max Elixir, Azumarill, …) pulls the looked-at cards into a
    // card-local temp CardList and hands THAT to this prompt as its source. The temp is not a projected
    // zone, so at the attach pause those cards vanish from the wire — a card-conservation hole (RA-5);
    // native rotomancer keeps them in the deck. Mirror that: re-home any source card that is absent from
    // EVERY zone of EITHER player back onto its OWNER's deck. Two corrections vs a naive prompt-owner
    // restore: (1) presence is checked across BOTH players — a source that still lives in an opponent
    // zone (Team Rocket's Zapdos "Jamming Wing" sources Energy from the OPPONENT's Active) is NOT
    // homeless and must be left alone, else it is duplicated into the prompt owner's deck (a
    // card-conservation break); (2) a genuinely homeless card is routed to ITS owner's deck (via the
    // import-origin cardOwner map), not the prompt owner's. Idempotent for hand/discard-sourced attaches.
    const present = new Set<string>();
    const addPip = (pip: PokemonInPlay | null) => {
      if (!pip) { return; }
      pip.stack.forEach(c => present.add(c.iid));
      pip.energy.forEach(c => present.add(c.iid));
      pip.tools.forEach(c => present.add(c.iid));
    };
    for (const actor of ['A', 'B'] as const) {
      const p = projected.players[actor];
      [p.deck, p.hand, p.discard, p.lostZone].forEach(z => z.forEach(c => present.add(c.iid)));
      p.prizes.forEach(pz => present.add(pz.iid));
      addPip(p.active);
      p.bench.forEach(addPip);
    }
    for (const card of prompt.cardList.cards) {
      const iid = ctx.cardToIid.get(card);
      const owner = ctx.cardOwner.get(card);
      if (iid === undefined || owner === undefined || present.has(iid)) { continue; }
      projected.players[playerIdToActor(state, state.players[owner].id)].deck.push({ iid, printing: toPrinting(card) });
      present.add(iid);
    }
  },
};
