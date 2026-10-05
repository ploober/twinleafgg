import { Prompt } from '../../game/store/prompts/prompt';
import { State } from '../../game/store/state/state';
import { Player } from '../../game/store/state/player';
import { Card } from '../../game/store/card/card';
import { EnergyCard } from '../../game/store/card/energy-card';
import { SuperType, CardType } from '../../game/store/card/card-types';
import { PlayerType, SlotType, CardTarget } from '../../game/store/actions/play-card-action';
import { StateUtils } from '../../game/store/state-utils';
import { IidContext } from '../state-adapter';
import { NeutralAction, NeutralState, PendingDecision, LegalAction, Actor } from '../neutral-types';
import { playerIdToActor } from '../iid-targets';

/**
 * A single accumulated pick, in the form a specific decomposer reassembles into the prompt's raw
 * wire result. `done` is the variable-count terminator — the driver SYNTHESIZES it when the next
 * action in the log is not a pick for the current decision (the contract has no `endChoice`; R1).
 */
export type WirePick =
  | { kind: 'index'; index: number }                       // ChooseCards
  | { kind: 'target'; target: CardTarget }                 // ChoosePokemon
  | { kind: 'counter'; target: CardTarget }                // PutDamage (one counter)
  | { kind: 'assign'; to: CardTarget; index: number }      // AttachEnergy
  | { kind: 'transfer'; from: CardTarget; to: CardTarget } // MoveDamage
  | { kind: 'discard'; from: CardTarget; index: number }   // DiscardEnergy
  | { kind: 'move'; from: CardTarget; to: CardTarget; index: number } // MoveEnergy (one transfer)
  | { kind: 'attack'; index: number; attack: string }      // ChooseAttack (single-select)
  | { kind: 'prize'; index: number }                       // ChoosePrize (one prize pile)
  | { kind: 'confirm'; value: boolean }                    // Confirm (yes/no)
  | { kind: 'option'; index: number }                      // SelectOption (one option index)
  | { kind: 'done' };

/**
 * Turns one aggregate prompt into N single decisions. `next` returns the next decision to surface
 * (its legalActions are the Phase-1 candidate set), or null when the accumulated picks are a
 * complete answer. `toPick` maps one neutral pick-action to a WirePick (it receives the picks
 * accumulated so far, for decomposers whose wire indexing is relative to the remaining options —
 * take-immediately semantics, CF-1). `assemble` reassembles the picks into the raw wire form
 * `prompt.decode()` expects. (validate/decode run on the final result, not the pick form, so
 * accumulation is dumb.)
 *
 * `fixupProjection` (optional) rewrites the observable state projection at a mid-decision pause so
 * already-made picks read as already-applied (CF-1 take-immediately: a picked prize is projected in
 * the hand, not the pile, before the next `takePrize` pending). The native engine resolves the
 * prompt atomically, so without the fix-up the projection would not explain the pending's menu.
 */
export interface PromptDecomposer<P extends Prompt<any> = Prompt<any>> {
  readonly type: string;
  /**
   * When a decomposition is momentarily forced to exactly ONE candidate, may the driver resolve it
   * ATOMICALLY — CF-14, no pending surfaced? True only when a single candidate means the WHOLE
   * decision has exactly one resolution AND applying it raises no further client-driven decision.
   * Absent (default false): a multi-pick aggregate (move-energy/move-damage/put-damage/choose-cards)
   * can be momentarily forced to one candidate mid-decision without the overall decision being forced,
   * so it must never implement this; and a single-select whose resolution CASCADES (copy-an-attack
   * executes the attack) must not either. Consulted per-prompt so a decomposer can distinguish its own
   * variants (choose-attack: disable is atomic, copy is not).
   */
  atomicResolvable?(prompt: P, state: State): boolean;
  /**
   * TA-202: the STEP-level sibling of `atomicResolvable`, for multi-pick aggregates.
   *
   * `atomicResolvable` asks "is this WHOLE prompt forced?", which a multi-pick aggregate can never
   * answer yes to — one transfer being forced says nothing about whether the player wants a second.
   * That is why its docstring excludes move-energy/move-damage/put-damage/choose-cards, and the
   * exclusion is correct. But it left no way to express the narrower and equally real case: a single
   * STEP inside the aggregate having exactly one outcome, while the aggregate itself stays open.
   *
   * Receives `picks` (which `atomicResolvable` does not) precisely because forcedness here is a
   * property of the position in the sequence, not of the prompt. Returning true means "auto-apply the
   * sole candidate and CONTINUE the prompt", never "the decision is over".
   *
   * The driver's existing `!canStopNow` gate does the load-bearing safety work and is not duplicated
   * here: whenever stopping is permitted, the pick is a genuine decision (pick vs stop) even with one
   * candidate, so no collapse happens regardless of what this returns. A decomposer implementing this
   * is therefore asserting only that a forced step raises no client-driven decision of its own.
   *
   * Absent (the default) means today's behaviour exactly, so decomposers that do not implement it are
   * unaffected by construction rather than by testing.
   */
  atomicStep?(prompt: P, picks: WirePick[], state: State): boolean;
  /**
   * CF-14 addendum (2026-09-09, TA-286/TA-401): the WHOLE-SET sibling. When every remaining candidate
   * MUST be taken — the decision cannot stop and the candidates left (`forcedCount`) are no more than
   * the picks it still requires — there is no decision content in any of them, and the set is applied
   * atomically (rotomancer resolves Metallic Hammer's 3-of-exactly-3 Metal discard in one step). The
   * driver only consults this when the step offers no stop and more than one candidate; `atomicStep`
   * / `atomicResolvable` keep the one-candidate case. Absent = today's behaviour.
   */
  collapseWholeSet?(prompt: P, picks: WirePick[], state: State, forcedCount: number): boolean;
  next(prompt: P, picks: WirePick[], ctx: IidContext, state: State): PendingDecision | null;
  toPick(prompt: P, action: NeutralAction, ctx: IidContext, state: State, picks?: WirePick[]): WirePick;
  assemble(prompt: P, picks: WirePick[]): unknown;
  fixupProjection?(prompt: P, picks: WirePick[], ctx: IidContext, state: State, projected: NeutralState): void;
  /**
   * B.82: the cards picks 1..k name, for a prompt the engine marked `deferredMove` (an attack's pre-damage choice of
   * cards in play). The driver records them as `chosen` at a mid-decision pause; they stay where they are.
   */
  pickedCards?(prompt: P, picks: WirePick[], ctx: IidContext, state: State): Card[];
}

// ── shared helpers ─────────────────────────────────────────────────────────

/** Picks excluding the variable-count terminator. */
export function realPicks(picks: WirePick[]): WirePick[] {
  return picks.filter(p => p.kind !== 'done');
}

export function hasDone(picks: WirePick[]): boolean {
  return picks.some(p => p.kind === 'done');
}

interface PromptHead { type: string; playerId: number; message: unknown; }

export function buildPending(
  prompt: PromptHead, state: State, legalActions: LegalAction[], actor?: Actor
): PendingDecision {
  return {
    actor: actor ?? playerIdToActor(state, prompt.playerId),
    descriptor: `${prompt.type}: ${String(prompt.message)}`,
    legalActions,
  };
}

/**
 * The internal "stop allowed" marker, appended to a variable-count decision once min is satisfied.
 * It is INTERNAL ONLY — `toWirePending` strips it before the pending is surfaced (the contract has no
 * `endChoice` Action). The driver reads its presence to know completion is permitted (next-action-
 * completes, R1).
 */
export const END_CHOICE: LegalAction = { type: 'endChoice' };

export function targetKey(t: CardTarget): string {
  return `${t.player}-${t.slot}-${t.index}`;
}

// TA-335: mirror the ENGINE's matcher when the engine exports one (twinleafgg's card-filter.ts matches
// array-valued filter fields such as `cardType: [X]` by containment since upstream 7a35128f0 made
// cardType an array). A build without that module — pristine upstream — keeps the strict-equality copy
// below, which is exactly what ITS ChooseCardsPrompt.validate applies. Either way this mirror agrees with
// the engine it runs inside, so offers and acceptance cannot disagree, and the source stays byte-identical
// across checkouts (the cross-engine diff never becomes a resolver artifact).
let engineCardMatcher: ((card: Card, filter: object) => boolean) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  engineCardMatcher = require('../../game/store/card/card-filter').matchesCardFilter;
} catch {
  engineCardMatcher = undefined;
}
if (engineCardMatcher === undefined) {
  // Upstream 41382b814's own matcher (prompt-card-filter.ts) — a checkout without card-filter.ts delegates to it.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    engineCardMatcher = require('../../game/store/prompts/prompt-card-filter').matchesPromptFilter;
  } catch {
    engineCardMatcher = undefined;
  }
}

/** Partial-Card key-by-key filter, mirroring each prompt's private `matchesFilter`. */
export function matchesFilter(card: Card, filter: object): boolean {
  if (engineCardMatcher !== undefined) { return engineCardMatcher(card, filter); }
  for (const key in filter) {
    if (Object.prototype.hasOwnProperty.call(filter, key)) {
      if ((filter as any)[key] !== (card as any)[key]) {
        return false;
      }
    }
  }
  return true;
}

/** The energy's primary provided type (for differentTypes/maxPerType), CardType.NONE otherwise. */
export function primaryEnergyType(card: Card): CardType {
  if (card instanceof EnergyCard && card.provides.length > 0) {
    return card.provides[0];
  }
  return CardType.NONE;
}

/**
 * Enumerate occupied in-play Pokemon targets for `playerType` + `slots`, minus `blocked`. Targets
 * are RELATIVE to `promptPlayer` (BOTTOM = that player, TOP = opponent), mirroring the engine's
 * own enumeration (TestStoreHandler resolveChoosePokemonRaw / buildAttachTargets).
 */
export function enumerateTargets(
  state: State, promptPlayer: Player, playerType: PlayerType, slots: SlotType[], blocked: CardTarget[]
): CardTarget[] {
  const opponent = StateUtils.getOpponent(state, promptPlayer);
  const blockedKeys = new Set(blocked.map(targetKey));
  const targets: CardTarget[] = [];

  for (const pt of [PlayerType.BOTTOM_PLAYER, PlayerType.TOP_PLAYER]) {
    if (playerType !== PlayerType.ANY && playerType !== pt) {
      continue;
    }
    const p = pt === PlayerType.BOTTOM_PLAYER ? promptPlayer : opponent;
    if (slots.includes(SlotType.ACTIVE) && p.active.cards.length > 0) {
      const t: CardTarget = { player: pt, slot: SlotType.ACTIVE, index: 0 };
      if (!blockedKeys.has(targetKey(t))) {
        targets.push(t);
      }
    }
    if (slots.includes(SlotType.BENCH)) {
      for (let i = 0; i < p.bench.length; i++) {
        if (p.bench[i].cards.length > 0) {
          const t: CardTarget = { player: pt, slot: SlotType.BENCH, index: i };
          if (!blockedKeys.has(targetKey(t))) {
            targets.push(t);
          }
        }
      }
    }
  }
  return targets;
}

export { SuperType };
