/**
 * Twinleaf's DECLARED representational conventions (OpenAPI `Conventions`, served on
 * `GET /v1/capabilities`).
 *
 * These are the choices twinleaf makes where the RULEBOOK HAS NO TRUTH — how an energy type is
 * written inside card text, whether card names keep their diacritics, how a rarity suffix is spelled.
 * Two engines may legitimately differ here, so the harness must not hardcode one engine's style and
 * score the other as wrong. Declaring them lets the harness do two things:
 *
 *   1. NORMALIZE both engines to a neutral form (using each one's declaration) before diffing card
 *      data — replacing the old hardcoded "twinleaf writes [G]" assumption in the validator.
 *
 *   2. ENFORCE that twinleaf actually FOLLOWS each of these across ALL of its cards. This is the
 *      half that finds bugs: a convention is only a harmless implementation detail if it is applied
 *      CONSISTENTLY. Applied inconsistently, it is a defect — and one the harness can find with NO
 *      reference data at all, since it is a pure intra-engine invariant.
 *
 * The declaration below is INTENT; the card corpus is EVIDENCE. If they disagree that is a bug
 * either way — declaring `strip` while 118 cards preserve accents must fail just as loudly as a
 * single stray card does. Do not "fix" a failing check by weakening the declaration to match the
 * bug; fix the cards, or change the convention deliberately and re-baseline every card at once.
 *
 * Each value below was measured against the live card corpus, not guessed.
 */
export interface Conventions {
  /**
   * CF-87 / B.72 (contract 0.11.0, required): the board BETWEEN the picks of one open multi-pick
   * decision. Twinleaf answers a multi-select prompt one pick at a time through the decomposers while
   * the engine prompt stays open, and the prompt applies its result only when it resolves, so the board
   * stays the one the decision opened on until the last pick.
   */
  multiPickProjection: 'appliedPerPick' | 'deferredUntilComplete';
  /** How an energy type is written inside attack/ability/rules TEXT. */
  textEnergyNotation: 'bracket-code' | 'brace-code' | 'bracket-spelled' | 'word';
  /** Glyph for a damage multiplier in `attack.damage` (`30x` vs `30×`). */
  attackDamageMultiplier: 'x' | '×';
  /** Glyph for a weakness/resistance multiplier value (`×2`). */
  weaknessMultiplier: 'x' | '×';
  /** Do card names keep diacritics (`Pokémon Breeder`) or drop them (`Pokemon Breeder`)? */
  cardNameAccents: 'preserve' | 'strip';
  /** Gold-star rarity: `Alakazam Star` | `Alakazam ★` | omitted. */
  raritySuffix: 'word' | 'glyph' | 'omit';
  /** Delta Species: `Blastoise δ` | `Blastoise`. */
  deltaSpeciesSuffix: 'glyph' | 'omit';
  /** Prism Star: `Jirachi Prism Star` | `Jirachi ◇` | omitted. */
  prismStarSuffix: 'word' | 'glyph' | 'omit';
  /** LV.X: `Arceus LV.X` | `Arceus`. */
  levelUpSuffix: 'word' | 'omit';
  /** Reprinted-trainer subtitle: `Professor's Research (Professor Oak)` | `Professor's Research`. */
  trainerSubtitle: 'include' | 'omit';
  /** Basic energy naming: `Basic Grass Energy` | `Grass Energy`. */
  basicEnergyNamePrefix: 'include' | 'omit';
  /** Multi-type special energy: `Blend Energy GRPD` | `Blend Energy GrassFirePsychicDarkness`. */
  multiTypeEnergyNaming: 'abbreviate' | 'spell-out';
}

export const CONVENTIONS: Conventions = {
  // Measured (B.72, class-D re-drive 2026-09-30): Jet Cyclone, Strange Hacking, Fillet Memento and Solar
  // Transfer all show the pre-decision board until the last pick. The harness holds us to it.
  multiPickProjection: 'deferredUntilComplete',
  // Measured: 2655 `[G]`-style refs in card text, 0 `{G}`, 0 `[Grass]`, 0 bareword.
  textEnergyNotation: 'bracket-code',
  // Measured: 994 attacks use ASCII `x` (`30x`), 0 use `×`.
  attackDamageMultiplier: 'x',
  // Measured: 10337 weakness values use `×` (U+00D7), 0 use ASCII `x`.
  // NB: deliberately the OPPOSITE glyph from attack damage. Both are internally consistent, so this
  // is a convention, not a defect — but it only earns that status because it is declared + enforced.
  weaknessMultiplier: '×',
  // Measured: 118 card names preserve diacritics (Pokémon Center, Poké Ball, PokéNav).
  cardNameAccents: 'preserve',
  raritySuffix: 'word',
  deltaSpeciesSuffix: 'omit',
  prismStarSuffix: 'word',
  levelUpSuffix: 'omit',
  trainerSubtitle: 'omit',
  basicEnergyNamePrefix: 'omit',
  multiTypeEnergyNaming: 'abbreviate',
};
