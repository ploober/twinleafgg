import { ConfirmCardsPrompt } from '../../game/store/prompts/confirm-cards-prompt';
import { LegalAction, PokemonInPlay } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';
import { playerIdToActor } from '../iid-targets';
import { toPrinting } from '../printing';

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

  fixupProjection(prompt, _picks, ctx, state, projected) {
    // A card that reveals deck-top cards (Dig It Up, Trekking Shoes) moves them OUT of the deck into a
    // card-local temp CardList BEFORE prompting, so at the pause those cards are absent from every
    // projected zone — a card-conservation hole; native rotomancer keeps them on top of the owner's
    // deck. Re-home each homeless prompt card onto the TOP of its OWNER's deck (temp-list order), the
    // same fix-up OrderCards uses (TA-81). Cards still present in a visible zone are left untouched, so
    // this is a no-op for ConfirmCards variants that reveal cards in place (e.g. a hand discard).
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

    const restoreByActor = new Map<string, Array<{ iid: string; printing: string }>>();
    for (const card of prompt.cards) {
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
    for (const [actor, refs] of restoreByActor) {
      projected.players[actor as 'A' | 'B'].deck.unshift(...refs);
    }
  },
};
