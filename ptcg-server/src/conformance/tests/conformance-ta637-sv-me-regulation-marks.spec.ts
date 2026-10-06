import { buildCardsForSet } from '../cards';
import { getCardBySetAndNumber } from '../../sets/tests/test-helpers';

/**
 * TA-637: 49 Scarlet & Violet / Mega Evolution printings (outside asc, which was TA-630) were served with an older
 * printing's regulation mark (inherited from the class they extend), a wrong mark, or none. Printed marks from
 * card-data/final/<set>.json (each corroborated by the four normalized sources); each is set in the printing's own
 * class. A Pokémon ex with no mark has no Rule Box (Card.hasRuleBox reads `POKEMON_ex && regulationMark`), so
 * ssp-048 Black Kyurem ex is checked for that too.
 *
 * Not here: the basic Energy obf-230 / sfa-098 / sfa-099, served 'ENERGY' (the sentinel every twinleaf basic Energy
 * class carries; the deck validator returns legal for basic Energy before it reads the mark). Reported, not changed.
 */

const markOf = (printing: string): string | undefined => {
  const set = printing.split('-')[0];
  const card = buildCardsForSet(set).cards.find(c => c.printing === printing);
  return card === undefined ? undefined : (card as { regulationMark?: string }).regulationMark;
};

const marksOf = (printings: [string, string][]): [string, string | undefined][] =>
  printings.map(([p]) => [p, markOf(p)]);

describe('TA-637: SV / ME printings are served with their printed regulation mark', () => {
  it('blk-072 Tranquill is I [TA-637]', () => {
    expect(markOf('blk-072')).toBe('I');
  });

  it('cri-074 I, cri-075 J, cri-080 J, cri-108 I, cri-111 J, cri-115 I [TA-637]', () => {
    const want: [string, string][] = [['cri-074', 'I'], ['cri-075', 'J'], ['cri-080', 'J'], ['cri-108', 'I'], ['cri-111', 'J'], ['cri-115', 'I']];
    expect(marksOf(want)).toEqual(want);
  });

  it('dri-163 / dri-220 Emcee\'s Hype are I [TA-637]', () => {
    const want: [string, string][] = [['dri-163', 'I'], ['dri-220', 'I']];
    expect(marksOf(want)).toEqual(want);
  });

  it('jtg-006 H, jtg-088 H, jtg-121 I, jtg-178 I [TA-637]', () => {
    const want: [string, string][] = [['jtg-006', 'H'], ['jtg-088', 'H'], ['jtg-121', 'I'], ['jtg-178', 'I']];
    expect(marksOf(want)).toEqual(want);
  });

  it('mew-021 / 022 / 063 / 087 / 106 / 113 / 119 / 164 are G [TA-637]', () => {
    const want: [string, string][] = [['mew-021', 'G'], ['mew-022', 'G'], ['mew-063', 'G'], ['mew-087', 'G'], ['mew-106', 'G'],
      ['mew-113', 'G'], ['mew-119', 'G'], ['mew-164', 'G']];
    expect(marksOf(want)).toEqual(want);
  });

  it('obf-013 / 014 / 015 / 071 / 191 are G [TA-637]', () => {
    const want: [string, string][] = [['obf-013', 'G'], ['obf-014', 'G'], ['obf-015', 'G'], ['obf-071', 'G'], ['obf-191', 'G']];
    expect(marksOf(want)).toEqual(want);
  });

  it('paf-056 Haunter is G [TA-637]', () => {
    expect(markOf('paf-056')).toBe('G');
  });

  it('par-024 / 054 / 137 / 138 are G [TA-637]', () => {
    const want: [string, string][] = [['par-024', 'G'], ['par-054', 'G'], ['par-137', 'G'], ['par-138', 'G']];
    expect(marksOf(want)).toEqual(want);
  });

  it('pbl-079 Jett / pbl-105 Crushing Hammer are J [TA-637]', () => {
    const want: [string, string][] = [['pbl-079', 'J'], ['pbl-105', 'J']];
    expect(marksOf(want)).toEqual(want);
  });

  it('pfl-123 Switch is I [TA-637]', () => {
    expect(markOf('pfl-123')).toBe('I');
  });

  it('por-074 Hole-Digging Shovel / por-108 Energy Recycler are I [TA-637]', () => {
    const want: [string, string][] = [['por-074', 'I'], ['por-108', 'I']];
    expect(marksOf(want)).toEqual(want);
  });

  it('scr-046 Electabuzz is H [TA-637]', () => {
    expect(markOf('scr-046')).toBe('H');
  });

  it('ssp-001 / 003 / 048 / 062 / 065 are H [TA-637]', () => {
    const want: [string, string][] = [['ssp-001', 'H'], ['ssp-003', 'H'], ['ssp-048', 'H'], ['ssp-062', 'H'], ['ssp-065', 'H']];
    expect(marksOf(want)).toEqual(want);
  });

  it('svi-132 / 133 / 134 / 152 are G [TA-637]', () => {
    const want: [string, string][] = [['svi-132', 'G'], ['svi-133', 'G'], ['svi-134', 'G'], ['svi-152', 'G']];
    expect(marksOf(want)).toEqual(want);
  });

  it('svp-119 Toxel is G [TA-637]', () => {
    expect(markOf('svp-119')).toBe('G');
  });

  it('wht-041 Gothita / wht-055 Purrloin are I [TA-637]', () => {
    const want: [string, string][] = [['wht-041', 'I'], ['wht-055', 'I']];
    expect(marksOf(want)).toEqual(want);
  });

  it('ssp-048 Black Kyurem ex has a Rule Box [TA-637]', () => {
    expect(getCardBySetAndNumber('ssp', '48')?.hasRuleBox()).toBeTruthy();
  });

  it('control: the older printings extended keep their own marks (Crushing Hammer svi-168 G, Switch svi-194 G, Energy Retrieval svi-171 G) [TA-637]', () => {
    expect(markOf('svi-168')).toBe('G');
    expect(markOf('svi-194')).toBe('G');
    expect(markOf('svi-171')).toBe('G');
  });

  it('control: basic Energy keep the ENERGY sentinel (sve-002, obf-230) [TA-637]', () => {
    expect(markOf('sve-002')).toBe('ENERGY');
    expect(markOf('obf-230')).toBe('ENERGY');
  });
});
