import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { GameMessage } from '../../game/game-message';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, matchesFilter } from './decomposer';
import { playerIdToActor } from '../iid-targets';

/** A card-pick whose purpose is discarding surfaces as `discard {owner, target}` (the wire's
 * specific type — matches the retreat-cost / energy-discard convention and rotomancer). */
function isDiscardPick(prompt: ChooseCardsPrompt): boolean {
  return prompt.message === GameMessage.CHOOSE_CARD_TO_DISCARD;
}

/**
 * CF-8 forced-atomic: a discard the player can neither decline (`allowCancel:false`) nor vary — the
 * required count is at least the whole eligible pool (`min >= |eligible|`), so every valid selection is
 * "all eligible" — is a NON-decision. The adapter resolves it atomically (no `discard` pending),
 * matching rotomancer (and the `DISCARD_X_ENERGY` prefab's own-Pokémon atomic path, and the CF-11
 * ≤1-card-shuffle collapse). e.g. Crunch ("Discard an Energy from your opponent's Active") when the
 * Active has exactly one Energy. Returns the forced index list, or null when the pick is a genuine
 * decision (2+ candidates for a single pick still surface — those already match rotomancer). Secret
 * (randomized) picks are excluded: they are the system actor's, not a forced player choice.
 */
function forcedDiscardIndices(prompt: ChooseCardsPrompt): number[] | null {
  if (!isDiscardPick(prompt) || prompt.options.allowCancel !== false || prompt.options.isSecret === true) {
    return null;
  }
  const blocked = new Set(prompt.options.blocked);
  const eligible: number[] = [];
  for (let i = 0; i < prompt.cards.cards.length; i++) {
    if (blocked.has(i) || !matchesFilter(prompt.cards.cards[i], prompt.filter)) {
      continue;
    }
    eligible.push(i);
  }
  return eligible.length > 0 && prompt.options.min >= eligible.length ? eligible : null;
}

/**
 * ChooseCardsPrompt: one pick = one index into prompt.cards.cards; raw result = number[].
 *
 * When `options.isSecret` is set the selection is hidden/random (e.g. "discard a random card from
 * your opponent's hand", or any pick from a face-down zone). The acting player has no agency over
 * which card, so it is surfaced as the `system` actor's `pick` (the externalized-randomness analog
 * of player `choose`) rather than a player decision — keeping the choice reproducible across engines.
 */
export const chooseCardsDecomposer: PromptDecomposer<ChooseCardsPrompt> = {
  type: 'Choose cards',

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks);
    const { min, max } = prompt.options;
    if (rp.length >= max) {
      return null;
    }
    // CF-8: a forced, non-varying discard DECIDED BY THE ACTIVE PLAYER is a non-decision — auto-resolve
    // atomically (assemble fills in the forced indices) instead of surfacing a 1-option `discard` pending.
    // A forced discard decided by the NON-active player — e.g. "your opponent discards a card from their
    // hand" (Salazzle scr-024), a control-handoff to the opponent — is SURFACED by rotomancer, so it is
    // NOT collapsed here (the collapse is scoped to the active player's own forced picks).
    const activePlayer = state.players[state.activePlayer];
    const ownerIsActive = activePlayer !== undefined && prompt.player.id === activePlayer.id;
    if (rp.length === 0 && ownerIsActive && forcedDiscardIndices(prompt) !== null) {
      return null;
    }

    const secret = prompt.options.isSecret === true;
    const picked = new Set(rp.map(p => (p as { index: number }).index));
    const blocked = new Set(prompt.options.blocked);
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prompt.cards.cards.length; i++) {
      if (blocked.has(i) || picked.has(i)) {
        continue;
      }
      const card = prompt.cards.cards[i];
      if (!matchesFilter(card, prompt.filter)) {
        continue;
      }
      const iid = ctx.cardToIid.get(card);
      if (iid !== undefined) {
        if (secret) {
          legalActions.push({ type: 'pick', target: iid });
        } else if (isDiscardPick(prompt)) {
          legalActions.push({ type: 'discard', owner: playerIdToActor(state, prompt.player.id), target: iid } as LegalAction);
        } else {
          legalActions.push({ type: 'choose', target: iid });
        }
      }
    }
    if (rp.length >= min && max > min) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null; // nothing left to offer — complete with what we have (validate adjudicates)
    }
    return buildPending(prompt, state, legalActions, secret ? 'system' : undefined);
  },

  toPick(prompt, action, ctx) {
    const expected = prompt.options.isSecret === true ? 'pick'
      : isDiscardPick(prompt) ? 'discard' : 'choose';
    if (action.type !== expected) {
      throw new Error(`[conformance] ChooseCards expected '${expected}', got '${action.type}'`);
    }
    const targetIid = action.target as string;
    const card = ctx.iidToCard.get(targetIid);
    if (card === undefined) {
      throw new Error(`[conformance] choose target iid '${targetIid}' unknown`);
    }
    const index = prompt.cards.cards.indexOf(card);
    if (index === -1) {
      throw new Error(`[conformance] choose target '${action.target}' is not in the prompt's card list`);
    }
    return { kind: 'index', index };
  },

  assemble(prompt, picks): number[] {
    const picked = realPicks(picks).map(p => (p as { index: number }).index);
    if (picked.length === 0) {
      // Auto-resolved forced discard (next() returned null with no picks): take all eligible (CF-8).
      const forced = forcedDiscardIndices(prompt);
      if (forced !== null) {
        return forced;
      }
    }
    return picked;
  },
};
