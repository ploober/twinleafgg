import { Prompt } from '../../game/store/prompts/prompt';
import { PromptDecomposer } from './decomposer';
import { chooseCardsDecomposer } from './choose-cards';
import { choosePokemonDecomposer } from './choose-pokemon';
import { putDamageDecomposer } from './put-damage';
import { attachEnergyDecomposer } from './attach-energy';
import { moveDamageDecomposer } from './move-damage';
import { removeDamageDecomposer } from './remove-damage';
import { discardEnergyDecomposer } from './discard-energy';
import { moveEnergyDecomposer } from './move-energy';
import { chooseEnergyDecomposer } from './choose-energy';
import { chooseAttackDecomposer } from './choose-attack';
import { choosePrizeDecomposer } from './choose-prize';
import { confirmDecomposer } from './confirm';
import { confirmCardsDecomposer } from './confirm-cards';
import { selectOptionDecomposer } from './select-option';
import { selectDecomposer } from './select';
import { orderCardsDecomposer } from './order-cards';
import { ConfirmCardsPrompt } from '../../game/store/prompts/confirm-cards-prompt';

export * from './decomposer';

/** How the driver loop handles a pending prompt. */
export type PromptKind = 'wait' | 'system' | 'decomposable' | 'unsupported';

const DECOMPOSERS: PromptDecomposer<any>[] = [
  chooseCardsDecomposer,
  choosePokemonDecomposer,
  putDamageDecomposer,
  attachEnergyDecomposer,
  moveDamageDecomposer,
  removeDamageDecomposer,
  discardEnergyDecomposer,
  moveEnergyDecomposer,
  chooseEnergyDecomposer,
  chooseAttackDecomposer,
  choosePrizeDecomposer,
  confirmDecomposer,
  confirmCardsDecomposer,
  selectOptionDecomposer,
  selectDecomposer,
  orderCardsDecomposer,
];

const REGISTRY = new Map<string, PromptDecomposer<any>>(DECOMPOSERS.map(d => [d.type, d]));

/**
 * Reveal / single-acknowledgement ("OK") prompts — all `Prompt<true>`, carrying NO branch. The
 * contract REQUIRES the adapter to auto-resolve them: they never surface in `pending` and consume no
 * action (OpenAPI `Action` §"NOT every engine prompt is a decision"; `Pending` §). Note twinleaf has
 * BOTH `'Confirm'` (a real yes/no, `Prompt<boolean>` → the `confirm` decomposer) and `'Confirm cards'`
 * (a `Prompt<true>`) — and `'Confirm cards'` is DUAL: `allowCancel:false` is a pure acknowledge (here),
 * but `allowCancel:true` is a real "you may…" yes/no (→ the `confirmCards` decomposer; TA-98), routed
 * below before this set is consulted.
 */
const REVEAL_ACK_PROMPTS = new Set<string>(['Show cards', 'Show mulligan', 'Alert', 'Confirm cards']);

export function classify(prompt: Prompt<any>): PromptKind {
  // 'Confirm cards' is dual: a cancelable one is a genuine optional decision ("you may discard the top
  // card" — Dig It Up); externalize it as a `confirm{value}` (TA-98). Only the non-cancelable reveal is
  // an auto-acknowledge. Route by allowCancel BEFORE the reveal/ack set (which also lists the type).
  if (prompt.type === 'Confirm cards') {
    return (prompt as ConfirmCardsPrompt).options.allowCancel ? 'decomposable' : 'wait';
  }
  // WaitPrompt (attack animation) + the reveal/ack prompts carry no decision: auto-resolve with `true`.
  if (prompt.type === 'WaitPrompt' || REVEAL_ACK_PROMPTS.has(prompt.type)) {
    return 'wait';
  }
  // ShuffleDeckPrompt ('Shuffle deck'), shuffle-hand/prizes, and CoinFlipPrompt are the system actor (M3).
  if (prompt.type.startsWith('Shuffle') || prompt.type === 'Coin flip') {
    return 'system';
  }
  return REGISTRY.has(prompt.type) ? 'decomposable' : 'unsupported';
}

export function decomposerFor(prompt: Prompt<any>): PromptDecomposer<any> {
  const decomposer = REGISTRY.get(prompt.type);
  if (decomposer === undefined) {
    throw new Error(`[conformance] no decomposer registered for prompt '${prompt.type}'`);
  }
  return decomposer;
}
