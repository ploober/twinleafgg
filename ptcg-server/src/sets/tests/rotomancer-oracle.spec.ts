import { Recipe } from './rotomancer/recipe-runner';
import { runRecipe } from './rotomancer/recipe-runner';

/**
 * Spike: replay Rotomancer scenarios against Twinleaf's NATIVE card implementations.
 *
 * Each recipe is a mirror match (attacker species == defender species) on an exact-printing
 * card shared by both projects, so weakness/resistance never triggers and the printed attack
 * damage from Rotomancer's IR is the expected post-state damage. Agreement means the two
 * independently-written engines compute the same result for that card.
 */
const RECIPES: Array<{ name: string; recipe: Recipe }> = [
  {
    name: 'Koraidon SSP — Hammer In deals 110',
    recipe: {
      meta: { printingId: 'sv8-116', source: 'rotomancer IR baseDamage' },
      fixture: {
        activePrintingId: 'sv8-116',
        activeEnergies: ['FIGHTING', 'FIGHTING', 'COLORLESS'],
        opposingPrintingId: 'sv8-116',
      },
      items: [
        { type: 'attack', attackLabel: 'Hammer In' },
        { type: 'expectTheirActiveDamage', expectedDamage: 110 },
      ],
    },
  },
  {
    name: 'Dedenne SSP — Gnaw deals 30',
    recipe: {
      meta: { printingId: 'sv8-87', source: 'rotomancer IR baseDamage' },
      fixture: {
        activePrintingId: 'sv8-87',
        activeEnergies: ['PSYCHIC'],
        opposingPrintingId: 'sv8-87',
      },
      items: [
        { type: 'attack', attackLabel: 'Gnaw' },
        { type: 'expectTheirActiveDamage', expectedDamage: 30 },
      ],
    },
  },
  {
    name: 'Dartrix SFA — Cutting Wind deals 30',
    recipe: {
      meta: { printingId: 'sv6pt5-4', source: 'rotomancer IR baseDamage' },
      fixture: {
        activePrintingId: 'sv6pt5-4',
        activeEnergies: ['GRASS'],
        opposingPrintingId: 'sv6pt5-4',
      },
      items: [
        { type: 'attack', attackLabel: 'Cutting Wind' },
        { type: 'expectTheirActiveDamage', expectedDamage: 30 },
      ],
    },
  },
];

describe('Rotomancer oracle replay — plain const-damage attacks (native Twinleaf)', () => {
  RECIPES.forEach(({ name, recipe }) => {
    it(name, () => runRecipe(recipe));
  });
});
