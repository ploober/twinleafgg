import { Prompt } from '../../game/store/prompts/prompt';
import { PromptDecomposer } from './decomposer';
import { chooseCardsDecomposer } from './choose-cards';
import { choosePokemonDecomposer } from './choose-pokemon';
import { putDamageDecomposer } from './put-damage';
import { attachEnergyDecomposer } from './attach-energy';
import { moveDamageDecomposer } from './move-damage';
import { discardEnergyDecomposer } from './discard-energy';
import { chooseEnergyDecomposer } from './choose-energy';
import { chooseAttackDecomposer } from './choose-attack';
import { choosePrizeDecomposer } from './choose-prize';
import { confirmDecomposer } from './confirm';

export * from './decomposer';

/** How the driver loop handles a pending prompt. */
export type PromptKind = 'wait' | 'system' | 'decomposable' | 'unsupported';

const DECOMPOSERS: PromptDecomposer<any>[] = [
  chooseCardsDecomposer,
  choosePokemonDecomposer,
  putDamageDecomposer,
  attachEnergyDecomposer,
  moveDamageDecomposer,
  discardEnergyDecomposer,
  chooseEnergyDecomposer,
  chooseAttackDecomposer,
  choosePrizeDecomposer,
  confirmDecomposer,
];

const REGISTRY = new Map<string, PromptDecomposer<any>>(DECOMPOSERS.map(d => [d.type, d]));

export function classify(prompt: Prompt<any>): PromptKind {
  // WaitPrompt (attack animation) and ShowCardsPrompt ('Show cards', `Prompt<true>` — a pure
  // reveal/acknowledge whose result is always `true`) carry no decision: auto-resolve with `true`.
  // The revealed cards are already observable in the projected state, so nothing is lost.
  if (prompt.type === 'WaitPrompt' || prompt.type === 'Show cards') {
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
