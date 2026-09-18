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

  // CF-71 / B.55 (pinned 2026-09-18): the (attack × Pokémon) selection is SEQUENTIAL — first the
  // Pokémon (a `choose {target}`), then that Pokémon's attack (a `choose {name}`) — not one joint menu
  // over every pair. This is the adapter's whole change; `ChooseAttackPrompt` (one flat list of
  // `{pokemon, attack}`) and the UI (which already renders Pokémon-then-attack) are untouched.
  // Decoupled from CF-63 (B.55). Each step's single-candidate collapse is handled by the driver's
  // CF-14 path via `atomicResolvable` (true for both uses): a lone Pokémon collapses to its attack menu,
  // a lone attack executes atomically. Two real picks accumulate as `attack` WirePicks — the first with
  // `attack:''` (Pokémon chosen, attack pending), the second naming the attack; `assemble` reads the
  // completed one.
  next(prompt, picks, ctx, state) {
    const rp = realPicks(picks) as Array<{ index: number; attack: string }>;
    if (rp.length >= 2) {
      return null; // Pokémon (step 1) and attack (step 2) both chosen
    }
    const blocked = new Set(prompt.options.blocked.map(b => `${b.index}:${b.attack}`));

    if (rp.length === 0) {
      // Step 1 — choose the Pokémon whose attack is copied/disabled.
      const legalActions: LegalAction[] = [];
      for (let i = 0; i < prompt.cards.length; i++) {
        const iid = ctx.cardToIid.get(prompt.cards[i]);
        if (iid === undefined) {
          continue;
        }
        const hasUnblocked = prompt.cards[i].attacks.some(a => !blocked.has(`${i}:${a.name}`));
        if (hasUnblocked) {
          legalActions.push({ type: 'choose', target: iid });
        }
      }
      if (legalActions.length === 0) {
        return null;
      }
      return buildPending(prompt, state, legalActions);
    }

    // Step 2 — choose the attack of the Pokémon picked in step 1. `choose` always carries the target
    // (the picked Pokémon's iid — constant across these options); the attack is named via `name`.
    const i = rp[0].index;
    const iid = ctx.cardToIid.get(prompt.cards[i]);
    const legalActions: LegalAction[] = [];
    for (const attack of prompt.cards[i].attacks) {
      if (blocked.has(`${i}:${attack.name}`)) {
        continue;
      }
      if (iid !== undefined) {
        legalActions.push({ type: 'choose', target: iid, name: attack.name });
      }
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx, _state, picks = []) {
    // ChooseAttack maps onto the generic `choose`; step 1 names the Pokémon via `target` (the card iid
    // in the prompt's list), step 2 names its attack via the contract-valid `name` field.
    if (action.type !== 'choose') {
      throw new Error(`[conformance] ChooseAttack expected 'choose', got '${action.type}'`);
    }
    const rp = realPicks(picks) as Array<{ index: number; attack: string }>;
    if (rp.length === 0) {
      // Step 1 — the Pokémon.
      const source = action.target as string;
      const index = prompt.cards.findIndex(c => ctx.cardToIid.get(c) === source);
      if (index === -1) {
        throw new Error(`[conformance] choose target '${source}' is not in the prompt's card list`);
      }
      return { kind: 'attack', index, attack: '' };
    }
    // Step 2 — the attack, on the Pokémon picked in step 1.
    const index = rp[0].index;
    const name = action.name as string;
    if (!prompt.cards[index].attacks.some(a => a.name === name)) {
      throw new Error(`[conformance] chosen Pokémon has no attack '${name}'`);
    }
    return { kind: 'attack', index, attack: name };
  },

  assemble(_prompt, picks): { index: number; attack: string } | null {
    const rp = realPicks(picks) as Array<{ index: number; attack: string }>;
    const completed = rp.find(p => p.attack !== '');
    if (completed === undefined) {
      return null; // no attack chosen → decode treats null as cancel
    }
    return { index: completed.index, attack: completed.attack };
  },
};
