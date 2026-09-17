import { ResolveNextPrompt } from '../../game/store/prompts/resolve-next-prompt';
import { LegalAction, ResolveNextAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

/**
 * ResolveNextPrompt ('ResolveNext'): pick which of several SIMULTANEOUS effects resolves next
 * (CF-38, §B.40, TA-292).
 *
 * ONE PENDING PER PICK, not one permutation — the engine re-prompts with the remainder after each
 * choice, so this decomposer only ever surfaces a single decision and completes on one pick. That is
 * the contract's spelling and it is also the honest one: after the first effect resolves the board
 * has changed, and the second choice should be made against the board as it then is.
 *
 * `kind` is READ OFF THE CANDIDATE, not derived from the card's superType. A candidate carries an
 * `ability` name exactly when its effect is a named Ability, so `abilityEffect` vs `cardTextEffect`
 * follows the effect rather than the card — which is what the six Antique Fossils need, being
 * Trainers that carry a real Ability. Deriving the kind from `superType` would file all six under
 * `cardTextEffect` and they would be wrong in a way no in-pool board currently exposes.
 *
 * Per CF-38 `source` is REQUIRED for both kinds and is the iid of the CARD THE EFFECT COMES FROM —
 * the Tool's own iid, not the Pokemon it is attached to — so two copies on one bearer stay distinct.
 * `ability` is REQUIRED for `abilityEffect` and MUST BE ABSENT for `cardTextEffect`.
 */
export const resolveNextDecomposer: PromptDecomposer<ResolveNextPrompt> = {
  type: 'ResolveNext',

  next(prompt, picks, ctx, state) {
    if (realPicks(picks).length >= 1) {
      return null; // one pick completes this decision; the engine raises the next one itself
    }
    const legalActions: LegalAction[] = [];
    const seen = new Map<string, string>();
    for (const candidate of prompt.candidates) {
      const source = ctx.cardToIid.get(candidate.card);
      if (source === undefined) {
        // A candidate with no iid cannot be named on the wire, and emitting a partial menu would
        // let a client answer a decision it could not see in full. Surfacing nothing is wrong too,
        // so this is a hard error rather than a silent drop.
        throw new Error(`[conformance] ResolveNext candidate has no iid: ${candidate.card.fullName}`);
      }
      // CF-38 (v0.7.2): the occurrence half — the KO'd subject's basic iid. A candidate that carries a
      // subject with no iid is the same hard error as a source with none.
      const subject = candidate.subject === undefined ? undefined : ctx.cardToIid.get(candidate.subject);
      if (candidate.subject !== undefined && subject === undefined) {
        throw new Error(`[conformance] ResolveNext subject has no iid: ${candidate.subject.fullName}`);
      }
      const action: Extract<LegalAction, { type: 'resolveNext' }> = candidate.ability === undefined
        ? { type: 'resolveNext', kind: 'cardTextEffect', source }
        : { type: 'resolveNext', kind: 'abilityEffect', source, ability: candidate.ability };
      if (subject !== undefined) {
        action.subject = subject;
      }
      // UNIQUENESS (the invariant CF-38 actually needs): the identity tuple must be pairwise distinct
      // across the candidate set, or the decision cannot be answered. Two identical rows would let
      // `toPick` below select the FIRST silently — a wrong answer wearing a green board, which is worse
      // than rotomancer's refusal. Fail loudly instead.
      const key = `${action.kind}|${action.source}|${action.ability ?? ''}|${action.subject ?? ''}`;
      if (seen.has(key)) {
        throw new Error('[conformance] CF-38 uniqueness: two simultaneous-effect candidates share the identity tuple '
          + `(kind=${action.kind}, source=${action.source}, ability=${action.ability ?? 'absent'}, subject=${action.subject ?? 'absent'}) `
          + '— the decision cannot be answered');
      }
      seen.set(key, candidate.card.fullName);
      legalActions.push(action);
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx, _state) {
    if (action.type !== 'resolveNext') {
      throw new Error(`[conformance] ResolveNext expected 'resolveNext', got '${action.type}'`);
    }
    const a = action as ResolveNextAction;
    const index = prompt.candidates.findIndex(c => {
      if (ctx.cardToIid.get(c.card) !== a.source) {
        return false;
      }
      // `ability` disambiguates two effects on ONE card, so it is matched, not ignored — and its
      // ABSENCE is matched too: a `cardTextEffect` answer must not select an `abilityEffect`
      // candidate that happens to sit on the same card.
      if ((c.ability ?? undefined) !== (a.ability ?? undefined)) {
        return false;
      }
      // CF-38 (v0.7.2): `subject` is matched EXACTLY, absence included — an answer naming no subject
      // must not select an occurrence that carries one, and vice versa.
      const subject = c.subject === undefined ? undefined : ctx.cardToIid.get(c.subject);
      return subject === (a.subject ?? undefined);
    });
    if (index < 0) {
      throw new Error(`[conformance] resolveNext names no candidate in this batch: `
        + `source=${a.source} kind=${a.kind} ability=${a.ability ?? '(absent)'} subject=${a.subject ?? '(absent)'}`);
    }
    return { kind: 'option', index };
  },

  assemble(_prompt, picks): number {
    const rp = realPicks(picks) as Array<{ kind: 'option'; index: number }>;
    return rp.length > 0 ? rp[0].index : 0;
  },
};
