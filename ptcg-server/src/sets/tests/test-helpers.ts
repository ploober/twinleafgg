import { Card } from '../../game/store/card/card';
import { CardManager } from '../../game/cards/card-manager';
import { EnergyCard } from '../../game/store/card/energy-card';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { SuperType, CardType } from '../../game/store/card/card-types';
import { State, GamePhase } from '../../game/store/state/state';
import { Player } from '../../game/store/state/player';
import { PokemonCardList } from '../../game/store/state/pokemon-card-list';
import { CardList } from '../../game/store/state/card-list';
import { StateUtils } from '../../game/store/state-utils';
import { Store } from '../../game/store/store';
import { StoreHandler } from '../../game/store/store-handler';
import { Prompt } from '../../game/store/prompts/prompt';
import { ResolvePromptAction } from '../../game/store/actions/resolve-prompt-action';
import { BotArbiter, BotFlipMode, BotShuffleMode } from '../../game/bots/bot-arbiter';
import { AlertPrompt } from '../../game/store/prompts/alert-prompt';
import { ConfirmPrompt } from '../../game/store/prompts/confirm-prompt';
import { ConfirmCardsPrompt } from '../../game/store/prompts/confirm-cards-prompt';
import { ShowCardsPrompt } from '../../game/store/prompts/show-cards-prompt';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { AttachEnergyPrompt } from '../../game/store/prompts/attach-energy-prompt';
import { ChooseEnergyPrompt } from '../../game/store/prompts/choose-energy-prompt';
import { SelectPrompt } from '../../game/store/prompts/select-prompt';
import { SelectOptionPrompt } from '../../game/store/prompts/select-option-prompt';
import { ChoosePrizePrompt } from '../../game/store/prompts/choose-prize-prompt';
import { OrderCardsPrompt } from '../../game/store/prompts/order-cards-prompt';
import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { MoveDamagePrompt } from '../../game/store/prompts/move-damage-prompt';
import { MoveEnergyPrompt } from '../../game/store/prompts/move-energy-prompt';
import { DiscardEnergyPrompt } from '../../game/store/prompts/discard-energy-prompt';
import { PlayerType, SlotType, CardTarget } from '../../game/store/actions/play-card-action';

// ── Config interfaces ──

export interface PokemonSlotConfig {
  card: string;
  energy?: string[];
  damage?: number;
  tools?: string[];
}

export interface PlayerConfig {
  active: PokemonSlotConfig;
  bench?: PokemonSlotConfig[];
  hand?: string[];
  deck?: string[];
  discard?: string[];
  prizeCount?: number;
}

export interface SetupGameConfig {
  player1: PlayerConfig;
  player2: PlayerConfig;
  /** Override the starting turn number (default 1) */
  turn?: number;
}

// ── Card registration ──

const fs = require('fs');
const path = require('path');

const setsDir = path.resolve(__dirname, '..');
const EXPORT_PATH_REGEX = /export \* from '\.\/([^']+)'/g;
const IMPORT_PATH_REGEX = /from '\.\/([^']+)'/g;
const SET_DECLARATION_REGEX = /public set(?:\s*:\s*string)?\s*=\s*['"]([^'"]+)['"]/;
const SET_CODE_REGEX = /^[A-Z0-9-]{2,8}$/;

let setCodeToModules: Map<string, string[]> | undefined;
const loadedSetModules = new Set<string>();

function getExportedSetModulePaths(): string[] {
  const indexContent: string = fs.readFileSync(path.join(setsDir, 'index.ts'), 'utf8');
  const modulePaths: string[] = [];
  EXPORT_PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPORT_PATH_REGEX.exec(indexContent)) !== null) {
    modulePaths.push(match[1]);
  }
  return modulePaths;
}

// Every distinct, valid set code declared in a card file's source, in declaration order. A file can
// declare several (an `other-prints` reprints file carries cards from multiple sets).
function extractSetCodesFromSource(source: string): string[] {
  const codes: string[] = [];
  const re = new RegExp(SET_DECLARATION_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const setCode = match[1].toUpperCase();
    if (SET_CODE_REGEX.test(setCode) && codes.indexOf(setCode) === -1) {
      codes.push(setCode);
    }
  }
  return codes;
}

// Every distinct set code a module's card files declare, in first-seen order. Most modules have one; a
// few have several because their index imports an `other-prints` reprints file FIRST, whose cards carry a
// foreign set code before the module's own (e.g. set-ascended-heroes leads with `set='MC'` Mega Charizard
// reprints, then its 71 `set='ASC'` cards). Registering a module under ALL its codes — not just the first
// — is what lets `ensureSetCodeLoaded('ASC')` find and load it. Purely additive: a module becomes
// findable under more codes, never fewer.
function inferSetCodesFromModule(moduleName: string): string[] {
  const moduleDir = path.join(setsDir, moduleName);
  const indexPath = path.join(moduleDir, 'index.ts');
  if (!fs.existsSync(indexPath)) {
    return [];
  }

  const indexContent: string = fs.readFileSync(indexPath, 'utf8');
  const candidateFiles: string[] = [];
  IMPORT_PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_PATH_REGEX.exec(indexContent)) !== null) {
    candidateFiles.push(path.join(moduleDir, `${match[1]}.ts`));
  }

  const codes: string[] = [];
  const collect = (file: string): void => {
    for (const code of extractSetCodesFromSource(fs.readFileSync(file, 'utf8'))) {
      if (codes.indexOf(code) === -1) { codes.push(code); }
    }
  };
  for (const candidateFile of candidateFiles) {
    if (fs.existsSync(candidateFile)) { collect(candidateFile); }
  }
  if (codes.length === 0) {
    const fallbackFiles = fs.readdirSync(moduleDir)
      .filter((file: string) => file.endsWith('.ts') && file !== 'index.ts');
    for (const file of fallbackFiles) { collect(path.join(moduleDir, file)); }
  }
  return codes;
}

// Legacy singular (the module's first-declared code) — used only for failed-module reporting in loadAllSets.
function inferSetCodeFromModule(moduleName: string): string | undefined {
  return inferSetCodesFromModule(moduleName)[0];
}

function getSetCodeToModules(): Map<string, string[]> {
  if (setCodeToModules) {
    return setCodeToModules;
  }

  const map = new Map<string, string[]>();
  for (const moduleName of getExportedSetModulePaths()) {
    for (const setCode of inferSetCodesFromModule(moduleName)) {
      const modules = map.get(setCode) ?? [];
      modules.push(moduleName);
      map.set(setCode, modules);
    }
  }

  setCodeToModules = map;
  return map;
}

function extractSetCodeFromFullName(fullName: string): string {
  const tokens = fullName.trim().split(/\s+/);
  const lastToken = tokens[tokens.length - 1]?.toUpperCase();
  if (!lastToken || !SET_CODE_REGEX.test(lastToken)) {
    throw new Error(`[test-helpers] Could not infer set code from card fullName "${fullName}"`);
  }
  return lastToken;
}

function loadSetModule(moduleName: string): void {
  if (loadedSetModules.has(moduleName)) {
    return;
  }

  const cardManager = CardManager.getInstance();
  const mod = require(path.join(setsDir, moduleName));
  for (const key of Object.keys(mod)) {
    const value = mod[key];
    if (!Array.isArray(value) || value.length === 0 || !(value[0] instanceof Card)) {
      continue;
    }
    try {
      cardManager.defineSet(value);
    } catch (error: any) {
      if (!error.message?.startsWith('Multiple cards with the same name')) {
        throw error;
      }
    }
  }
  loadedSetModules.add(moduleName);
}

function ensureSetCodeLoaded(setCode: string): void {
  const modulePaths = getSetCodeToModules().get(setCode);
  if (!modulePaths || modulePaths.length === 0) {
    throw new Error(`[test-helpers] No set module found for set code "${setCode}"`);
  }

  for (const moduleName of modulePaths) {
    try {
      loadSetModule(moduleName);
    } catch (error: any) {
      throw new Error(`[test-helpers] Failed to load set module "${moduleName}" (${setCode}): ${error.message}`);
    }
  }
}

/**
 * Force-load every exported set module so CardManager holds the full registry, reporting which
 * modules loaded and which threw on `require`. Some set barrels fail under ts-node/jasmine-ts
 * (e.g. set-scarlet-and-violet / SVI: "Class constructor TrainerCard cannot be invoked without
 * 'new'"); those are caught per-module (not aborting the sweep) and returned with their inferred set
 * code. Used by the conformance `/v1/capabilities` endpoint to enumerate supported cards and to
 * report load-failing sets. Idempotent (each module loads at most once).
 */
export function loadAllSets(): {
  loadedModules: string[];
  failedModules: { module: string; setCode?: string; error: string }[];
} {
  const loadedModules: string[] = [];
  const failedModules: { module: string; setCode?: string; error: string }[] = [];
  for (const moduleName of getExportedSetModulePaths()) {
    try {
      loadSetModule(moduleName);
      loadedModules.push(moduleName);
    } catch (error: any) {
      failedModules.push({
        module: moduleName,
        setCode: inferSetCodeFromModule(moduleName),
        error: error?.message ?? String(error),
      });
    }
  }
  return { loadedModules, failedModules };
}

export function ensureCardsRegistered(cardNames: string[] = []): void {
  const cardManager = CardManager.getInstance();
  const namesToRegister = Array.from(new Set(cardNames.map(name => name.trim()).filter(Boolean)));

  for (const fullName of namesToRegister) {
    if (cardManager.isCardDefined(fullName)) {
      continue;
    }
    const setCode = extractSetCodeFromFullName(fullName);
    ensureSetCodeLoaded(setCode);
  }
}

/**
 * Resolves a card by its Twinleaf set code and collector number, loading the set on demand.
 * Returns undefined (rather than throwing) when the set code maps to no loadable module —
 * callers treat that as "not resolvable" rather than an error.
 */
export function getCardBySetAndNumber(setCode: string, setNumber: string): Card | undefined {
  try {
    ensureSetCodeLoaded(setCode);
  } catch {
    return undefined;
  }
  // O(1) via CardManager's set+number index (was an O(registry) linear scan per call — ~4ms over the
  // full 12.5k-card registry, called ~2x per imported card, which dominated stateless /v1/step latency).
  return CardManager.getInstance().getCardBySetAndNumber(setCode, setNumber);
}

// ── Convenience helpers ──

export function getCardByName(fullName: string): Card {
  const cardManager = CardManager.getInstance();
  let card = cardManager.getCardByName(fullName);
  if (!card) {
    ensureCardsRegistered([fullName]);
    card = cardManager.getCardByName(fullName);
  }
  if (card === undefined) {
    throw new Error(`Card not found: "${fullName}"`);
  }
  return card;
}

const DEFAULT_FILLER = 'Water Energy SVE';

export function padDeck(n: number, cardName?: string): string[] {
  return Array(n).fill(cardName ?? DEFAULT_FILLER);
}

// ── Prompt override map ──

type PromptHandler = (prompt: Prompt<any>, state: State) => any;

// Canonical `player-slot-index` key for a CardTarget (board position identity).
export function cardTargetKey(target: CardTarget): string {
  return `${target.player}-${target.slot}-${target.index}`;
}

// The canonical eligible-target list for a ChoosePokemonPrompt — BOTTOM-then-TOP player, active-before-bench,
// low-index, honoring playerType/slots/blocked. Shared by the harness auto-resolver (first-eligible is just
// `candidates.slice(0, max)`) and the rotomancer choice differential, which enumerates *every* option to
// verify the two engines offer the same set and that each option does the same thing.
export function choosePokemonCandidates(state: State, prompt: ChoosePokemonPrompt): CardTarget[] {
  const player = state.players.find(p => p.id === prompt.playerId);
  const opponent = state.players.find(p => p.id !== prompt.playerId);
  if (!player || !opponent) { return []; }
  const blockedSet = new Set(prompt.options.blocked.map(cardTargetKey));
  const targets: CardTarget[] = [];
  for (const pt of [PlayerType.BOTTOM_PLAYER, PlayerType.TOP_PLAYER]) {
    const p = pt === PlayerType.BOTTOM_PLAYER ? player : opponent;
    if (prompt.playerType !== PlayerType.ANY && prompt.playerType !== pt) { continue; }
    if (prompt.slots.includes(SlotType.ACTIVE) && p.active.cards.length > 0) {
      const t: CardTarget = { player: pt, slot: SlotType.ACTIVE, index: 0 };
      if (!blockedSet.has(cardTargetKey(t))) { targets.push(t); }
    }
    if (prompt.slots.includes(SlotType.BENCH)) {
      for (let i = 0; i < p.bench.length; i++) {
        if (p.bench[i].cards.length > 0) {
          const t: CardTarget = { player: pt, slot: SlotType.BENCH, index: i };
          if (!blockedSet.has(cardTargetKey(t))) { targets.push(t); }
        }
      }
    }
  }
  return targets;
}

// True when `card` matches every own-enumerable field of the partial `filter` (shallow strict-equality) —
// the canonical eligibility check the ChooseCards/AttachEnergy auto-resolvers use. Module-level so the
// rotomancer card-choice differential can enumerate a ChooseCardsPrompt's eligible cards the same way.
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

export function cardMatchesPartialFilter(card: Card, filter: Partial<Card>): boolean {
  if (engineCardMatcher !== undefined) { return engineCardMatcher(card, filter); }
  for (const key in filter) {
    if (!Object.prototype.hasOwnProperty.call(filter, key)) { continue; }
    if ((card as any)[key] !== (filter as any)[key]) { return false; }
  }
  return true;
}

// The eligible card indices for a ChooseCardsPrompt — the filter-matching, non-blocked cards, in prompt
// order. Shared by the harness auto-resolver (first-eligible is `chooseCardsCandidates(prompt).slice(0, max)`)
// and the rotomancer card-choice differential, which enumerates *every* eligible card to verify the two
// engines offer the same set and that each pick does the same thing.
export function chooseCardsCandidates(prompt: ChooseCardsPrompt): number[] {
  const blocked = new Set(prompt.options.blocked);
  const indices: number[] = [];
  for (let i = 0; i < prompt.cards.cards.length; i++) {
    if (blocked.has(i) || !cardMatchesPartialFilter(prompt.cards.cards[i], prompt.filter)) { continue; }
    indices.push(i);
  }
  return indices;
}

// ── TestStoreHandler ──

class TestStoreHandler implements StoreHandler {
  private arbiter = new BotArbiter({
    flipMode: BotFlipMode.ALL_HEADS,
    shuffleMode: BotShuffleMode.NO_SHUFFLE
  });
  private overrides = new Map<string, PromptHandler>();
  private store!: Store;

  // Divergence guard for the Rotomancer differential: counts genuine multi-option choices the
  // harness made (a ChoosePokemon/ChooseCards prompt where more candidates were eligible than were
  // selected). The differential skips an attack when the native run made such a choice but the
  // IR-interpreted run resolved it directly — there is then no guarantee the two picked the same
  // option, so comparing snapshots could yield a false mismatch.
  public ambiguousChoices = 0;

  setStore(store: Store): void {
    this.store = store;
  }

  overridePrompt(type: string, handler: PromptHandler): void {
    this.overrides.set(type, handler);
  }

  // Deterministic coin flips for CoinFlipEffect, which resolves outside the prompt system and so
  // never reaches resolvePrompt/the arbiter's CoinFlipPrompt branch. game-effect.ts calls this
  // when present, giving ALL_HEADS its intended authority over every coin flip in a test.
  flipCoin(): boolean {
    return this.arbiter.flipCoin();
  }

  onStateChange(state: State): void {
    // Auto-resolve any pending prompts
    const pending = state.prompts.filter(p => p.result === undefined);
    for (const prompt of pending) {
      const action = this.resolvePrompt(state, prompt);
      if (action) {
        this.store.dispatch(action);
      }
    }
  }

  private resolvePrompt(state: State, prompt: Prompt<any>): ResolvePromptAction | undefined {
    // Check one-shot overrides first
    const override = this.overrides.get(prompt.type);
    if (override) {
      this.overrides.delete(prompt.type);
      const rawResult = override(prompt, state);
      return this.decodeAndValidatePromptResult(state, prompt, rawResult);
    }

    // Try BotArbiter for coin flips and shuffles
    const arbiterResult = this.arbiter.resolvePrompt(state, prompt);
    if (arbiterResult) {
      return this.decodeAndValidatePromptResult(state, prompt, arbiterResult.result, arbiterResult.log);
    }

    const rawResult = this.resolveRawPromptResult(state, prompt);
    return this.decodeAndValidatePromptResult(state, prompt, rawResult);
  }

  private resolveRawPromptResult(state: State, prompt: Prompt<any>): any {
    // Auto-resolve by prompt type — these are raw prompt payloads
    let rawResult: any = true;

    if (prompt instanceof AlertPrompt) {
      rawResult = true;
    } else if (prompt instanceof ShowCardsPrompt) {
      rawResult = true;
    } else if (prompt instanceof ConfirmPrompt) {
      rawResult = true;
    } else if (prompt instanceof ConfirmCardsPrompt) {
      rawResult = true;
    } else if (prompt instanceof ChooseCardsPrompt) {
      rawResult = this.resolveChooseCardsRaw(prompt);
    } else if (prompt instanceof ChoosePokemonPrompt) {
      rawResult = this.resolveChoosePokemonRaw(state, prompt);
    } else if (prompt instanceof AttachEnergyPrompt) {
      rawResult = this.resolveAttachEnergyRaw(state, prompt);
    } else if (prompt instanceof ChooseEnergyPrompt) {
      rawResult = this.resolveChooseEnergyRaw(prompt);
    } else if (prompt instanceof SelectPrompt) {
      rawResult = 0;
    } else if (prompt instanceof SelectOptionPrompt) {
      rawResult = 0;
    } else if (prompt instanceof ChoosePrizePrompt) {
      rawResult = this.resolveChoosePrizeRaw(state, prompt);
    } else if (prompt instanceof OrderCardsPrompt) {
      rawResult = prompt.cards.cards.map((_: any, i: number) => i);
    } else if (prompt instanceof PutDamagePrompt) {
      rawResult = this.resolvePutDamageRaw(state, prompt);
    } else if (prompt instanceof MoveDamagePrompt) {
      rawResult = prompt.options.allowCancel ? null : [];
    } else if (prompt instanceof MoveEnergyPrompt) {
      rawResult = this.resolveMoveEnergyRaw(state, prompt);
    } else if (prompt instanceof DiscardEnergyPrompt) {
      rawResult = this.resolveDiscardEnergyRaw(state, prompt);
    }

    return rawResult;
  }

  private decodeAndValidatePromptResult(
    state: State,
    prompt: Prompt<any>,
    rawResult: any,
    log?: any
  ): ResolvePromptAction {
    const decoded = prompt.decode(rawResult, state);
    // ShuffleDeckPrompt/ShuffleHandPrompt (both type 'Shuffle deck') validate the order with a lexicographic
    // `array.sort()` (no numeric comparator), so they wrongly reject the identity permutation for any deck of
    // ≥ 11 cards — `[0,1,…,28].sort()` → `[0,1,10,11,…,2,…]`, so `s[i] !== i` (a native engine bug). The
    // auto-resolved order here is the deterministic NO_SHUFFLE identity (correct by construction), so the
    // harness skips validation for shuffle prompts rather than choke on that native validate bug.
    if (prompt.type !== 'Shuffle deck' && prompt.validate(decoded, state) === false) {
      throw new Error(`[test-helpers] Invalid auto-resolved prompt result for "${prompt.type}"`);
    }
    return new ResolvePromptAction(prompt.id, decoded, log);
  }

  private getPromptPlayers(state: State, prompt: Prompt<any>): { player: Player; opponent: Player } | undefined {
    const player = state.players.find(p => p.id === prompt.playerId);
    const opponent = state.players.find(p => p.id !== prompt.playerId);
    if (!player || !opponent) {
      return undefined;
    }
    return { player, opponent };
  }

  private toTargetKey(target: CardTarget): string {
    return `${target.player}-${target.slot}-${target.index}`;
  }

  private cardMatchesPartialFilter(card: Card, filter: Partial<Card>): boolean {
    return cardMatchesPartialFilter(card, filter); // delegates to the module-level helper (now shared, §12.11)
  }

  private resolveChooseCardsRaw(prompt: ChooseCardsPrompt): any {
    // The eligible set is the filter-matching, non-blocked cards (a card that doesn't match the prompt's
    // `filter` is not a legal pick). First-eligible is `candidates.slice(0, max)`; the rotomancer card-choice
    // differential reuses the same `chooseCardsCandidates` enumerator to compare option sets across engines.
    const indices = chooseCardsCandidates(prompt);
    const result = indices.slice(0, prompt.options.max);
    if (indices.length > result.length) { this.ambiguousChoices++; } // more candidates than picked → a choice
    if (result.length < prompt.options.min && prompt.options.allowCancel) {
      return null;
    }
    return result;
  }

  private resolveChoosePokemonRaw(state: State, prompt: ChoosePokemonPrompt): any {
    if (!this.getPromptPlayers(state, prompt)) return null; // preserve the no-players guard
    const targets = choosePokemonCandidates(state, prompt); // the canonical eligible list (now shared, §12.10)
    const max = prompt.options.max;
    const result = targets.slice(0, max);
    if (targets.length > result.length) { this.ambiguousChoices++; } // more eligible than picked → a choice
    if (result.length < prompt.options.min) {
      return prompt.options.allowCancel ? null : [];
    }
    return result;
  }

  private getPrimaryEnergyType(card: Card): CardType {
    if (card instanceof EnergyCard && card.provides.length > 0) {
      return card.provides[0];
    }
    return CardType.NONE;
  }

  private buildAttachTargets(
    player: Player,
    opponent: Player,
    prompt: AttachEnergyPrompt
  ): CardTarget[] {
    const blockedToSet = new Set(prompt.options.blockedTo.map(target => this.toTargetKey(target)));
    const targets: CardTarget[] = [];
    const targetPlayers: PlayerType[] = prompt.playerType === PlayerType.ANY
      ? [PlayerType.BOTTOM_PLAYER, PlayerType.TOP_PLAYER]
      : [prompt.playerType];

    for (const playerType of targetPlayers) {
      const targetPlayer = playerType === PlayerType.BOTTOM_PLAYER ? player : opponent;
      if (prompt.slots.includes(SlotType.ACTIVE) && targetPlayer.active.cards.length > 0) {
        const target: CardTarget = { player: playerType, slot: SlotType.ACTIVE, index: 0 };
        if (!blockedToSet.has(this.toTargetKey(target))) {
          targets.push(target);
        }
      }
      if (prompt.slots.includes(SlotType.BENCH)) {
        for (let i = 0; i < targetPlayer.bench.length; i++) {
          if (targetPlayer.bench[i].cards.length === 0) {
            continue;
          }
          const target: CardTarget = { player: playerType, slot: SlotType.BENCH, index: i };
          if (!blockedToSet.has(this.toTargetKey(target))) {
            targets.push(target);
          }
        }
      }
    }

    return targets;
  }

  private findAttachAssignments(
    energies: Array<{ index: number; card: Card; type: CardType }>,
    targets: CardTarget[],
    prompt: AttachEnergyPrompt,
    desiredCount: number
  ): Array<{ to: CardTarget; index: number }> | undefined {
    const assignments: Array<{ to: CardTarget; index: number }> = [];
    const usedTargets = new Set<string>();
    const usedTypes = new Set<CardType>();
    const typeCounts = new Map<CardType, number>();

    const canUseEnergy = (energy: { card: Card; type: CardType }): boolean => {
      if (prompt.options.validCardTypes) {
        const provided = energy.card instanceof EnergyCard ? energy.card.provides : [];
        if (!provided.some(type => prompt.options.validCardTypes!.includes(type))) {
          return false;
        }
      }

      if (prompt.options.differentTypes && usedTypes.has(energy.type)) {
        return false;
      }

      if (prompt.options.maxPerType !== undefined) {
        const count = (typeCounts.get(energy.type) ?? 0) + 1;
        if (count > prompt.options.maxPerType) {
          return false;
        }
      }

      return true;
    };

    const canUseTarget = (target: CardTarget): boolean => {
      const targetKey = this.toTargetKey(target);
      if (prompt.options.sameTarget && assignments.length > 0) {
        const firstKey = this.toTargetKey(assignments[0].to);
        if (targetKey !== firstKey) {
          return false;
        }
      }
      if (prompt.options.differentTargets && usedTargets.has(targetKey)) {
        return false;
      }
      return true;
    };

    const recurse = (energyStartIndex: number): boolean => {
      if (assignments.length === desiredCount) {
        return true;
      }

      for (let i = energyStartIndex; i < energies.length; i++) {
        const energy = energies[i];
        if (!canUseEnergy(energy)) {
          continue;
        }

        for (const target of targets) {
          if (!canUseTarget(target)) {
            continue;
          }

          const targetKey = this.toTargetKey(target);
          assignments.push({ to: target, index: energy.index });
          usedTargets.add(targetKey);
          usedTypes.add(energy.type);
          typeCounts.set(energy.type, (typeCounts.get(energy.type) ?? 0) + 1);

          if (recurse(i + 1)) {
            return true;
          }

          assignments.pop();
          if (prompt.options.differentTargets) {
            usedTargets.delete(targetKey);
          }

          const nextCount = (typeCounts.get(energy.type) ?? 1) - 1;
          if (nextCount <= 0) {
            typeCounts.delete(energy.type);
            usedTypes.delete(energy.type);
          } else {
            typeCounts.set(energy.type, nextCount);
          }
        }
      }

      return false;
    };

    return recurse(0) ? assignments : undefined;
  }

  private resolveAttachEnergyRaw(state: State, prompt: AttachEnergyPrompt): any {
    const promptPlayers = this.getPromptPlayers(state, prompt);
    if (!promptPlayers) return null;
    const { player, opponent } = promptPlayers;

    const blocked = new Set(prompt.options.blocked);
    const energyCandidates: Array<{ index: number; card: Card; type: CardType }> = [];
    for (let i = 0; i < prompt.cardList.cards.length; i++) {
      const card = prompt.cardList.cards[i];
      if (blocked.has(i) || card.superType !== SuperType.ENERGY) {
        continue;
      }
      if (!this.cardMatchesPartialFilter(card, prompt.filter)) {
        continue;
      }
      energyCandidates.push({ index: i, card, type: this.getPrimaryEnergyType(card) });
    }
    if (energyCandidates.length === 0) {
      return prompt.options.allowCancel ? null : [];
    }

    const targets = this.buildAttachTargets(player, opponent, prompt);
    if (targets.length === 0) {
      return prompt.options.allowCancel ? null : [];
    }

    const max = Math.min(prompt.options.max, energyCandidates.length);
    const min = Math.max(0, prompt.options.min);
    for (let desiredCount = max; desiredCount >= min; desiredCount--) {
      const assignments = this.findAttachAssignments(energyCandidates, targets, prompt, desiredCount);
      if (assignments !== undefined) {
        return assignments;
      }
    }

    return prompt.options.allowCancel ? null : [];
  }

  // Deterministically resolve a MoveEnergyPrompt (previously a no-op stub): move the first eligible
  // attached Energy from the first eligible source Pokémon to the first eligible destination, honoring
  // playerType × slots, blockedFrom / blockedTo / blockedMap, the card filter, and min/max. This makes
  // native "move an Energy from this Pokémon to 1 of your Benched Pokémon" attacks actually move energy,
  // so a second engine emitting the same prompt produces the identical observable. (Mirrors how
  // resolveAttachEnergyRaw moves energy; both pick first-eligible, active-before-bench, low-index.)
  private resolveMoveEnergyRaw(state: State, prompt: MoveEnergyPrompt): any {
    const promptPlayers = this.getPromptPlayers(state, prompt);
    if (!promptPlayers) { return prompt.options.allowCancel ? null : []; }
    const { player, opponent } = promptPlayers;

    const pokemon: Array<{ target: CardTarget; list: PokemonCardList }> = [];
    const playerTypes: PlayerType[] = prompt.playerType === PlayerType.ANY
      ? [PlayerType.BOTTOM_PLAYER, PlayerType.TOP_PLAYER] : [prompt.playerType];
    for (const pt of playerTypes) {
      const p = pt === PlayerType.BOTTOM_PLAYER ? player : opponent;
      if (prompt.slots.includes(SlotType.ACTIVE) && p.active.cards.length > 0) {
        pokemon.push({ target: { player: pt, slot: SlotType.ACTIVE, index: 0 }, list: p.active });
      }
      if (prompt.slots.includes(SlotType.BENCH)) {
        for (let i = 0; i < p.bench.length; i++) {
          if (p.bench[i].cards.length > 0) { pokemon.push({ target: { player: pt, slot: SlotType.BENCH, index: i }, list: p.bench[i] }); }
        }
      }
    }

    const blockedFrom = new Set(prompt.options.blockedFrom.map(t => this.toTargetKey(t)));
    const blockedTo = new Set(prompt.options.blockedTo.map(t => this.toTargetKey(t)));
    const blockedMap = new Map<string, Set<number>>();
    for (const bm of prompt.options.blockedMap) { blockedMap.set(this.toTargetKey(bm.source), new Set(bm.blocked)); }

    const sources = pokemon.filter(s => !blockedFrom.has(this.toTargetKey(s.target)));
    const dests = pokemon.filter(d => !blockedTo.has(this.toTargetKey(d.target)));
    const max = prompt.options.max ?? 1;

    const result: Array<{ from: CardTarget; to: CardTarget; index: number }> = [];
    for (const src of sources) {
      if (result.length >= max) { break; }
      const srcKey = this.toTargetKey(src.target);
      const blockedIdx = blockedMap.get(srcKey) ?? new Set<number>();
      const dest = dests.find(d => this.toTargetKey(d.target) !== srcKey);
      if (!dest) { continue; }
      for (let i = 0; i < src.list.cards.length && result.length < max; i++) {
        const card = src.list.cards[i];
        if (!(card instanceof EnergyCard) || blockedIdx.has(i) || !this.cardMatchesPartialFilter(card, prompt.filter)) { continue; }
        result.push({ from: src.target, to: dest.target, index: i });
      }
    }
    if (result.length < prompt.options.min) { return prompt.options.allowCancel ? null : []; }
    return result;
  }

  private getEnergyCardScore(provides: CardType[]): number {
    let score = 0;
    provides.forEach(cardType => {
      if (cardType === CardType.COLORLESS) {
        score += 2;
      } else if (cardType === CardType.ANY) {
        score += 10;
      } else {
        score += 3;
      }
    });
    return score;
  }

  private resolveChooseEnergyRaw(prompt: ChooseEnergyPrompt): any {
    const selectedIndices: number[] = [];
    const remainingIndices = prompt.energy.map((_, index) => index);
    const costsToCover = prompt.cost.filter(cost => cost !== CardType.COLORLESS);

    while (costsToCover.length > 0 && remainingIndices.length > 0) {
      const cost = costsToCover[0];
      let selectedPosition = remainingIndices.findIndex(index => prompt.energy[index].provides.includes(cost));
      if (selectedPosition === -1) {
        selectedPosition = remainingIndices.findIndex(index => prompt.energy[index].provides.includes(CardType.ANY));
      }
      if (selectedPosition === -1) {
        break;
      }

      const energyIndex = remainingIndices[selectedPosition];
      remainingIndices.splice(selectedPosition, 1);
      selectedIndices.push(energyIndex);

      for (const providedType of prompt.energy[energyIndex].provides) {
        if (providedType === CardType.ANY && costsToCover.length > 0) {
          costsToCover.shift();
        } else {
          const costIndex = costsToCover.indexOf(providedType);
          if (costIndex !== -1) {
            costsToCover.splice(costIndex, 1);
          }
        }
      }
    }

    if (costsToCover.length > 0) {
      return prompt.options.allowCancel ? null : [];
    }

    remainingIndices.sort((left, right) => {
      const leftScore = this.getEnergyCardScore(prompt.energy[left].provides);
      const rightScore = this.getEnergyCardScore(prompt.energy[right].provides);
      return leftScore - rightScore;
    });

    while (remainingIndices.length > 0) {
      const selectedEnergy = selectedIndices.map(index => prompt.energy[index]);
      if (StateUtils.checkEnoughEnergy(selectedEnergy, prompt.cost)) {
        break;
      }
      const energyIndex = remainingIndices.shift();
      if (energyIndex !== undefined) {
        selectedIndices.push(energyIndex);
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < selectedIndices.length; i++) {
        const nextSelected = selectedIndices.slice();
        nextSelected.splice(i, 1);
        const selectedEnergy = nextSelected.map(index => prompt.energy[index]);
        if (StateUtils.checkEnoughEnergy(selectedEnergy, prompt.cost)) {
          selectedIndices.splice(i, 1);
          changed = true;
          break;
        }
      }
    }

    const selectedEnergy = selectedIndices.map(index => prompt.energy[index]);
    if (!prompt.validate(selectedEnergy)) {
      return prompt.options.allowCancel ? null : [];
    }

    return selectedIndices;
  }

  private resolveChoosePrizeRaw(state: State, prompt: ChoosePrizePrompt): any {
    const player = state.players.find(p => p.id === prompt.playerId);
    if (!player) return null;
    const nonEmpty: number[] = [];
    const prizes = player.prizes.filter(p => p.cards.length > 0);
    for (let i = 0; i < prizes.length && nonEmpty.length < prompt.options.count; i++) {
      if (!prompt.options.blocked.includes(i)) {
        nonEmpty.push(i);
      }
    }
    return nonEmpty;
  }

  private resolvePutDamageRaw(state: State, prompt: PutDamagePrompt): any {
    const player = state.players.find(p => p.id === prompt.playerId);
    if (!player) return null;

    const blockedSet = new Set(prompt.options.blocked.map(b => this.toTargetKey(b)));
    // Respect the prompt's slot restriction: maxAllowedDamage may list every Pokémon (incl. the Active),
    // but a prompt scoped to e.g. [BENCH] must only land damage on those slots — otherwise the auto-pick
    // (first eligible = the Active) is rejected by PutDamagePrompt.validate and the whole attack throws.
    const allowedSlots = new Set(prompt.slots);

    let fallbackTarget: CardTarget | undefined;
    for (const dm of prompt.maxAllowedDamage) {
      if (dm.damage <= 0 || blockedSet.has(this.toTargetKey(dm.target)) || !allowedSlots.has(dm.target.slot)) {
        continue;
      }
      if (fallbackTarget === undefined) {
        fallbackTarget = dm.target;
      }
      if (dm.damage >= prompt.damage) {
        return [{ target: dm.target, damage: prompt.damage }];
      }
    }

    if (fallbackTarget && prompt.options.allowPlacePartialDamage) {
      const target = fallbackTarget;
      const fallbackDamage = prompt.maxAllowedDamage.find(dm => this.toTargetKey(dm.target) === this.toTargetKey(target))?.damage ?? prompt.damage;
      return [{ target, damage: Math.min(prompt.damage, fallbackDamage) }];
    }

    return prompt.options.allowCancel ? null : [];
  }

  private resolveDiscardEnergyRaw(state: State, prompt: DiscardEnergyPrompt): any {
    const promptPlayers = this.getPromptPlayers(state, prompt);
    if (!promptPlayers) return null;
    const { player, opponent } = promptPlayers;

    const blockedFromSet = new Set(prompt.options.blockedFrom.map(source => this.toTargetKey(source)));
    const blockedBySource = new Map<string, Set<number>>();
    for (const blockEntry of prompt.options.blockedMap) {
      blockedBySource.set(
        this.toTargetKey(blockEntry.source),
        new Set(blockEntry.blocked)
      );
    }

    const result: { from: CardTarget; index: number }[] = [];
    const max = prompt.options.max ?? Infinity;

    const scanSlots = (playerType: PlayerType, targetPlayer: Player) => {
      if (prompt.playerType !== PlayerType.ANY && prompt.playerType !== playerType) return;

      const slots: Array<{ cardList: PokemonCardList; target: CardTarget }> = [];
      if (prompt.slots.includes(SlotType.ACTIVE) && targetPlayer.active.cards.length > 0) {
        slots.push({
          cardList: targetPlayer.active,
          target: { player: playerType, slot: SlotType.ACTIVE, index: 0 }
        });
      }
      if (prompt.slots.includes(SlotType.BENCH)) {
        for (let i = 0; i < targetPlayer.bench.length; i++) {
          if (targetPlayer.bench[i].cards.length > 0) {
            slots.push({
              cardList: targetPlayer.bench[i],
              target: { player: playerType, slot: SlotType.BENCH, index: i }
            });
          }
        }
      }

      for (const { cardList, target } of slots) {
        const sourceKey = this.toTargetKey(target);
        if (blockedFromSet.has(sourceKey)) continue;
        const blockedIndices = blockedBySource.get(sourceKey) ?? new Set<number>();
        for (let i = 0; i < cardList.cards.length && result.length < max; i++) {
          const card = cardList.cards[i];
          if (card.superType !== SuperType.ENERGY) {
            continue;
          }
          if (blockedIndices.has(i)) {
            continue;
          }
          if (!this.cardMatchesPartialFilter(card, prompt.filter)) {
            continue;
          }
          result.push({ from: target, index: i });
        }
      }
    };

    scanSlots(PlayerType.BOTTOM_PLAYER, player);
    scanSlots(PlayerType.TOP_PLAYER, opponent);

    const min = prompt.options.min;
    if (result.length < min) {
      return prompt.options.allowCancel ? null : [];
    }
    return result.slice(0, max);
  }
}

// ── Main setup function ──

let nextCardId = 1000;

export interface SetupGameResult {
  store: Store;
  state: State;
  player1: Player;
  player2: Player;
  overridePrompt: (type: string, handler: PromptHandler) => void;
  ambiguousChoices: () => number;  // genuine multi-option choices the harness has made (divergence guard)
}

function collectCardsFromPokemonSlot(config: PokemonSlotConfig): string[] {
  const cards: string[] = [config.card];
  if (config.energy) {
    cards.push(...config.energy);
  }
  if (config.tools) {
    cards.push(...config.tools);
  }
  return cards;
}

function collectCardsFromPlayerConfig(config: PlayerConfig): string[] {
  const cards: string[] = [];
  cards.push(...collectCardsFromPokemonSlot(config.active));
  if (config.bench) {
    config.bench.forEach(slot => cards.push(...collectCardsFromPokemonSlot(slot)));
  }
  if (config.hand) {
    cards.push(...config.hand);
  }
  if (config.deck) {
    cards.push(...config.deck);
  }
  if (config.discard) {
    cards.push(...config.discard);
  }
  return cards;
}

function collectCardsFromSetupConfig(config: SetupGameConfig): string[] {
  return [
    DEFAULT_FILLER,
    ...collectCardsFromPlayerConfig(config.player1),
    ...collectCardsFromPlayerConfig(config.player2)
  ];
}

export function setupGame(config: SetupGameConfig): SetupGameResult {
  ensureCardsRegistered(collectCardsFromSetupConfig(config));
  nextCardId = 1000;

  const handler = new TestStoreHandler();
  const store = new Store(handler);
  handler.setStore(store);

  const state = new State();
  state.phase = GamePhase.PLAYER_TURN;
  state.turn = config.turn ?? 1;
  state.activePlayer = 0;

  const player1 = buildPlayer(0, config.player1);
  const player2 = buildPlayer(1, config.player2);

  state.players = [player1, player2];
  store.state = state;

  return {
    store,
    state,
    player1,
    player2,
    overridePrompt: (type: string, h: PromptHandler) => handler.overridePrompt(type, h),
    ambiguousChoices: () => handler.ambiguousChoices
  };
}

function buildPlayer(index: number, config: PlayerConfig): Player {
  const player = new Player();
  player.id = index + 1;

  // Initialize bench slots
  player.bench = [];
  for (let i = 0; i < 5; i++) {
    const bench = new PokemonCardList();
    bench.isPublic = true;
    player.bench.push(bench);
  }

  // Initialize prizes with filler energy cards
  const prizeCount = config.prizeCount ?? 6;
  player.prizes = [];
  for (let i = 0; i < prizeCount; i++) {
    const prizeList = new CardList();
    prizeList.isSecret = true;
    const filler = getCardByName(DEFAULT_FILLER);
    filler.id = nextCardId++;
    prizeList.cards.push(filler);
    player.prizes.push(prizeList);
  }

  // Set public zones (matching production setup-reducer.ts)
  player.active.isPublic = true;
  player.discard.isPublic = true;
  player.lostzone.isPublic = true;
  player.stadium.isPublic = true;
  player.supporter.isPublic = true;

  // Build active Pokemon
  buildPokemonSlot(player.active, config.active);

  // Build bench Pokemon
  if (config.bench) {
    for (let i = 0; i < config.bench.length && i < player.bench.length; i++) {
      buildPokemonSlot(player.bench[i], config.bench[i]);
    }
  }

  // Build hand
  if (config.hand) {
    for (const cardName of config.hand) {
      const card = getCardByName(cardName);
      card.id = nextCardId++;
      player.hand.cards.push(card);
    }
  }

  // Build deck
  if (config.deck) {
    for (const cardName of config.deck) {
      const card = getCardByName(cardName);
      card.id = nextCardId++;
      player.deck.cards.push(card);
    }
  }

  // Build discard
  if (config.discard) {
    for (const cardName of config.discard) {
      const card = getCardByName(cardName);
      card.id = nextCardId++;
      player.discard.cards.push(card);
    }
  }

  return player;
}

function buildPokemonSlot(slot: PokemonCardList, config: PokemonSlotConfig): void {
  const pokemon = getCardByName(config.card);
  pokemon.id = nextCardId++;
  slot.cards.push(pokemon);

  // Set HP from the PokemonCard
  if (pokemon instanceof PokemonCard) {
    slot.hp = pokemon.hp;
  }

  // Apply damage
  if (config.damage) {
    slot.damage = config.damage;
  }

  // Attach energy — placed in both .cards and .energies.cards
  if (config.energy) {
    for (const energyName of config.energy) {
      const energy = getCardByName(energyName);
      energy.id = nextCardId++;
      slot.cards.push(energy);
      if (energy instanceof EnergyCard) {
        slot.energies.cards.push(energy);
      }
    }
  }

  // Attach tools
  if (config.tools) {
    for (const toolName of config.tools) {
      const tool = getCardByName(toolName);
      tool.id = nextCardId++;
      // Tools live ONLY in `.tools`, never in `.cards` — matches the engine's real attach
      // (AttachPokemonToolEffect splices the tool out of `.cards`). Mirroring a tool into
      // `.cards` makes store.propagateEffect (which walks `.cards` AND `.tools`) reduce the
      // tool's effect twice (e.g. Muscle Band would add +40 instead of +20).
      slot.tools.push(tool);
    }
  }
}
