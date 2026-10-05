import { ConfirmCardsPrompt } from '../../game/store/prompts/confirm-cards-prompt';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

/**
 * ConfirmCardsPrompt ('Confirm cards') WITH `allowCancel: true` — a genuine optional decision ("you
 * may…"): the player looks at revealed card(s) and either confirms the card's optional action (result
 * `true`) or declines (result `null` → the card's `else` branch). e.g. Rockruff JTG "Dig It Up" ("Look
 * at the top card of your deck. You may discard that card."), Trekking Shoes, Morpeko, Primordial Altar.
 *
 * The driver auto-acknowledges the `allowCancel: false` variant (a pure `Prompt<true>` reveal, no
 * branch) as a 'wait'; only the cancelable variant is a real decision and reaches this decomposer
 * (`classify` routes by `options.allowCancel`). Auto-acknowledging the cancelable one with `true`
 * FORCED the optional action (e.g. always discarded Dig It Up's top card) — the TA-98 divergence, the
 * `Confirm cards` sibling of TA-81's OrderCards auto-resolve. rotomancer surfaces the same yes/no as a
 * `confirm{value}` pending, so we externalize it identically (parallel to the `Confirm` decomposer).
 */
export const confirmCardsDecomposer: PromptDecomposer<ConfirmCardsPrompt> = {
  type: 'Confirm cards',

  next(prompt, picks, _ctx, state) {
    if (realPicks(picks).length >= 1) {
      return null; // single yes/no answer chosen
    }
    const legalActions: LegalAction[] = [
      { type: 'confirm', value: true },
      { type: 'confirm', value: false },
    ];
    return buildPending(prompt, state, legalActions);
  },

  toPick(_prompt, action, _ctx, _state) {
    if (action.type !== 'confirm') {
      throw new Error(`[conformance] Confirm cards expected 'confirm', got '${action.type}'`);
    }
    return { kind: 'confirm', value: (action as { value: boolean }).value };
  },

  assemble(_prompt, picks): unknown {
    const rp = realPicks(picks) as Array<{ kind: 'confirm'; value: boolean }>;
    const confirmed = rp.length > 0 ? rp[0].value : false;
    // ConfirmCardsPrompt is `Prompt<true>`: resolve with `true` (confirmed — the card runs its optional
    // action) or `null` (declined — the card's `else`/put-back branch). `false` maps to `null`.
    return confirmed ? true : null;
  },

  fixupProjection(prompt, _picks, ctx, _state, projected) {
    // B.80: the revealed deck-top cards (Dig It Up, Trekking Shoes) are a card-local temp pile, already in
    // their owner's `transit` via the detached-pile pass (origin deck). They USED to be re-homed to the deck
    // top (TA-81). A ConfirmCards prompt SHOWS them, so their visibility is `public`, not the pass's
    // default `owner`. A variant that confirms cards in place (a hand discard) finds nothing in transit.
    for (const card of prompt.cards) {
      const iid = ctx.cardToIid.get(card);
      if (iid === undefined) { continue; }
      for (const who of ['A', 'B'] as const) {
        const t = (projected.players[who].transit ?? []).find(x => x.iid === iid);
        if (t !== undefined) { t.visibility = 'public'; }
      }
    }
  },

};
