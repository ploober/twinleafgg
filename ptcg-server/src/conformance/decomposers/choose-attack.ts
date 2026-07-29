import { ChooseAttackPrompt } from '../../game/store/prompts/choose-attack-prompt';
import { GameMessage } from '../../game/game-message';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

/**
 * ChooseAttackPrompt ('Choose attack'): pick ONE attack to copy/disable (Memory Skip, metronome-style
 * attacks). The result is a single `Attack`, so this is a single-select decomposer: one pick = a
 * `{source, name}` naming a card in `prompt.cards` and one of its attacks. The raw wire form `decode`
 * expects is `{ index, attack }` (index into `prompt.cards`).
 */
export const chooseAttackDecomposer: PromptDecomposer<ChooseAttackPrompt> = {
  type: 'Choose attack',

  // CF-14: single-select, so a one-candidate prompt (defender with exactly one attack) is a whole
  // decision with exactly one resolution — for BOTH uses.
  //
  // This used to be restricted to the DISABLE use (Murkrow "Torment"), on the reasoning that the COPY
  // use (CHOOSE_ATTACK_TO_COPY, ~45 cards) EXECUTES the chosen attack and so "cascades into further
  // client-driven prompts". TA-124 retires that restriction on two counts:
  //
  //  1. The factual claim attached to it — "copy is not a cross-engine divergence (only disable is)"
  //     — is FALSE as measured 2026-07-29 against sim 2.12.0. Roto auto-resolves the 1-option COPY
  //     too: on `twm-079` and `wht-062` (defender with a single attack, Vine Slap) roto has already
  //     executed the copy and handed the turn to B, while twinleaf pended
  //     `choose{target=B.active, name=Vine Slap}`. Two scenarios were XFAIL on exactly this.
  //  2. The cascade is not a reason to surface THIS decision. CF-14 asks whether *this* decision has
  //     one resolution, not whether resolving it leads to further decisions. The driver's collapse
  //     feeds the sole candidate back through `toPick` and loops, so any prompt the copied attack
  //     raises is picked up on the next iteration and surfaced normally — as its own decision, which
  //     is what it is. Collapsing here removes a phantom node; it does not swallow the cascade.
  atomicResolvable: (prompt) =>
    prompt.message === GameMessage.CHOOSE_ATTACK_TO_DISABLE ||
    prompt.message === GameMessage.CHOOSE_ATTACK_TO_COPY,

  next(prompt, picks, ctx, state) {
    if (realPicks(picks).length >= 1) {
      return null; // single-select: one attack chosen
    }

    const blocked = new Set(prompt.options.blocked.map(b => `${b.index}:${b.attack}`));
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prompt.cards.length; i++) {
      const iid = ctx.cardToIid.get(prompt.cards[i]);
      if (iid === undefined) {
        continue;
      }
      for (const attack of prompt.cards[i].attacks) {
        if (blocked.has(`${i}:${attack.name}`)) {
          continue;
        }
        legalActions.push({ type: 'choose', target: iid, name: attack.name });
      }
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx) {
    // ChooseAttack maps onto the generic `choose`; the attack is named via the contract-valid `name`
    // field (target = the card iid in the prompt's list).
    if (action.type !== 'choose') {
      throw new Error(`[conformance] ChooseAttack expected 'choose', got '${action.type}'`);
    }
    const source = action.target as string;
    const name = action.name as string;
    const index = prompt.cards.findIndex(c => ctx.cardToIid.get(c) === source);
    if (index === -1) {
      throw new Error(`[conformance] choose target '${source}' is not in the prompt's card list`);
    }
    if (!prompt.cards[index].attacks.some(a => a.name === name)) {
      throw new Error(`[conformance] choose target '${source}' has no attack '${name}'`);
    }
    return { kind: 'attack', index, attack: name };
  },

  assemble(_prompt, picks): { index: number; attack: string } | null {
    const rp = realPicks(picks) as Array<{ index: number; attack: string }>;
    if (rp.length === 0) {
      return null; // no attack chosen → decode treats null as cancel
    }
    return { index: rp[0].index, attack: rp[0].attack };
  },
};
