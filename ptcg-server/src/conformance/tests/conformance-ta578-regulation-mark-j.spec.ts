import { buildCardsForSet } from '../cards';

/**
 * TA-578: 46 in-pool printings (41 in Ascended Heroes, 5 Mega Evolution promos) are printed with regulation mark J
 * (card-data/final asc.json / mep.json) but were served with mark I. The reprints in other-prints.ts (asc-218 / 232 /
 * 249 / 253 / 272-274 / 294) and the promos mep-030 / 034 / 035 / 036 inherit the mark from their asc base class, so
 * the base file carries it. Controls: printings whose printed mark is I stay I; Tyrunt mep-070 was already J.
 */

const markOf = (printing: string): string | undefined => {
  const set = printing.split('-')[0];
  const card = buildCardsForSet(set).cards.find(c => c.printing === printing);
  return card === undefined ? undefined : (card as { regulationMark?: string }).regulationMark;
};

describe('TA-578: printings with printed regulation mark J are served J', () => {
  for (const printing of ['asc-001', 'asc-042', 'asc-175', 'asc-218', 'asc-294', 'mep-030', 'mep-036', 'mep-086']) {
    it(`${printing} is J [TA-578]`, () => {
      expect(markOf(printing)).toBe('J');
    });
  }

  for (const printing of ['asc-011', 'asc-015']) {
    it(`control: ${printing} (printed I) stays I [TA-578]`, () => {
      expect(markOf(printing)).toBe('I');
    });
  }

  it('control: Tyrunt mep-070 stays J [TA-578]', () => {
    expect(markOf('mep-070')).toBe('J');
  });
});
