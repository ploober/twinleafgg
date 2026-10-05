import { OrderCardsPrompt, OrderCardsPromptType } from '../../game/store/prompts/order-cards-prompt';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

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
    // mirroring the CF-11 <=1-card shuffle. TA-587 / B.73: the LAST card has one place left, so an N-card reorder
    // completes after N-1 picks (assemble fills the tail).
    if (n <= 1 || rp.length >= n - 1) {
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

  // B.80: no fix-up. The reorder pile is a card-local temp CardList, and the detached-pile pass
  // (state-adapter detachedTransitCards) already projects it in its owner's `transit` (origin from the
  // pile's fromZoneTag: `hand` for Kofu, `deck` for Fortunate Eye; visibility owner), in pile order. It
  // USED to be re-homed to the top of the deck (TA-81 / CF-61), which B.80 overturned: the player is
  // holding the cards. A placed card stays in transit until the engine applies the order on resolve —
  // this prompt does not know whether the pile goes to the top or the bottom.

};
