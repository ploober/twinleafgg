import { setupGame, padDeck, SetupGameConfig, PokemonSlotConfig, PlayerConfig, SetupGameResult } from '../test-helpers';
import { useAttack, getDamage } from '../card-test-helpers';
import { resolvePrintingId, energyToCard } from './bridge';

/**
 * Minimal Rotomancer-recipe runner — a spike. It translates a Rotomancer ScenarioSpec
 * (fixture + items) into a Twinleaf `setupGame` state, replays the steps as native engine
 * actions, and checks the expectations against the resulting state. Only the subset of
 * step/expectation kinds needed for plain const-damage attacks is implemented; any other
 * kind throws (no silent skips) so coverage gaps are visible.
 */

export interface RecipeBenchSlot {
  printingId: string;
  energies?: string[];
  damage?: number;
}

export interface RecipeFixture {
  activePrintingId: string;
  activeEnergies?: string[];
  activeDamage?: number;
  activeBench?: RecipeBenchSlot[];

  opposingPrintingId: string;
  opposingEnergies?: string[];
  opposingDamage?: number;
  opposingBench?: RecipeBenchSlot[];
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

function toSlot(printingId: string, energies?: string[], damage?: number): PokemonSlotConfig {
  return {
    card: resolvePrintingId(printingId).fullName,
    energy: (energies ?? []).map(energyToCard),
    damage,
  };
}

function toPlayer(active: PokemonSlotConfig, bench?: RecipeBenchSlot[]): PlayerConfig {
  return {
    active,
    bench: (bench ?? []).map(b => toSlot(b.printingId, b.energies, b.damage)),
    deck: padDeck(10),
  };
}

function buildConfig(fixture: RecipeFixture): SetupGameConfig {
  return {
    turn: 2,
    player1: toPlayer(
      toSlot(fixture.activePrintingId, fixture.activeEnergies, fixture.activeDamage),
      fixture.activeBench
    ),
    player2: toPlayer(
      toSlot(fixture.opposingPrintingId, fixture.opposingEnergies, fixture.opposingDamage),
      fixture.opposingBench
    ),
  };
}

// "us" = player 0 (card under test), "them" = player 1.
function runItem(game: SetupGameResult, item: RecipeItem): void {
  switch (item.type) {
    case 'attack':
      useAttack(game.store, game.state, 0, item.attackLabel);
      return;
    case 'expectTheirActiveDamage':
      expect(getDamage(game.state, 1, 'active')).toBe(item.expectedDamage);
      return;
    case 'expectOurActiveDamage':
      expect(getDamage(game.state, 0, 'active')).toBe(item.expectedDamage);
      return;
    default:
      throw new Error(`[recipe-runner] Unsupported item type "${item.type}"`);
  }
}

export function runRecipe(recipe: Recipe): void {
  const game = setupGame(buildConfig(recipe.fixture));
  for (const item of recipe.items) {
    runItem(game, item);
  }
}
