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
        { type: 'expectMatchOngoing' },
      ],
    },
  },
  {
    // Tantrum confuses the attacker itself (IR target `self`); confusion persists through the
    // between-turns checkup, unlike sleep/burn which an ALL_HEADS recovery flip would clear.
    name: 'Conkeldurr TWM — Tantrum deals 80 and confuses itself',
    recipe: {
      meta: { printingId: 'sv6-105', source: 'rotomancer IR damage.deal + condition.apply(self)' },
      fixture: {
        activePrintingId: 'sv6-105',
        activeEnergies: ['FIGHTING'],
        opposingPrintingId: 'sv6-105',
      },
      items: [
        { type: 'attack', attackLabel: 'Tantrum' },
        { type: 'expectTheirActiveDamage', expectedDamage: 80 },
        { type: 'expectOurActiveCondition', condition: 'CONFUSED' },
      ],
    },
  },
  {
    name: 'Conkeldurr TWM — Gutsy Swing (250) knocks out a mirror (180 HP)',
    recipe: {
      meta: { printingId: 'sv6-105', source: 'rotomancer IR baseDamage' },
      fixture: {
        activePrintingId: 'sv6-105',
        activeEnergies: ['FIGHTING', 'WATER', 'WATER', 'WATER'],
        opposingPrintingId: 'sv6-105',
      },
      items: [
        { type: 'attack', attackLabel: 'Gutsy Swing' },
        { type: 'expectTheirActiveKnockedOut' },
      ],
    },
  },
];

describe('Rotomancer oracle replay — plain const-damage attacks (native Twinleaf)', () => {
  RECIPES.forEach(({ name, recipe }) => {
    it(name, () => runRecipe(recipe));
  });
});
