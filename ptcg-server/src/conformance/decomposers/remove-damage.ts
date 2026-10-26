import { RemoveDamagePrompt } from '../../game/store/prompts/remove-damage-prompt';
import { DamageTransfer } from '../../game/store/prompts/move-damage-prompt';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { LegalAction } from '../neutral-types';
import {
  PromptDecomposer, WirePick, realPicks, hasDone, buildPending, END_CHOICE, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';
import { StateUtils } from '../../game';
import { counterMoveIids } from './move-damage';

const COUNTER = 10;

/**
 * CF-21: RemoveDamagePrompt drives damage-counter-*moving* abilities (Munkidori "Adrena-Brain":
 * "move up to 3 damage counters from 1 of your Pokemon to 1 of your opponent's Pokemon"). Its result
 * is `DamageTransfer[]` — the SAME shape as MoveDamagePrompt — so it decomposes identically: each
 * transfer is TWO picks (design R2), a `choose{target}` naming the SOURCE Pokemon (which loses a
 * counter) then a `placeCounter{target}` naming the DESTINATION. Picks alternate source,dest,…;
 * `assemble` pairs them into DamageTransfer[]. The one difference from `move-damage` is the option
 * set: RemoveDamageOptions has no singleSource/singleDestination toggles, but a `sameTarget` flag
 * that pins ALL destinations to one Pokemon (validate() enforces it over `.to`).
 */

function pairTransfers(rp: WirePick[]): DamageTransfer[] {
  const transfers: DamageTransfer[] = [];
  for (let k = 0; k + 1 < rp.length; k += 2) {
    transfers.push({
      from: (rp[k] as { target: CardTarget }).target,
      to: (rp[k + 1] as { target: CardTarget }).target,
    });
  }
  return transfers;
}

export const removeDamageDecomposer: PromptDecomposer<RemoveDamagePrompt> = {
  type: 'Remove damage',

  /**
   * TA-202: every step of this prompt is safe to collapse when forced, so this is unconditional — the
   * conditions that make collapsing WRONG are already enforced by the driver's `!canStopNow` gate, and
   * restating them here would be duplicated logic that can drift.
   *
   * Walking the two step kinds against that gate:
   *
   *  - SOURCE step, before `min` is met — `next` appends no `END_CHOICE` (`transfers.length >= min` is
   *    false), so stopping is not permitted and a lone eligible source is genuinely forced: the player
   *    must move a counter and there is one Pokemon to move it from.
   *  - SOURCE step, once `min` is met — `END_CHOICE` IS appended, `canStopNow` is true, and the driver
   *    skips the collapse. Correct: "move another, or stop" is a real decision even with one candidate.
   *    This is the boundary that makes an unconditional `true` safe.
   *  - DESTINATION step — never offers `END_CHOICE` (a half-finished transfer cannot be abandoned), so
   *    a single legal destination is always forced. The source is already committed.
   *
   * Applying a transfer raises no client-driven decision of its own, so there is no cascade to worry
   * about — the reason `choose-attack` can only implement the sibling hook for its `disable` variant.
   */
  atomicStep: () => true,

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks);
    const { min, max } = prompt.options;
    const atSourceStep = rp.length % 2 === 0; // even count → choose a source next; odd → choose its dest
    const transfers = pairTransfers(rp);
    if (atSourceStep && max !== undefined && transfers.length >= max) {
      return null; // reached the max number of transfers, at a transfer boundary
    }

    const player = promptPlayer(state, prompt.playerId);
    // `sameTarget` pins every destination to the first one chosen (validate() checks `.to`).
    const firstTo = transfers.length > 0 ? targetKey(transfers[0].to) : undefined;
    const legalActions: LegalAction[] = [];

    if (atSourceStep) {
      // TA-203: offer as SOURCES the Pokemon that actually HAVE a counter to move — the same rule
      // `move-damage` adopted in TA-124, which this decomposer was written to mirror but predates.
      //
      // This used to enumerate `prompt.maxAllowedDamage` and treat `entry.damage` as the movable budget.
      // `maxAllowedDamage` is a per-target **DESTINATION cap** — how much damage a target may end up
      // carrying — not a source list, and `RemoveDamagePrompt.validate()` never reads it at all. The
      // card-side convention is unambiguous across the 25 MoveDamagePrompt users: `card.hp`,
      // `card.hp + 40`, `card.hp + 70`, a flat `9999`/`180`. Capacities, not counter counts.
      //
      // Munkidori `twm-095` is the measured case and the only RemoveDamagePrompt user in the tree. It
      // pushes `checkHpEffect.hp` for EVERY one of its own Pokemon, so under the old reading the
      // `entry.damage <= 0` guard excluded nothing and every friendly Pokemon was offered as a source —
      // including UNDAMAGED ones. Driving that: A(30)/B(0) with an undamaged Munkidori benched offered
      // `choose a2`, and taking it moved nothing (A 30→30, B 0→0) while still satisfying the ability's
      // mandatory `min: 1` transfer AND burning its once-per-turn marker (the card adds the marker
      // inside the transfer loop, before its own `damageToMove > 0` check). A no-op that costs a turn.
      //
      // Reading real damage from state also feeds the driver's zero-candidate auto-complete, so a board
      // where nothing can be moved presents no decision at all rather than a phantom pending (CF-33).
      const movedFrom = new Map<string, number>();
      transfers.forEach(t => {
        const k = targetKey(t.from);
        movedFrom.set(k, (movedFrom.get(k) ?? 0) + COUNTER);
      });
      const sources = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedFrom);
      for (const source of sources) {
        const cardList = StateUtils.getTarget(state, player, source);
        const movable = (cardList?.damage ?? 0) - (movedFrom.get(targetKey(source)) ?? 0);
        if (movable < COUNTER) { continue; }
        legalActions.push({ type: 'choose', target: pokemonTargetToIid(state, player, ctx, source) });
      }
      if (transfers.length >= min) {
        legalActions.push(END_CHOICE);
      }
    } else {
      // Mid-transfer: a source was just chosen; offer its DESTINATIONS (any in-play target but itself,
      // minus blockedTo; pinned to `firstTo` when sameTarget and one is already chosen).
      const source = (rp[rp.length - 1] as { target: CardTarget }).target;
      const sourceKey = targetKey(source);
      const dests = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedTo)
        .filter(t => targetKey(t) !== sourceKey)
        .filter(t => !(prompt.options.sameTarget && firstTo !== undefined && targetKey(t) !== firstTo));
      for (const dest of dests) {
        legalActions.push({ type: 'placeCounter', target: pokemonTargetToIid(state, player, ctx, dest), op: 'placeCounters' }); // CF-70
      }
    }

    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(_prompt, action, ctx, state) {
    const player = promptPlayer(state, _prompt.playerId);
    if (action.type === 'choose') { // a SOURCE pick
      const card = ctx.iidToCard.get(action.target as string);
      if (card === undefined) {
        throw new Error(`[conformance] RemoveDamage source iid '${action.target}' unknown`);
      }
      return { kind: 'target', target: resolveAnyPokemonTarget(state, player, card) };
    }
    if (action.type === 'placeCounter') { // a DESTINATION pick
      const card = ctx.iidToCard.get(action.target as string);
      if (card === undefined) {
        throw new Error(`[conformance] RemoveDamage destination iid '${action.target}' unknown`);
      }
      return { kind: 'counter', target: resolveAnyPokemonTarget(state, player, card) };
    }
    throw new Error(`[conformance] RemoveDamage expected 'choose'/'placeCounter', got '${action.type}'`);
  },

  /**
   * B.133 (owner 2026-10-25; B.118 reaches Abilities): Adrena-Brain twm-095 chooses every move first, and the counters
   * move together when the prompt resolves (the engine applies the transfers in its callback); the board between the
   * picks shows none of them. This used to project each counter at its pick (B.80), asking the engine on a clone whether
   * it would land (TA-618: Battle Cage pfl-085 keeps it off a Benched Pokemon); the close is now the only place the
   * counters move, and the engine itself decides there.
   */
  fixupProjection() {
    return;
  },

  /** TA-774 (B.123): one (source, target) per transferred counter, for the close's countersMoved. */
  movedCounters(prompt, wire, ctx, state) {
    return counterMoveIids(prompt.playerId, wire as DamageTransfer[], ctx, state);
  },

  assemble(_prompt, picks): DamageTransfer[] {
    return pairTransfers(realPicks(picks));
  },
};
