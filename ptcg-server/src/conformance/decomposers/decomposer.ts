import { Prompt } from '../../game/store/prompts/prompt';
import { State } from '../../game/store/state/state';
import { Player } from '../../game/store/state/player';
import { Card } from '../../game/store/card/card';
import { EnergyCard } from '../../game/store/card/energy-card';
import { SuperType, CardType } from '../../game/store/card/card-types';
import { PlayerType, SlotType, CardTarget } from '../../game/store/actions/play-card-action';
import { StateUtils } from '../../game/store/state-utils';
import { IidContext } from '../state-adapter';
import { NeutralAction, PendingDecision, LegalAction, Actor } from '../neutral-types';
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
  | { kind: 'attack'; index: number; attack: string }      // ChooseAttack (single-select)
  | { kind: 'prize'; index: number }                       // ChoosePrize (one prize pile)
  | { kind: 'confirm'; value: boolean }                    // Confirm (yes/no)
  | { kind: 'option'; index: number }                      // SelectOption (one option index)
  | { kind: 'done' };

/**
 * Turns one aggregate prompt into N single decisions. `next` returns the next decision to surface
 * (its legalActions are the Phase-1 candidate set), or null when the accumulated picks are a
 * complete answer. `toPick` maps one neutral pick-action to a WirePick. `assemble` reassembles the
 * picks into the raw wire form `prompt.decode()` expects. (validate/decode run on the final result,
 * not the pick form, so accumulation is dumb.)
 */
export interface PromptDecomposer<P extends Prompt<any> = Prompt<any>> {
  readonly type: string;
  next(prompt: P, picks: WirePick[], ctx: IidContext, state: State): PendingDecision | null;
  toPick(prompt: P, action: NeutralAction, ctx: IidContext, state: State): WirePick;
  assemble(prompt: P, picks: WirePick[]): unknown;
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

/** Partial-Card key-by-key filter, mirroring each prompt's private `matchesFilter`. */
export function matchesFilter(card: Card, filter: object): boolean {
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
