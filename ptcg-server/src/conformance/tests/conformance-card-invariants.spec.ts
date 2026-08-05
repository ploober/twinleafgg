import { CardManager } from '../../game/cards/card-manager';
import { loadAllSets } from '../../sets/tests/test-helpers';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Card } from '../../game/store/card/card';
import { Stage, SuperType } from '../../game/store/card/card-types';

/**
 * Structural invariants over the WHOLE card registry — a pure intra-engine guard, no reference data.
 *
 * Same idea as the conventions spec, aimed at FUNCTIONAL data. Twinleaf resolves evolution by
 * matching `evolvesFrom` against a card's `name`, which makes two silent failure modes possible:
 *
 *   1. UNEVOLVABLE — an evolved Pokémon with no `evolvesFrom`, or one naming a card that does not
 *      exist ('Shelder' when the card is 'Shellder'; 'Flabebe' when every Flabébé is accented), or
 *      one evolving from itself. Nothing can ever evolve into it.
 *
 *      NOT the same as "dead", and this spec used to say dead — corrected 2026-08-05 after driving
 *      it. A broken chain closes the EVOLUTION path only; direct-placement effects bypass evolution
 *      entirely and put such a card straight into play. Verified live: with Dark Blastoise (Stage 2,
 *      `evolvesFrom 'Dark Wartortle'`, which does not exist) in the discard, **Archie's Ace in the
 *      Hole** `prc-124` offered it and put it on the Bench. Its filter is
 *      `{superType: POKEMON, cardType: WATER}` with no stage term, and it ends in a raw
 *      `discard.moveCardsTo(cards, slot)` — no evolution check anywhere on that path.
 *
 *      Other stage-agnostic placements exist and would reach the same cards: **Cradily** and
 *      **Orbeetle** search the deck for a *Stage 2* explicitly; **Bombirdier**, **Reuniclus** and
 *      **Mega Delphox ex** place any Pokémon; **Kingdra ex** and **Vaporeon VMAX** mirror Archie's
 *      for Water. So a broken chain degrades a card to "needs an enabler", not "cannot be played".
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
 * Known-unfixable: the card evolves from a prevolution twinleaf does not implement. Not a data defect
 * — a missing card. Deliberately NOT fixed by inventing a card; listed here so the invariant stays
 * green while the gap stays visible.
 *
 * - "Team Aqua's Walrein" → "Team Aqua's Sealeo".
 * - "Dark Alakazam" → "Dark Kadabra", "Dark Blastoise" → "Dark Wartortle". Both arrived in the
 *   2026-08-05 upstream merge, which added the Team Rocket Stage 2s WITHOUT their Stage 1s; the two
 *   names appear nowhere in `src/sets` except as these `evolvesFrom` strings. Four printings are
 *   affected (base + `other-prints` reprints), and keying this set on `name` rather than `fullName`
 *   covers all four. Out of rotomancer's pool (Team Rocket, 1999), so the fix is deferred under the
 *   twinleaf fix-scope rule — and adding the missing cards is out of scope regardless.
 *
 * These cards are UNEVOLVABLE, not unplayable: a direct-placement effect still puts them into play
 * (see the header — driven on Dark Blastoise via Archie's Ace in the Hole). Both Dark Blastoise and
 * Team Aqua's Walrein are Water, so the Archie's / Kingdra ex / Vaporeon VMAX path reaches them
 * directly; Dark Alakazam is Psychic and needs a stage-agnostic searcher instead.
 */
const MISSING_PREVOLUTION = new Set([
  "Team Aqua's Walrein",
  'Dark Alakazam',
  'Dark Blastoise',
]);

describe('Card structural invariants — every evolution resolves; no card is mis-staged', () => {
  loadAllSets();
  const all = CardManager.getInstance().getAllCards();
  const pokemon = all.filter((c): c is PokemonCard => c instanceof PokemonCard);
  const names = new Set(all.map(c => c.name));

  it('every evolved Pokémon declares an evolvesFrom (else nothing can evolve into it)', () => {
    const bad = pokemon
      .filter(c => EVOLVED.has(c.stage) && !c.evolvesFrom)
      .map(c => `${c.fullName} (${c.stage}) has no evolvesFrom → UNEVOLVABLE`);
    expect(bad).toEqual([]);
  });

  it('every evolvesFrom resolves to a card that exists in the registry', () => {
    const bad = pokemon
      .filter(c => c.evolvesFrom && !names.has(c.evolvesFrom) && !MISSING_PREVOLUTION.has(c.name))
      .map(c => `${c.fullName} evolvesFrom '${c.evolvesFrom}' — NO SUCH CARD → UNEVOLVABLE`);
    expect(bad).toEqual([]);
  });

  it('no Pokémon evolves from itself (LV.X excepted — it legitimately evolves from its base)', () => {
    const bad = pokemon
      .filter(c => c.evolvesFrom && c.evolvesFrom === c.name && c.stage !== Stage.LV_X)
      .map(c => `${c.fullName} evolves from itself → UNEVOLVABLE`);
    expect(bad).toEqual([]);
  });

  it('no Basic declares an evolvesFrom (a mis-staged Stage 2 is ILLEGALLY benchable)', () => {
    const bad = pokemon
      .filter(c => c.stage === Stage.BASIC && !!c.evolvesFrom)
      .map(c => `${c.fullName} is Basic but evolvesFrom '${c.evolvesFrom}' → mis-staged, benchable ILLEGALLY`);
    expect(bad).toEqual([]);
  });

  // ── whole-CHAIN invariants ────────────────────────────────────────────────────────────────────
  //
  // Everything above checks ONE LINK. A card whose `evolvesFrom` resolves perfectly is still cut off
  // if its parent's own link is broken, and every per-link assertion stays green throughout — the
  // chain is unevolvable and nothing says so. Added 2026-08-05 after the upstream merge landed that
  // shape (Stage 2s with no Stage 1), and verified to add no new findings on the current registry:
  // of 4627 evolved Pokémon, the only unreachable chains are the already-waived ones, and there are
  // zero stage skips. These guard the NEXT such merge, not this one.

  const byName = new Map<string, Card[]>();
  for (const c of all) {
    (byName.get(c.name) ?? byName.set(c.name, []).get(c.name)!).push(c);
  }

  /** A chain terminates legally at a Basic, at a Restored, or at a TRAINER (fossils). */
  const isRoot = (c: Card): boolean =>
    c.superType !== SuperType.POKEMON
    || (c as PokemonCard).stage === Stage.BASIC
    || (c as PokemonCard).stage === Stage.RESTORED;

  /** BFS over same-named parents: ANY path to a legal root makes the chain playable. */
  const reachesRoot = (start: PokemonCard): boolean => {
    const seen = new Set<Card>();
    let frontier: Card[] = [start];
    for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
      const next: Card[] = [];
      for (const card of frontier) {
        if (card !== start && isRoot(card)) {
          return true;
        }
        if (seen.has(card)) {
          continue;   // also the cycle guard: a loop exhausts the frontier and reports unreachable
        }
        seen.add(card);
        const from = (card as PokemonCard).evolvesFrom;
        if (!from) {
          continue;
        }
        for (const parent of byName.get(from) ?? []) {
          // LV.X evolves from its SAME-NAMED base; never step to another LV.X of that name.
          if (parent === card) { continue; }
          if ((card as PokemonCard).stage === Stage.LV_X && (parent as PokemonCard).stage === Stage.LV_X) { continue; }
          next.push(parent);
        }
      }
      frontier = next;
    }
    return false;
  };

  it('every evolution chain reaches a Basic (a resolvable link can still sit on a broken parent)', () => {
    const bad = pokemon
      .filter(c => EVOLVED.has(c.stage) && !!c.evolvesFrom && !MISSING_PREVOLUTION.has(c.name))
      .filter(c => !reachesRoot(c))
      .map(c => `${c.fullName} (${Stage[c.stage]}) ← '${c.evolvesFrom}' — chain never reaches a Basic → UNEVOLVABLE`);
    expect(bad).toEqual([]);
  });

  // ── data conditions the ENGINE's evolution check silently depends on ──────────────────────────
  //
  // `playPokemonReducer`'s `isValidEvolution` has four clauses. Clause 1 is self-guarding
  // (`pokemonCard.stage < stage && pokemonCard.name === evolvesFrom`). Clauses 2, 3 and 4 —
  // `evolvesTo` / `evolvesToStage` / `evolvesFromBase` — carry NO stage check at all.
  //
  // The `isEvolved &&` that was presumably meant to be their backstop is INERT:
  // `const isEvolved = stage === Stage.STAGE_1 || Stage.STAGE_2` parses as
  // `(stage === Stage.STAGE_1) || Stage.STAGE_2`, and `Stage.STAGE_2` is 4 — truthy. So it is `true`
  // for STAGE_1 and the number `4` for all eleven other stages, never false. (That typo is
  // LOAD-BEARING and must not be "fixed": correcting it makes every clause false for stages above
  // STAGE_2, which removes evolution for LV_X, VMAX, VSTAR, MEGA and BREAK. Driven and reverted
  // 2026-08-05; see TA-206.)
  //
  // A Basic reaches those clauses: the Basic early-return in playPokemonReducer fires only when the
  // target slot is EMPTY, so a Basic played onto an OCCUPIED slot falls through to them.
  //
  // Which means the three conditions below are the only thing preventing a Basic from being played
  // onto an occupied Pokémon as a pseudo-evolution — skipping its entire line, the same class of
  // rules violation as the mis-staged-Basic case above. They hold today by card data, not by any
  // guard, so they are asserted here. This is a read-only assertion over the registry; it changes no
  // engine behaviour.

  it('no card declares evolvesToStage containing BASIC (clause 3 would admit a Basic)', () => {
    const bad = pokemon
      .filter(c => Array.isArray(c.evolvesToStage) && c.evolvesToStage.includes(Stage.BASIC))
      .map(c => `${c.fullName} declares evolvesToStage containing BASIC → any Basic could be played onto it`);
    expect(bad).toEqual([]);
  });

  /**
   * BABY POKÉMON. A first draft of the next spec asserted that no `evolvesTo` name may resolve to a
   * Basic — and it failed, correctly, on `Cleffa N1 → Clefairy` and `Pichu N1 → Pikachu`. That is the
   * WOTC-era baby mechanic: the baby is a Basic in play and its ordinary Basic is played on top of it.
   * Driven 2026-08-05 — Basic Pikachu `ju-060` onto Pichu `n1-012` succeeds, stack `[n1-012, ju-060]`.
   *
   * So a Basic in `evolvesTo` is LEGITIMATE for these, and the invariant is not "never" but "only
   * these". Listing them keeps the guard live for a new card that names a Basic by mistake.
   *
   * This is also a third thing the inert `isEvolved` is load-bearing for: correcting it would make
   * clause 2 false for an incoming BASIC and break baby evolution too.
   */
  const BABY_EVOLVES_TO_BASIC = new Set(['Pichu', 'Cleffa']);

  it('only baby Pokémon name a BASIC in evolvesTo (clause 2 admits a Basic by design there)', () => {
    // Clause 2 matches the INCOMING card by name, so if any printing of that name is a Basic, that
    // Basic can be played onto the declaring card — intended for babies, a stage-skip for anything else.
    const bad: string[] = [];
    for (const c of pokemon) {
      if (BABY_EVOLVES_TO_BASIC.has(c.name)) {
        continue;
      }
      for (const target of c.evolvesTo ?? []) {
        const basics = (byName.get(target) ?? [])
          .filter(p => p.superType === SuperType.POKEMON && (p as PokemonCard).stage === Stage.BASIC);
        if (basics.length > 0) {
          bad.push(`${c.fullName} evolvesTo '${target}', which has a BASIC printing (${basics[0].fullName})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('no evolvesFromBase array contains an empty string (clause 4 would admit a Basic)', () => {
    // A Basic's `evolvesFrom` is '', so an array containing '' matches every Basic.
    const bad = pokemon
      .filter(c => Array.isArray(c.evolvesFromBase) && c.evolvesFromBase.some(n => !n))
      .map(c => `${c.fullName} has an empty entry in evolvesFromBase → matches every Basic's evolvesFrom`);
    expect(bad).toEqual([]);
  });

  it('no evolution SKIPS a stage (a chain can reach a Basic and still be illegal)', () => {
    // VMAX/VSTAR evolve from a V and MEGA from a Pokémon-EX — all Basics, so those are legal.
    const LEGAL_PARENT: { [k: number]: Set<Stage> } = {
      [Stage.STAGE_1]: new Set([Stage.BASIC, Stage.RESTORED]),
      [Stage.STAGE_2]: new Set([Stage.STAGE_1]),
      [Stage.VMAX]: new Set([Stage.BASIC]),
      [Stage.VSTAR]: new Set([Stage.BASIC]),
      [Stage.MEGA]: new Set([Stage.BASIC]),
    };
    const bad: string[] = [];
    for (const c of pokemon) {
      const legal = LEGAL_PARENT[c.stage];
      if (!legal || !c.evolvesFrom) {
        continue;
      }
      const parents = (byName.get(c.evolvesFrom) ?? []).filter(p => p.superType === SuperType.POKEMON) as PokemonCard[];
      if (parents.length === 0) {
        continue;   // unresolvable, or a fossil whose parent is a Trainer — both covered above
      }
      if (!parents.some(p => legal.has(p.stage))) {
        const got = [...new Set(parents.map(p => Stage[p.stage]))].join('/');
        bad.push(`${c.fullName} (${Stage[c.stage]}) ← '${c.evolvesFrom}' is ${got} → STAGE SKIPPED`);
      }
    }
    expect(bad).toEqual([]);
  });
});
