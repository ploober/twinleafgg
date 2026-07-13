import { CardManager } from '../../game/cards/card-manager';
import { loadAllSets } from '../../sets/tests/test-helpers';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage } from '../../game/store/card/card-types';

/**
 * Structural invariants over the WHOLE card registry — a pure intra-engine guard, no reference data.
 *
 * Same idea as the conventions spec, aimed at FUNCTIONAL data. Twinleaf resolves evolution by
 * matching `evolvesFrom` against a card's `name`, which makes two silent failure modes possible:
 *
 *   1. UNPLAYABLE — an evolved Pokémon with no `evolvesFrom`, or one naming a card that does not
 *      exist ('Shelder' when the card is 'Shellder'; 'Flabebe' when every Flabébé is accented), or
 *      one evolving from itself. Nothing can ever evolve into it, so the card is dead.
 *   2. ILLEGAL — a Stage 2 tagged `Basic`. `benchBasic` is gated on `stage === Stage.BASIC`
 *      (play-pokemon-effect.ts), so such a card can be dropped straight onto the bench, SKIPPING its
 *      entire evolution line. That is a rules violation, not merely a dead card.
 *
 * This found 27 broken cards. The differential could never have: 24 of them are in sets rotomancer
 * does not implement, so they had NO cross-engine coverage at all. An invariant is the only thing
 * that can see those.
 *
 * IMPORTANT: resolve names against the FULL registry, not `/v1/cards` — the API omits
 * EXCLUDED_RANDOM_CARDS (e.g. "Team Rocket's Meowth"), and a card that is merely excluded from
 * conformance still exists in the game. Using the filtered catalog produces false "unresolvable" hits.
 *
 * Real mechanics the invariants must respect (each tripped a naive first pass):
 *   - LEVEL-UP (LV.X) legitimately evolves from its SAME-NAMED base. The names collide only because
 *     of our own `levelUpSuffix: omit` convention — a convention creating a genuine ambiguity.
 *   - Fossil Pokémon evolve from a TRAINER ("Unidentified Fossil"), not a Basic.
 *   - "Restored" is a real stage and a legal Stage-1 source.
 */

// Stages that MUST declare what they evolve from.
const EVOLVED = new Set([Stage.STAGE_1, Stage.STAGE_2, Stage.VMAX, Stage.VSTAR, Stage.MEGA, Stage.BREAK]);

/**
 * Known-unfixable: "Team Aqua's Walrein" evolves from "Team Aqua's Sealeo", which twinleaf does not
 * implement. Not a data defect — a missing card. Deliberately NOT fixed by inventing a card; listed
 * here so the invariant stays green while the gap stays visible.
 */
const MISSING_PREVOLUTION = new Set(["Team Aqua's Walrein"]);

describe('Card structural invariants — every evolution resolves; no card is mis-staged', () => {
  loadAllSets();
  const all = CardManager.getInstance().getAllCards();
  const pokemon = all.filter((c): c is PokemonCard => c instanceof PokemonCard);
  const names = new Set(all.map(c => c.name));

  it('every evolved Pokémon declares an evolvesFrom (else nothing can evolve into it)', () => {
    const bad = pokemon
      .filter(c => EVOLVED.has(c.stage) && !c.evolvesFrom)
      .map(c => `${c.fullName} (${c.stage}) has no evolvesFrom → UNPLAYABLE`);
    expect(bad).toEqual([]);
  });

  it('every evolvesFrom resolves to a card that exists in the registry', () => {
    const bad = pokemon
      .filter(c => c.evolvesFrom && !names.has(c.evolvesFrom) && !MISSING_PREVOLUTION.has(c.name))
      .map(c => `${c.fullName} evolvesFrom '${c.evolvesFrom}' — NO SUCH CARD → UNPLAYABLE`);
    expect(bad).toEqual([]);
  });

  it('no Pokémon evolves from itself (LV.X excepted — it legitimately evolves from its base)', () => {
    const bad = pokemon
      .filter(c => c.evolvesFrom && c.evolvesFrom === c.name && c.stage !== Stage.LV_X)
      .map(c => `${c.fullName} evolves from itself → UNPLAYABLE`);
    expect(bad).toEqual([]);
  });

  it('no Basic declares an evolvesFrom (a mis-staged Stage 2 is ILLEGALLY benchable)', () => {
    const bad = pokemon
      .filter(c => c.stage === Stage.BASIC && !!c.evolvesFrom)
      .map(c => `${c.fullName} is Basic but evolvesFrom '${c.evolvesFrom}' → mis-staged, benchable ILLEGALLY`);
    expect(bad).toEqual([]);
  });
});
