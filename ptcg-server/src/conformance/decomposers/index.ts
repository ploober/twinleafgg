import { Prompt } from '../../game/store/prompts/prompt';
import { PromptDecomposer } from './decomposer';
import { chooseCardsDecomposer } from './choose-cards';
import { choosePokemonDecomposer } from './choose-pokemon';
import { putDamageDecomposer } from './put-damage';
import { attachEnergyDecomposer } from './attach-energy';
import { moveDamageDecomposer } from './move-damage';
import { discardEnergyDecomposer } from './discard-energy';

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
];

const REGISTRY = new Map<string, PromptDecomposer<any>>(DECOMPOSERS.map(d => [d.type, d]));

export function classify(prompt: Prompt<any>): PromptKind {
  if (prompt.type === 'WaitPrompt') {
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
