import { AttachEnergyPrompt } from '../../game/store/prompts/attach-energy-prompt';
import { EnergyCard } from '../../game/store/card/energy-card';
import { SuperType } from '../../game/store/card/card-types';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { LegalAction, PokemonInPlay } from '../neutral-types';
import {
  PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE,
  matchesFilter, primaryEnergyType, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget, playerIdToActor } from '../iid-targets';
import { toPrinting } from '../printing';

/** AttachEnergyPrompt: one pick = {to, index} (energy index in cardList × target); raw = {to,index}[]. */
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
      for (const t of targets) {
        const tk = targetKey(t);
        if (prompt.options.sameTarget && firstTargetKey !== undefined && tk !== firstTargetKey) {
          continue;
        }
        if (prompt.options.differentTargets && usedTargetKeys.has(tk)) {
          continue;
        }
        legalActions.push({ type: 'attachEnergy', card: energyIid, target: pokemonTargetToIid(state, player, ctx, t) });
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
    if (action.type !== 'attachEnergy') {
      throw new Error(`[conformance] AttachEnergy expected 'attachEnergy', got '${action.type}'`);
    }
    const cardIid = action.card as string;
    const targetIid = action.target as string;
    const energy = ctx.iidToCard.get(cardIid);
    if (energy === undefined) {
      throw new Error(`[conformance] attachEnergy.card iid '${cardIid}' unknown`);
    }
    const index = prompt.cardList.cards.indexOf(energy);
    if (index === -1) {
      throw new Error(`[conformance] attachEnergy.card '${cardIid}' is not in the prompt's energy source`);
    }
    const targetCard = ctx.iidToCard.get(targetIid);
    if (targetCard === undefined) {
      throw new Error(`[conformance] attachEnergy.target iid '${targetIid}' unknown`);
    }
    const player = promptPlayer(state, prompt.playerId);
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
