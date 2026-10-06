import { buildCardsForSet } from '../cards';
import { getCardBySetAndNumber } from '../../sets/tests/test-helpers';

/**
 * TA-630: 12 in-pool Ascended Heroes printings were served with an older printing's regulation mark (inherited from the
 * class they extend) or with none. Printed marks from card-data/final/asc.json; each is set in the reprint's own class
 * (an override where it extends an older printing). A Pokémon ex with no mark also lost its Rule Box
 * (Card.hasRuleBox reads `POKEMON_ex && regulationMark`), so asc-073 Miraidon ex is checked for that too.
 */

const markOf = (printing: string): string | undefined => {
  const set = printing.split('-')[0];
  const card = buildCardsForSet(set).cards.find(c => c.printing === printing);
  return card === undefined ? undefined : (card as { regulationMark?: string }).regulationMark;
};

const PRINTED: [string, string][] = [
  ['asc-060', 'I'], ['asc-073', 'J'], ['asc-181', 'I'], ['asc-186', 'H'], ['asc-212', 'I'], ['asc-213', 'I'],
  ['asc-215', 'J'], ['asc-216', 'I'], ['asc-256', 'I'], ['asc-258', 'I'], ['asc-259', 'H'], ['asc-264', 'I'],
];

describe('TA-630: Ascended Heroes printings are served with their printed regulation mark', () => {
  for (const [printing, mark] of PRINTED) {
    it(`${printing} is ${mark} [TA-630]`, () => {
      expect(markOf(printing)).toBe(mark);
    });
  }

  it('asc-073 Miraidon ex has a Rule Box [TA-630]', () => {
    expect(getCardBySetAndNumber('asc', '73')?.hasRuleBox()).toBeTruthy();
  });

  it('control: the older printings extended keep their own marks (Ultra Ball svi-196 G, Boss\'s Orders pal-172 G) [TA-630]', () => {
    expect(markOf('svi-196')).toBe('G');
    expect(markOf('pal-172')).toBe('G');
  });
});
