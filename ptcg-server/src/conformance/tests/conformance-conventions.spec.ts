import { CONVENTIONS } from '../conventions';
import { buildCapabilities, catalogCards } from '../capabilities';
import { projectCard } from '../card-projection';

/**
 * Conventions conformance — the engine must FOLLOW the conventions it DECLARES.
 *
 * We declare our representational choices on `GET /v1/capabilities` (OpenAPI `Conventions`): how
 * energy is written in card text, whether card names keep their diacritics, which glyph a multiplier
 * uses. Those are choices the rulebook does not make, so the harness must not hardcode one engine's
 * style and score another as wrong — it normalizes each engine with its OWN declaration instead.
 *
 * The catch, and the reason this spec exists: a convention is only a harmless implementation detail
 * if it is applied CONSISTENTLY. Applied inconsistently it is a DEFECT — and one that needs NO
 * reference data to find, because it is a pure intra-engine invariant. It therefore holds even for
 * cards no external source covers. (This is precisely how 11 dropped-diacritic card names —
 * `Pokemon Breeder`, `Poke Drawer +`, `Pokedex HANDY910is` — were caught: twinleaf preserves the
 * accent on 127 names and had silently dropped it on 11.)
 *
 * The declaration is INTENT; the corpus is EVIDENCE. If they disagree, that is a bug either way.
 * DO NOT make a failure here go away by weakening the declaration to match a buggy card — that
 * inverts the whole point. Fix the card, or change the convention deliberately and re-baseline every
 * card in the same commit.
 *
 * `tools/check_conventions.py` (pmtcg repo) runs the full check over the live API, including the
 * omission conventions that need canonical as a reference. This spec covers the pure intra-engine
 * invariants, so a violation fails the suite without any external data.
 */
describe('Conventions conformance — the engine follows what it declares', () => {
  const cards = catalogCards().map(projectCard);

  it('declares conventions on /v1/capabilities', () => {
    expect(buildCapabilities().conventions).toEqual(CONVENTIONS);
  });

  it(`writes energy in card text as ${CONVENTIONS.textEnergyNotation} everywhere`, () => {
    const CODES = new Set('GRWLPFDMYNC'.split(''));
    const WORDS = new Set(['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting',
      'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless']);
    // Bracketed tokens that are part of a card NAME, not energy (HL "Ancient Technical Machine [Ice]").
    const NAME_TOKENS = new Set(['Ice', 'Rock']);
    const bad: string[] = [];

    for (const c of cards) {
      const texts: Array<[string, string | null | undefined]> = [
        ...(c.attacks ?? []).map(a => [`attack "${a.name}"`, a.text] as [string, string | undefined]),
        ...(c.abilities ?? []).map(a => [`ability "${a.name}"`, a.text] as [string, string | undefined]),
        ['rules', c.text],
      ];
      for (const [where, text] of texts) {
        if (!text) { continue; }
        const re = /\[([A-Za-z]+)\]|\{([A-Za-z]+)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const tok = m[1] !== undefined ? m[1] : m[2];
          const isBrace = m[2] !== undefined;
          if (!isBrace && NAME_TOKENS.has(tok)) { continue; }
          let style: string | null = null;
          if (isBrace) { style = 'brace-code'; } else if (tok.length === 1 && CODES.has(tok)) { style = 'bracket-code'; } else if (WORDS.has(tok)) { style = 'bracket-spelled'; }
          if (style && style !== CONVENTIONS.textEnergyNotation) {
            bad.push(`${c.printing} ${where}: ${m[0]} is ${style}, declared ${CONVENTIONS.textEnergyNotation}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it(`uses '${CONVENTIONS.attackDamageMultiplier}' for every attack-damage multiplier`, () => {
    const other = CONVENTIONS.attackDamageMultiplier === 'x' ? '×' : 'x';
    const bad = cards.flatMap(c => (c.attacks ?? [])
      .filter(a => String(a.damage ?? '').includes(other))
      .map(a => `${c.printing} "${a.name}": ${a.damage}`));
    expect(bad).toEqual([]);
  });

  it(`uses '${CONVENTIONS.weaknessMultiplier}' for every weakness/resistance multiplier`, () => {
    const other = CONVENTIONS.weaknessMultiplier === '×' ? 'x' : '×';
    const bad = cards.flatMap(c => [...(c.weakness ?? []), ...(c.resistance ?? [])]
      .filter(w => new RegExp(`\\d\\s*${other === 'x' ? '[xX]' : '×'}`).test(String(w.value ?? '')))
      .map(w => `${c.printing} ${w.type}: ${w.value}`));
    expect(bad).toEqual([]);
  });

  it(`${CONVENTIONS.cardNameAccents}s diacritics in card names — no card drops one it should keep`, () => {
    // A name that SHOULD carry a diacritic but doesn't. Bare 'Pokemon'/'Poke'/'Pokedex' are the
    // lexemes that actually recur; the accented forms are the printed English names.
    const SHOULD_ACCENT: Array<[RegExp, string]> = [
      [/\bPokemon\b/, 'Pokémon'], [/\bPokedex\b/, 'Pokédex'], [/\bPoke\b/, 'Poké'],
    ];
    const bad = cards
      .filter(c => CONVENTIONS.cardNameAccents === 'preserve'
        && SHOULD_ACCENT.some(([re]) => re.test(c.name ?? '')))
      .map(c => `${c.printing} '${c.name}' drops a diacritic (declared preserve)`);
    expect(bad).toEqual([]);
  });
});
