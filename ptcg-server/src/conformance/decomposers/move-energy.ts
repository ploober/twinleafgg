import { MoveEnergyPrompt } from '../../game/store/prompts/move-energy-prompt';
import { SuperType } from '../../game/store/card/card-types';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { StateUtils } from '../../game/store/state-utils';
import { LegalAction } from '../neutral-types';
import {
  PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, matchesFilter, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';

/**
 * MoveEnergyPrompt: relocate an attached Energy from one Pokemon to another. Each transfer is a single
 * `{from, to, index}`, surfaced per CF-34 as `moveEnergy{card, source, target}` — one template per
 * legal (card, destination) pair. `card` names the Energy, `source` the Pokemon it currently sits on
 * (explicit though derivable: self-describing wire + stale-source = desync detector), `target` the
 * destination. One `moveEnergy` = one complete transfer, so unlike MoveDamage this is one pick per
 * transfer, not two. (History: this decomposer previously reused `attachEnergy{card, target}`; CF-34
 * convicted that as an operation misstatement — a relocation is not an attach, the TA-142 mirror.)
 *
 * Enumeration mirrors the simple-bot `MoveEnergyPromptResolver`: `slots`+`playerType` define BOTH the
 * source and destination Pokemon set. Sources drop `blockedFrom`, per-source `blockedMap` indices, and
 * non-`filter` cards; destinations drop `blockedTo` and the transfer's own source (a card must move to a
 * DIFFERENT Pokemon). Picks accumulate against the stable pause-state (the prompt is not resolved until
 * every pick is in), so every `index` is relative to that one state, matching `decode()` which reads all
 * `from[index]` cards before the card applies any move.
 */
export const moveEnergyDecomposer: PromptDecomposer<MoveEnergyPrompt> = {
  type: 'Move energy',

  /**
   * CF-14 (TA-124): a SINGLE-transfer relocation (`max === 1`) forced to exactly one legal
   * (card, destination) pair has no decision content, so the driver applies it atomically instead of
   * surfacing a 1-option `moveEnergy` pending. Because one pick here IS one complete transfer (see the
   * note above), `max === 1` means the whole decision is forced — the same gate choose-pokemon and
   * choose-cards use, not a mid-aggregate sub-pick collapse. A multi-transfer prompt (`max > 1`) is
   * still excluded: it can be momentarily narrowed to one option without the overall decision being
   * forced. The driver's `!canStopNow` gate additionally keeps an optional "you may move 1" (min:0)
   * surfacing its decline.
   *
   * Measured divergence: `dri-070` "Jamming Wing" with B holding exactly one Benched Pokemon, so the
   * moved Energy has exactly one destination — rotomancer applies it and hands the turn to B, twinleaf
   * pended the single `moveEnergy` pick.
   *
   * ── ENABLED 2026-08-21 (TA-303). The deferral rested on a spec, and the CONTRACT had already
   * decided the day before. ────────────────────────────────────────────────────────────────────
   *
   * Deferred 2026-07-29 because enabling it broke the Energy Switch spec that "pins the opposite ON
   * PURPOSE" — *"surfaces the move as a pending with a moveEnergy legalAction when the log is dry
   * (CF-34)"* — which was read as making the collapse a re-pin of CF-34 rather than a bug fix.
   *
   * That reading was wrong on two counts, and both are worth keeping:
   *
   * 1. **CF-34's own adjudication text already says to collapse**, and it was written 2026-07-28 —
   *    the day BEFORE the deferral. `conformance-api.yaml`, closing sentence of the IN-PLAY ENERGY
   *    RELOCATION block: *"A forced 1-of-1 relocation still collapses per CF-14."* So the contract
   *    decision the deferral said was needed had already been made; what blocked it was one of our
   *    own specs, and a spec is not an oracle.
   * 2. **The spec's board could not test what the spec is for.** It held one Energy and ONE benched
   *    Pokemon, so the relocation had exactly one legal (card, destination) pair — a degenerate board
   *    for a test whose real assertions are about the MENU (that the verb is `moveEnergy` and not
   *    `attachEnergy`, and that a Pokemon is excluded as its own destination). Neither is observable
   *    on a board with no menu. The board now carries a SECOND bench slot, so the two assertions run
   *    against a real 2-option menu and the collapse case gets its own cell asserting the STATE
   *    EFFECT rather than the absence of a pending.
   *
   * Rotomancer collapses this (their note ninety-seven §1: *"a single reachable destination collapses
   * to it"*), so enabling it converges toward them rather than away — the check that falsified the
   * bare `max === 1` hypothesis for choose-cards.
   *
   * Scope: `max === 1` only. A multi-transfer prompt (`max > 1`) stays excluded — it can be
   * momentarily narrowed to one option without the overall decision being forced, which is the
   * "momentarily-forced sub-pick" the decomposer contract warns about. The driver's `!canStopNow`
   * gate additionally keeps an optional "you may move 1" (min: 0) surfacing its decline.
   */
  atomicResolvable: prompt => prompt.options.max === 1,

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks) as Array<{ from: CardTarget; to: CardTarget; index: number }>;
    const { min, max } = prompt.options;
    if (max !== undefined && rp.length >= max) {
      return null;
    }

    const player = promptPlayer(state, prompt.playerId);
    const pickedKeys = new Set(rp.map(p => `${targetKey(p.from)}-${p.index}`));
    const blockedBySource = new Map<string, Set<number>>();
    for (const entry of prompt.options.blockedMap) {
      blockedBySource.set(targetKey(entry.source), new Set(entry.blocked));
    }

    const sources = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedFrom);
    const dests = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedTo);
    const legalActions: LegalAction[] = [];

    for (const source of sources) {
      const list = StateUtils.getTarget(state, player, source);
      const sourceKey = targetKey(source);
      const blockedIdx = blockedBySource.get(sourceKey) ?? new Set<number>();
      for (let i = 0; i < list.cards.length; i++) {
        const card = list.cards[i];
        if (card.superType !== SuperType.ENERGY || blockedIdx.has(i)) {
          continue;
        }
        if (!matchesFilter(card, prompt.filter)) {
          continue;
        }
        if (pickedKeys.has(`${sourceKey}-${i}`)) {
          continue;
        }
        const energyIid = ctx.cardToIid.get(card);
        if (energyIid === undefined) {
          continue;
        }
        for (const dest of dests) {
          if (targetKey(dest) === sourceKey) {
            continue; // a card must move to a DIFFERENT Pokemon
          }
          legalActions.push({
            type: 'moveEnergy',
            card: energyIid,
            source: pokemonTargetToIid(state, player, ctx, source),
            target: pokemonTargetToIid(state, player, ctx, dest),
          });
        }
      }
    }

    if (rp.length >= min && (max === undefined || max > min)) {
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
    if (action.type !== 'moveEnergy') {
      throw new Error(`[conformance] MoveEnergy expected 'moveEnergy', got '${action.type}'`);
    }
    const energy = ctx.iidToCard.get(action.card as string);
    if (energy === undefined) {
      throw new Error(`[conformance] moveEnergy.card iid '${action.card}' unknown`);
    }
    const targetCard = ctx.iidToCard.get(action.target as string);
    if (targetCard === undefined) {
      throw new Error(`[conformance] moveEnergy.target iid '${action.target}' unknown`);
    }
    const player = promptPlayer(state, prompt.playerId);
    const from = resolveAnyPokemonTarget(state, player, energy);
    // CF-34: `source` is explicit on the wire; a mismatch with where the card actually sits is a
    // malformed action (or a caller desync) — reject strictly rather than silently trusting either.
    const claimedSource = action.source as string | undefined;
    if (claimedSource !== undefined && claimedSource !== pokemonTargetToIid(state, player, ctx, from)) {
      throw new Error(`[conformance] moveEnergy.source '${claimedSource}' does not match the Pokemon '${action.card}' is attached to`);
    }
    const list = StateUtils.getTarget(state, player, from);
    const index = list.cards.indexOf(energy);
    if (index === -1) {
      throw new Error(`[conformance] moveEnergy.card '${action.card}' not found on its Pokemon`);
    }
    const to = resolveAnyPokemonTarget(state, player, targetCard);
    return { kind: 'move', from, to, index };
  },

  assemble(_prompt, picks): Array<{ from: CardTarget; to: CardTarget; index: number }> {
    return (realPicks(picks) as Array<{ from: CardTarget; to: CardTarget; index: number }>)
      .map(p => ({ from: p.from, to: p.to, index: p.index }));
  },
};
