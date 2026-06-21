import { GameError } from '../game/game-error';
import { GameMessage } from '../game/game-message';
import { RejectionInfo, ContractReasonCode } from './neutral-types';

/**
 * Normalized, engine-neutral rejection codes (design §4.9). When the engine rejects an action it
 * throws `GameError(GameMessage.X)`; two engines won't share twinleaf's `GameMessage` names, so we
 * map to a small neutral vocabulary the conformance harness can compare directly.
 *
 * No engine edit is needed: `GameError.message` defaults to the `GameMessage` *value* string
 * (game-error.ts: `message || code`), so the caught error's `.message` is the code we map on. A
 * GameError built with a custom message (rare) falls through to `illegalAction`.
 */

export type ReasonCode =
  | 'notYourTurn'
  | 'notEnoughEnergy'
  | 'unknownAttack'
  | 'unknownCard'
  | 'unknownAbility'
  | 'invalidTarget'
  | 'blockedBySpecialCondition'
  | 'blockedByAbility'
  | 'blockedByEffect'
  | 'cannotPlayCard'
  | 'cannotRetreat'
  | 'cannotUseAbility'
  | 'cannotUseAttack'
  | 'cannotUseStadium'
  | 'cannotAttackFirstTurn'
  | 'cannotEvolveThisTurn'
  | 'alreadyPlayedSupporter'
  | 'alreadyPlayedStadium'
  | 'alreadyUsedStadium'
  | 'sameStadiumInPlay'
  | 'alreadyAttachedEnergy'
  | 'alreadyRetreated'
  | 'toolAlreadyAttached'
  | 'abilityAlreadyUsed'
  | 'actionInProgress'
  | 'noStadiumInPlay'
  | 'malformedRequest'   // surfaced by the HTTP layer for a bad request body, not by the engine
  | 'illegalAction';     // catch-all for any unmapped GameError

/** twinleaf `GameMessage` value → neutral `ReasonCode`. Keyed on the string the GameError carries. */
const REJECTION_MAP: Record<string, ReasonCode> = {
  [GameMessage.NOT_YOUR_TURN]: 'notYourTurn',
  [GameMessage.NOT_ENOUGH_ENERGY]: 'notEnoughEnergy',
  [GameMessage.UNKNOWN_ATTACK]: 'unknownAttack',
  [GameMessage.UNKNOWN_CARD]: 'unknownCard',
  [GameMessage.UNKNOWN_POWER]: 'unknownAbility',
  [GameMessage.INVALID_TARGET]: 'invalidTarget',
  [GameMessage.BLOCKED_BY_SPECIAL_CONDITION]: 'blockedBySpecialCondition',
  [GameMessage.BLOCKED_BY_ABILITY]: 'blockedByAbility',
  [GameMessage.BLOCKED_BY_EFFECT]: 'blockedByEffect',
  [GameMessage.CANNOT_PLAY_THIS_CARD]: 'cannotPlayCard',
  [GameMessage.CANNOT_RETREAT]: 'cannotRetreat',
  [GameMessage.CANNOT_USE_POWER]: 'cannotUseAbility',
  [GameMessage.CANNOT_USE_ATTACK]: 'cannotUseAttack',
  [GameMessage.CANNOT_USE_STADIUM]: 'cannotUseStadium',
  [GameMessage.CANNOT_ATTACK_ON_FIRST_TURN]: 'cannotAttackFirstTurn',
  [GameMessage.POKEMON_CANT_EVOLVE_THIS_TURN]: 'cannotEvolveThisTurn',
  [GameMessage.SUPPORTER_ALREADY_PLAYED]: 'alreadyPlayedSupporter',
  [GameMessage.STADIUM_ALREADY_PLAYED]: 'alreadyPlayedStadium',
  [GameMessage.STADIUM_ALREADY_USED]: 'alreadyUsedStadium',
  [GameMessage.SAME_STADIUM_ALREADY_IN_PLAY]: 'sameStadiumInPlay',
  [GameMessage.ENERGY_ALREADY_ATTACHED]: 'alreadyAttachedEnergy',
  [GameMessage.RETREAT_ALREADY_USED]: 'alreadyRetreated',
  [GameMessage.POKEMON_TOOL_ALREADY_ATTACHED]: 'toolAlreadyAttached',
  [GameMessage.POWER_ALREADY_USED]: 'abilityAlreadyUsed',
  [GameMessage.ACTION_IN_PROGRESS]: 'actionInProgress',
  [GameMessage.NO_STADIUM_IN_PLAY]: 'noStadiumInPlay',
  [GameMessage.ILLEGAL_ACTION]: 'illegalAction',
};

/** The neutral code for a caught GameError's message (the `GameMessage` value), or the catch-all. */
export function reasonCodeFor(message: string): ReasonCode {
  return REJECTION_MAP[message] ?? 'illegalAction';
}

/**
 * The internal (fine) `ReasonCode` → the contract's coarse `ContractReasonCode` (OpenAPI `ReasonCode`),
 * compared across engines best-effort. The verbatim engine code is preserved in `nativeReason`, so the
 * coarse bucketing loses no information.
 */
const CONTRACT_REASON: Record<ReasonCode, ContractReasonCode> = {
  notYourTurn: 'NOT_YOUR_TURN',
  cannotAttackFirstTurn: 'FIRST_TURN_RESTRICTION',
  abilityAlreadyUsed: 'ONCE_PER_TURN_EXHAUSTED',
  alreadyPlayedSupporter: 'ONCE_PER_TURN_EXHAUSTED',
  alreadyAttachedEnergy: 'ONCE_PER_TURN_EXHAUSTED',
  alreadyRetreated: 'ONCE_PER_TURN_EXHAUSTED',
  alreadyPlayedStadium: 'ONCE_PER_TURN_EXHAUSTED',
  alreadyUsedStadium: 'ONCE_PER_TURN_EXHAUSTED',
  notEnoughEnergy: 'INSUFFICIENT_ENERGY',
  invalidTarget: 'INVALID_TARGET',
  blockedBySpecialCondition: 'CONDITION_BLOCKED',
  cannotEvolveThisTurn: 'EVOLVE_NOT_ELIGIBLE',
  toolAlreadyAttached: 'TOOL_ALREADY_ATTACHED',
  cannotUseStadium: 'STADIUM_RULE',
  sameStadiumInPlay: 'STADIUM_RULE',
  noStadiumInPlay: 'STADIUM_RULE',
  unknownAttack: 'UNKNOWN_REFERENCE',
  unknownCard: 'UNKNOWN_REFERENCE',
  unknownAbility: 'UNKNOWN_REFERENCE',
  blockedByEffect: 'BLOCKED_BY_EFFECT',
  blockedByAbility: 'BLOCKED_BY_EFFECT',
  cannotPlayCard: 'CARD_SPECIFIC',
  cannotRetreat: 'CARD_SPECIFIC',
  cannotUseAbility: 'CARD_SPECIFIC',
  cannotUseAttack: 'CARD_SPECIFIC',
  actionInProgress: 'OTHER',
  illegalAction: 'OTHER',
  malformedRequest: 'OTHER', // HTTP-only; never reached via mapRejection
};

/** Coarsen an internal `ReasonCode` to the contract's `ContractReasonCode`. */
export function toContractReason(code: ReasonCode): ContractReasonCode {
  return CONTRACT_REASON[code];
}

/**
 * Map a thrown value to a RejectionInfo iff it is a `GameError` (an action the engine rejected).
 * Anything else (adapter bugs, unsupported prompts) returns undefined and keeps propagating — those
 * are contract/internal errors, not action rejections.
 */
export function mapRejection(err: unknown): RejectionInfo | undefined {
  if (err instanceof GameError) {
    return {
      reasonCode: toContractReason(reasonCodeFor(err.message)),
      nativeReason: { code: err.message, source: 'twinleaf:GameMessage' },
    };
  }
  return undefined;
}
