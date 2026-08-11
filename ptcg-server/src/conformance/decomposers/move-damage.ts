import { MoveDamagePrompt, DamageTransfer } from '../../game/store/prompts/move-damage-prompt';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { LegalAction } from '../neutral-types';
import {
  PromptDecomposer, WirePick, realPicks, hasDone, buildPending, END_CHOICE, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';
import { StateUtils } from '../../game';

const COUNTER = 10;

/**
 * MoveDamagePrompt: relocating a damage counter has no single contract Action (there is no
 * `moveCounter`/`removeCounter`), so each transfer decomposes into TWO picks (design R2): a
 * `choose{target}` naming the SOURCE Pokemon, then a `placeCounter{target}` naming the DESTINATION.
 * Removing the counter from the source is a state consequence (the source's `damage` drops), not a
 * decision. Picks alternate source,dest,source,dest…; `assemble` pairs them into DamageTransfer[].
 */

/** The (from,to) transfers completed so far, pairing the alternating source/dest picks. */
function pairTransfers(rp: WirePick[]): Array<{ from: CardTarget; to: CardTarget }> {
  const transfers: Array<{ from: CardTarget; to: CardTarget }> = [];
  for (let k = 0; k + 1 < rp.length; k += 2) {
    transfers.push({
      from: (rp[k] as { target: CardTarget }).target,
      to: (rp[k + 1] as { target: CardTarget }).target,
    });
  }
  return transfers;
}

export const moveDamageDecomposer: PromptDecomposer<MoveDamagePrompt> = {
  type: 'Move damage',

  /**
   * TA-239: unconditional, and it is a direct READ-ACROSS from `remove-damage`, whose identical
   * `atomicStep: () => true` has been live since TA-202. The two decomposers have the same step
   * structure — alternating SOURCE / DESTINATION picks paired into transfers — and the safety
   * argument turns entirely on that structure plus the driver's `!canStopNow` gate:
   *
   *  - SOURCE step, before `min` transfers exist — `END_CHOICE` is not appended (`transfers.length
   *    >= min` is false), so stopping is not permitted and a lone eligible source is genuinely
   *    forced: a counter must move and there is one Pokemon it can move from.
   *  - SOURCE step, once `min` is met — `END_CHOICE` IS appended, so `canStopNow` is true and the
   *    driver never reaches the collapse. "Move another, or stop" stays a real decision even with a
   *    single candidate. This boundary is what makes the unconditional `true` safe.
   *  - DESTINATION step — never appends `END_CHOICE` (a half-finished transfer cannot be
   *    abandoned), so a single legal destination is always forced; the source is already committed.
   *
   * Moving a counter raises no client-driven decision of its own, so there is no cascade — the
   * property `choose-attack`'s copy variant lacks, which is why it may not implement either hook.
   *
   * Measured divergence this closes: `twm-082` Alakazam "Strange Hacking" on a board with one
   * damaged Pokemon and one legal destination — twinleaf surfaced a 1-option `Move damage` pending
   * per pick while rotomancer had already applied the transfer and handed the turn over.
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
    const firstFrom = transfers.length > 0 ? targetKey(transfers[0].from) : undefined;
    const firstTo = transfers.length > 0 ? targetKey(transfers[0].to) : undefined;
    const legalActions: LegalAction[] = [];

    if (atSourceStep) {
      // TA-124: offer as SOURCES the Pokemon that actually HAVE a counter to move.
      //
      // This used to enumerate `prompt.maxAllowedDamage` and treat `entry.damage` as the movable budget.
      // That misreads the field. `maxAllowedDamage` is a per-target **DESTINATION cap** — how much damage
      // a target may end up carrying — not a source list. The authoritative witness is the MOVE_DAMAGE
      // prefab (`prefabs.ts`), which pushes `damage: 9999` for EVERY in-play Pokemon (an unlimited cap)
      // and expresses source eligibility separately, by pushing undamaged targets into
      // `options.blockedFrom`. The card-side convention agrees: of 51 users, the overwhelming majority
      // push `card.hp`, `card.hp + N`, or a flat `9999`/`180`/`120` — capacities, not counter counts. The
      // sibling `put-damage` decomposer already documents the same rule ("`maxAllowedDamage` is only a
      // per-target CAP; it is not the legality list"), and `conformance-putdamage-slots.spec.ts` records
      // the same misread being fixed there.
      //
      // The old reading only looked correct for prompts the prefab built, because `blockedFrom` happened
      // to carry the real filter. A HAND-BUILT prompt that passes no `blockedFrom` — Alakazam `twm-082`
      // "Strange Hacking" passes only `{allowCancel: true}` — offered every opposing Pokemon as a source,
      // since each one's cap (its HP) is a large positive number. On a board with ZERO damage counters
      // that produced a phantom pending (`choose{target=B.active}` + a decline) where rotomancer
      // correctly presents no decision at all: nothing can be moved, so per CF-33 there is nothing to
      // decide. Reading real damage collapses it via the driver's existing zero-candidate auto-complete.
      const movedFrom = new Map<string, number>();
      transfers.forEach(t => {
        const k = targetKey(t.from);
        movedFrom.set(k, (movedFrom.get(k) ?? 0) + COUNTER);
      });
      // TA-242: a source is only offerable if SOME destination exists for it. `enumerateTargets`
      // answers "who may give up a counter", and the TA-124 fix above made that answer honest about
      // damage — but a counter needs somewhere to GO, and nothing checked that. Alakazam `twm-082`
      // "Strange Hacking" (*"…move any number of damage counters from your opponent's Pokémon **to
      // their other Pokémon**"*) against an opponent whose only Pokemon is a damaged Active offered
      // `choose{B.active}` + a decline: taking the offer reached a destination step with ZERO
      // candidates, `next` returned null, and the transfer silently did not happen. Both branches of
      // that pending land on the identical board — a decision with no content, which is what B.29
      // rule 1 forbids (a required operand set empty and public; `meg-003` "Solar Transfer — no
      // second Pokémon as destination" is the adjudicated precedent, and it went against twinleaf).
      // Rotomancer presents no decision here, correctly.
      const hasDestination = (source: CardTarget): boolean => {
        const sourceKey = targetKey(source);
        return enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedTo)
          .some(t => targetKey(t) !== sourceKey
            && !(prompt.options.singleDestinationTarget && firstTo !== undefined && targetKey(t) !== firstTo));
      };
      const sources = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedFrom);
      for (const source of sources) {
        const k = targetKey(source);
        const cardList = StateUtils.getTarget(state, player, source);
        const movable = (cardList?.damage ?? 0) - (movedFrom.get(k) ?? 0);
        if (movable < COUNTER) { continue; }
        if (prompt.options.singleSourceTarget && firstFrom !== undefined && k !== firstFrom) { continue; }
        if (!hasDestination(source)) { continue; }
        legalActions.push({ type: 'choose', target: pokemonTargetToIid(state, player, ctx, source) });
      }
      if (transfers.length >= min) {
        legalActions.push(END_CHOICE);
      }
    } else {
      // Mid-transfer: a source was just chosen; offer its DESTINATIONS (any in-play target but itself).
      const source = (rp[rp.length - 1] as { target: CardTarget }).target;
      const sourceKey = targetKey(source);
      const dests = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedTo)
        .filter(t => targetKey(t) !== sourceKey)
        .filter(t => !(prompt.options.singleDestinationTarget && firstTo !== undefined && targetKey(t) !== firstTo));
      for (const dest of dests) {
        legalActions.push({ type: 'placeCounter', target: pokemonTargetToIid(state, player, ctx, dest) });
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
        throw new Error(`[conformance] MoveDamage source iid '${action.target}' unknown`);
      }
      return { kind: 'target', target: resolveAnyPokemonTarget(state, player, card) };
    }
    if (action.type === 'placeCounter') { // a DESTINATION pick
      const card = ctx.iidToCard.get(action.target as string);
      if (card === undefined) {
        throw new Error(`[conformance] MoveDamage destination iid '${action.target}' unknown`);
      }
      return { kind: 'counter', target: resolveAnyPokemonTarget(state, player, card) };
    }
    throw new Error(`[conformance] MoveDamage expected 'choose'/'placeCounter', got '${action.type}'`);
  },

  assemble(_prompt, picks): DamageTransfer[] {
    return pairTransfers(realPicks(picks));
  },
};
