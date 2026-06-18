import { setupGame, padDeck, SetupGameConfig, PokemonSlotConfig, PlayerConfig, SetupGameResult } from '../test-helpers';
import {
  useAttack, useAbility, playCardFromHand, retreat, endTurn,
  getDamage, getEnergyCount, getZoneCount, getBenchSize,
  hasSpecialCondition, hasActivePokemon, getWinner,
} from '../card-test-helpers';
import { SpecialCondition } from '../../../game/store/card/card-types';
import { GameWinner } from '../../../game/store/state/state';
import { PlayerType, SlotType, CardTarget } from '../../../game/store/actions/play-card-action';
import { resolvePrintingId, energyToCard } from './bridge';

/**
 * Rotomancer-recipe runner. Translates a ScenarioSpec (fixture + items) into a Twinleaf
 * `setupGame` state, replays the steps as native engine actions, and checks the
 * expectations. player 0 = "us" (the card under test), player 1 = "them". Unsupported
 * item kinds throw (no silent skips) so coverage gaps stay visible.
 */

export interface RecipeBenchSlot {
  printingId: string;
  name?: string;
  energies?: string[];
  damage?: number;
}

export interface RecipeFixture {
  activePrintingId: string;
  activeName?: string;
  activeEnergies?: string[];
  activeDamage?: number;
  activeBench?: RecipeBenchSlot[];
  activeHand?: string[];

  opposingPrintingId: string;
  opposingName?: string;
  opposingEnergies?: string[];
  opposingDamage?: number;
  opposingBench?: RecipeBenchSlot[];
  opposingHand?: string[];
}

export interface RecipeItem {
  type: string;
  [key: string]: any;
}

export interface Recipe {
  meta?: Record<string, any>;
  fixture: RecipeFixture;
  items: RecipeItem[];
}

interface Ctx {
  game: SetupGameResult;
  lastAccepted: boolean;
}

const CONDITIONS: Record<string, SpecialCondition> = {
  POISONED: SpecialCondition.POISONED,
  BURNED: SpecialCondition.BURNED,
  ASLEEP: SpecialCondition.ASLEEP,
  PARALYZED: SpecialCondition.PARALYZED,
  CONFUSED: SpecialCondition.CONFUSED,
};

function toCondition(name: string): SpecialCondition {
  const c = CONDITIONS[String(name).toUpperCase()];
  if (c === undefined) {
    throw new Error(`[recipe-runner] Unknown special condition "${name}"`);
  }
  return c;
}

// Rotomancer targetSlot: -1 = active, n >= 0 = bench index. Targets are own-side (acting player).
function toTarget(targetSlot: number | undefined): CardTarget {
  const slot = targetSlot ?? -1;
  return slot < 0
    ? { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
    : { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: slot };
}

// ── fixture → setupGame ──

function toSlot(printingId: string, name: string | undefined, energies?: string[], damage?: number): PokemonSlotConfig {
  return {
    card: resolvePrintingId(printingId, name).fullName,
    energy: (energies ?? []).map(energyToCard),
    damage,
  };
}

function toPlayer(active: PokemonSlotConfig, bench?: RecipeBenchSlot[], hand?: string[]): PlayerConfig {
  return {
    active,
    bench: (bench ?? []).map(b => toSlot(b.printingId, b.name, b.energies, b.damage)),
    hand: (hand ?? []).map(h => resolvePrintingId(h).fullName),
    deck: padDeck(10),
  };
}

function buildConfig(f: RecipeFixture): SetupGameConfig {
  return {
    turn: 2,
    player1: toPlayer(toSlot(f.activePrintingId, f.activeName, f.activeEnergies, f.activeDamage), f.activeBench, f.activeHand),
    player2: toPlayer(toSlot(f.opposingPrintingId, f.opposingName, f.opposingEnergies, f.opposingDamage), f.opposingBench, f.opposingHand),
  };
}

// ── steps ──

function runStep(ctx: Ctx, item: RecipeItem): void {
  const { store, state } = ctx.game;
  const us = item.type.startsWith('opposing') ? 1 : 0;
  const base = item.type.replace(/^opposing/, '').replace(/^attempt/, '').replace(/^Attempt/, '');

  switch (base.charAt(0).toLowerCase() + base.slice(1)) {
    case 'attack':
      useAttack(store, state, us, item.attackLabel);
      return;
    case 'useAbility':
    case 'useAbilityFromBench':
      useAbility(store, state, us, item.abilityLabel);
      return;
    case 'playItem':
    case 'playSupporter':
    case 'playStadium':
      playCardFromHand(store, state, us, resolvePrintingId(item.printingId).fullName);
      return;
    case 'attachEnergyFromHand':
      playCardFromHand(store, state, us, resolvePrintingId(item.printingId).fullName, toTarget(item.targetSlot));
      return;
    case 'evolve':
    case 'benchBasic':
      playCardFromHand(store, state, us, resolvePrintingId(item.printingId ?? item.evoPid).fullName, toTarget(item.targetSlot));
      return;
    case 'retreat':
      retreat(store, state, us, item.newActiveSlot ?? 0);
      return;
    case 'endActiveTurn':
      endTurn(store, state);
      return;
    default:
      throw new Error(`[recipe-runner] Unsupported step "${item.type}"`);
  }
}

// ── expectations ──

function runExpectation(ctx: Ctx, item: RecipeItem): void {
  const { state } = ctx.game;
  switch (item.type) {
    case 'expectOurActiveDamage': expect(getDamage(state, 0, 'active')).toBe(item.expectedDamage); return;
    case 'expectTheirActiveDamage': expect(getDamage(state, 1, 'active')).toBe(item.expectedDamage); return;
    case 'expectOurBenchSlotDamage': expect(getDamage(state, 0, item.slotIdx)).toBe(item.expectedDamage); return;
    case 'expectTheirBenchSlotDamage': expect(getDamage(state, 1, item.slotIdx)).toBe(item.expectedDamage); return;

    case 'expectOurActiveCondition': expect(hasSpecialCondition(state, 0, 'active', toCondition(item.condition))).toBe(true); return;
    case 'expectTheirActiveCondition': expect(hasSpecialCondition(state, 1, 'active', toCondition(item.condition))).toBe(true); return;
    case 'expectOurActiveNoCondition': expect(hasSpecialCondition(state, 0, 'active', toCondition(item.condition))).toBe(false); return;
    case 'expectTheirActiveNoCondition': expect(hasSpecialCondition(state, 1, 'active', toCondition(item.condition))).toBe(false); return;

    case 'expectOurActiveKnockedOut': expect(hasActivePokemon(state, 0)).toBe(false); return;
    case 'expectTheirActiveKnockedOut': expect(hasActivePokemon(state, 1)).toBe(false); return;

    case 'expectOurBenchSize': expect(getBenchSize(state, 0)).toBe(item.expectedSize); return;
    case 'expectTheirBenchSize': expect(getBenchSize(state, 1)).toBe(item.expectedSize); return;
    case 'expectOurHandSize': expect(getZoneCount(state, 0, 'hand')).toBe(item.expectedSize); return;
    case 'expectTheirHandSize': expect(getZoneCount(state, 1, 'hand')).toBe(item.expectedSize); return;
    case 'expectOurDeckSize': expect(getZoneCount(state, 0, 'deck')).toBe(item.expectedSize); return;
    case 'expectTheirDeckSize': expect(getZoneCount(state, 1, 'deck')).toBe(item.expectedSize); return;
    case 'expectOurDiscardSize': expect(getZoneCount(state, 0, 'discard')).toBe(item.expectedSize); return;
    case 'expectTheirDiscardSize': expect(getZoneCount(state, 1, 'discard')).toBe(item.expectedSize); return;

    case 'expectOurActiveEnergyCount': expect(getEnergyCount(state, 0, 'active')).toBe(item.expectedCount); return;
    case 'expectTheirActiveEnergyCount': expect(getEnergyCount(state, 1, 'active')).toBe(item.expectedCount); return;

    case 'expectMatchOngoing': expect(getWinner(state)).toBe(GameWinner.NONE); return;
    case 'expectMatchEndedInDraw': expect(getWinner(state)).toBe(GameWinner.DRAW); return;
    case 'expectMatchEndedWithWinner':
      expect(getWinner(state)).toBe(item.winner === 'them' ? GameWinner.PLAYER_2 : GameWinner.PLAYER_1);
      return;
    default:
      if (/^expectLast.*(Accepted|Refused)$/.test(item.type)) {
        expect(ctx.lastAccepted).toBe(item.type.endsWith('Accepted'));
        return;
      }
      throw new Error(`[recipe-runner] Unsupported expectation "${item.type}"`);
  }
}

function isExpectation(type: string): boolean {
  return type.startsWith('expect');
}

function isAttemptable(type: string): boolean {
  return /attempt/i.test(type);
}

function runItem(ctx: Ctx, item: RecipeItem): void {
  if (isExpectation(item.type)) {
    runExpectation(ctx, item);
    return;
  }
  // A step. Attempt* steps may legally fail; record the outcome instead of throwing.
  if (isAttemptable(item.type)) {
    try {
      runStep(ctx, item);
      ctx.lastAccepted = true;
    } catch {
      ctx.lastAccepted = false;
    }
    return;
  }
  runStep(ctx, item);
  ctx.lastAccepted = true;
}

export function runRecipe(recipe: Recipe): void {
  const ctx: Ctx = { game: setupGame(buildConfig(recipe.fixture)), lastAccepted: false };
  for (const item of recipe.items) {
    runItem(ctx, item);
  }
}
