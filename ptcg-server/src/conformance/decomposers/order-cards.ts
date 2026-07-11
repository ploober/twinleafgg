import { OrderCardsPrompt, OrderCardsPromptType } from '../../game/store/prompts/order-cards-prompt';
import { LegalAction, PokemonInPlay } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';
import { playerIdToActor } from '../iid-targets';
import { toPrinting } from '../printing';

/**
 * OrderCardsPrompt ("put these cards back in any order", e.g. Gothorita WHT "Fortunate Eye" — look at
 * the opponent's top 5 and reorder them). The chosen order is a MATERIAL, OBSERVABLE decision (the
 * attacker controls the opponent's next draws, and the reordered pile is on the full-information
 * wire), so it must be EXTERNALIZED, not auto-resolved to identity (adjudication §B.6 / TA-81; RE-7:
 * the engine must not decide for the player when the choice is observable). Rotomancer externalizes
 * it as a sequence of `choose` picks over the same cards — we match that exactly (same `choose`
 * action, actor = the prompt owner), so no new wire action type is needed.
 *
 * A fixed-count sequential choose: one `choose {target: iid}` per position (which looked-at card goes
 * next), for n = prompt.cards.cards.length cards. The result is a permutation `perm` where
 * `CardList.applyOrder` does `cards[i] = copy[perm[i]]` — so `perm[i]` is the ORIGINAL index of the
 * card the player placed at new position i, and new-position-0 is the deck top (next draw). `assemble`
 * therefore returns the picked original-indices in pick order, identity-completing any tail the log
 * did not pick (also covers the n<=1 forced case with no pending).
 */
export const orderCardsDecomposer: PromptDecomposer<OrderCardsPrompt> = {
  type: OrderCardsPromptType,

  next(prompt, picks, ctx, state) {
    const n = prompt.cards.cards.length;
    const rp = realPicks(picks);
    // n<=1 → exactly one possible order (a forced non-decision): resolve identity with NO pending,
    // mirroring the CF-11 <=1-card shuffle. Complete once every position is filled.
    if (n <= 1 || rp.length >= n) {
      return null;
    }
    const picked = new Set(rp.map(p => (p as { index: number }).index));
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < n; i++) {
      if (picked.has(i)) {
        continue;
      }
      const iid = ctx.cardToIid.get(prompt.cards.cards[i]);
      if (iid !== undefined) {
        legalActions.push({ type: 'choose', target: iid });
      }
    }
    if (legalActions.length === 0) {
      return null; // nothing referenceable left — complete with what we have (assemble identity-fills)
    }
    return buildPending(prompt, state, legalActions); // actor defaults to prompt owner = the reorderer
  },

  toPick(prompt, action, ctx) {
    if (action.type !== 'choose') {
      throw new Error(`[conformance] OrderCards expected 'choose', got '${action.type}'`);
    }
    const card = ctx.iidToCard.get(action.target as string);
    const index = card ? prompt.cards.cards.indexOf(card) : -1;
    if (index === -1) {
      throw new Error(`[conformance] order choose target '${action.target}' is not in the prompt's card list`);
    }
    return { kind: 'index', index };
  },

  assemble(prompt, picks): number[] {
    // Picked original-indices in pick order, then any unpicked indices in ascending order — always a
    // valid permutation of [0..n-1], so a partial log (or the n<=1 no-pending path) still validates.
    const picked = realPicks(picks).map(p => (p as { index: number }).index);
    const seen = new Set(picked);
    const rest: number[] = [];
    for (let i = 0; i < prompt.cards.cards.length; i++) {
      if (!seen.has(i)) {
        rest.push(i);
      }
    }
    return [...picked, ...rest];
  },

  fixupProjection(prompt, _picks, ctx, state, projected) {
    // The reorder pile is a card-local temp CardList (gothorita.ts moved the opponent's top-5 OUT of
    // their deck into a local list before prompting), so at the pause those cards are absent from
    // every projected zone — a card-conservation hole; native rotomancer keeps them on top of the
    // owner's deck. Re-home each homeless card onto the TOP of its OWNER's deck, preserving temp-list
    // order. Unlike attach-energy's fix-up (which restores to the PROMPT owner's own deck), the pile
    // here can belong to the opponent (Fortunate Eye), so route by import-origin owner, not prompt
    // owner. The engine has not applied the reorder yet (that happens on resolve), so the cards are
    // still in their original order — project them so, matching rotomancer's pre-resolve view.
    const presentByActor = new Map<string, Set<string>>();
    const presentFor = (actor: string): Set<string> => {
      let set = presentByActor.get(actor);
      if (set !== undefined) {
        return set;
      }
      set = new Set<string>();
      const proj = projected.players[actor as 'A' | 'B'];
      const addPip = (pip: PokemonInPlay | null) => {
        if (!pip) { return; }
        pip.stack.forEach(c => set!.add(c.iid));
        pip.energy.forEach(c => set!.add(c.iid));
        pip.tools.forEach(c => set!.add(c.iid));
      };
      [proj.deck, proj.hand, proj.discard, proj.lostZone].forEach(z => z.forEach(c => set!.add(c.iid)));
      proj.prizes.forEach(p => set!.add(p.iid));
      addPip(proj.active);
      proj.bench.forEach(addPip);
      presentByActor.set(actor, set);
      return set;
    };

    // Collect homeless cards per owner-actor, preserving temp-list (deck-top) order.
    const restoreByActor = new Map<string, Array<{ iid: string; printing: string }>>();
    for (const card of prompt.cards.cards) {
      const iid = ctx.cardToIid.get(card);
      const owner = ctx.cardOwner.get(card);
      if (iid === undefined || owner === undefined) {
        continue;
      }
      const actor = playerIdToActor(state, state.players[owner].id);
      if (presentFor(actor).has(iid)) {
        continue;
      }
      const list = restoreByActor.get(actor) ?? [];
      list.push({ iid, printing: toPrinting(card) });
      restoreByActor.set(actor, list);
      presentFor(actor).add(iid);
    }
    // Prepend each owner's block as a unit so temp[0] stays on top of the deck (next draw).
    for (const [actor, refs] of restoreByActor) {
      projected.players[actor as 'A' | 'B'].deck.unshift(...refs);
    }
  },
};
