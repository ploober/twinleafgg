import { atOnceSpec, isAtOnce, atOnceWireSpec } from '../at-once';
import { CardManager } from '../../game/cards/card-manager';
import { loadAllSets } from '../../sets/tests/test-helpers';

/**
 * CF-55 — the at-once spec is DERIVED FROM PRINTED TEXT, so the derivation is pinned against every
 * printing in the card DB that carries the clause, not against a fixture I wrote.
 *
 * The two published values come from the contract itself: Puzzle of Time is [1, 2] and Missing
 * Clover is [1, 4]. A derivation that produced [1,2,3,4] for Missing Clover would be wrong in a way
 * no "does it parse" test could see — nothing legal sits between 1 and 4.
 */
describe('Conformance — CF-55 at-once derivation', () => {
  loadAllSets();
  const cm = CardManager.getInstance();
  const byFullName = (set: string, num: string) =>
    cm.getAllCards().find(c => c.set === set && c.setNumber === num);

  const EXPECTED: Array<[string, string, string, number[], boolean]> = [
    // set, number, name,                 counts,  mandatory
    ['CRI', '83',  'Transformation Tome', [2],     true],
    ['FST', '231', 'Crossceiver',         [2],     true],
    ['FST', '230', 'Cross Switcher',      [2],     true],
    ['LOT', '184', 'Mixed Herbs',         [1, 2],  false],
    ['LOT', '171', 'Custom Catcher',      [1, 2],  false],
    ['BKP', '109', 'Puzzle of Time',      [1, 2],  false],
    ['UPR', '129', 'Missing Clover',      [1, 4],  false],
    ['SIT', '163', 'Quad Stone',          [1, 4],  false],
    // ⚠️ SECOND PRINTINGS, found by the population cell below rather than by me. My first pass
    // scanned card FILES and found 8; the registry holds 10, because a reprint is a SUBCLASS that
    // inherits the printed text. That is not a bookkeeping detail: an at-once clause matches by card
    // NAME, so a hand holding Custom Catcher LOT-171 *and* LOT-231 holds TWO Custom Catchers and may
    // play them together. `candidates` is therefore keyed on NAME, never on printing.
    ['LOT', '231', 'Custom Catcher (2nd printing)', [1, 2], false],
    ['UPR', '168', 'Missing Clover (2nd printing)', [1, 4], false],
  ];

  for (const [set, num, name, counts, mandatory] of EXPECTED) {
    it(`${name} (${set}-${num}) derives counts ${JSON.stringify(counts)}`, () => {
      const card = byFullName(set, num);
      expect(card).toBeDefined();
      const spec = atOnceSpec(card!);
      expect(spec).not.toBeNull();
      expect(spec!.counts).toEqual(counts);
      expect(spec!.mandatory).toBe(mandatory);
      expect(spec!.max).toBe(counts[counts.length - 1]);
    });
  }

  it('finds EXACTLY these printings across the whole card DB — no more, no fewer', () => {
    // The population matters as much as the parse. A regex that also matched, say, "put them back
    // in any order at once" would hand a template to a card that has no at-once rule and make every
    // ordinary play of it invalid. A regex that missed one leaves that card back-dooring the count
    // gate through the singular `card` field.
    const hits = cm.getAllCards().filter(isAtOnce).map(c => `${c.set}-${c.setNumber}`).sort();
    const want = EXPECTED.map(([s, n]) => `${s}-${n}`).sort();
    expect(hits).toEqual(want);
  });

  it('the WIRE spec covers the mandatory family and excludes the optional one', () => {
    // atOnceSpec = what the TEXT says. atOnceWireSpec = what this adapter can HONOUR. The gap is
    // TA-278: for "may play 1 or N" printings twinleaf raises a SelectOptionPrompt after the play
    // and ignores the `cards` length entirely, so a `counts` template would advertise a gate that
    // does not exist. Both the menu and the dispatcher read the wire spec, never the text spec, so
    // the offer and the gate cannot drift apart.
    const wire: string[] = [];
    const textOnly: string[] = [];
    for (const c of cm.getAllCards().filter(isAtOnce)) {
      (atOnceWireSpec(c) !== null ? wire : textOnly).push(`${c.set}-${c.setNumber}`);
    }
    expect(wire.sort()).toEqual(['CRI-83', 'FST-230', 'FST-231']);
    expect(textOnly.sort()).toEqual(
      ['BKP-109', 'LOT-171', 'LOT-184', 'LOT-231', 'SIT-163', 'UPR-129', 'UPR-168']);
  });

  it('every wire-spec printing has exactly ONE legal count', () => {
    // The property that makes the mandatory family safe: one branch, so the count cannot be
    // re-asked. If a multi-count printing ever enters the wire spec, TA-278 has been fixed or the
    // narrowing has been broken — either way this cell should be revisited, not deleted.
    for (const c of cm.getAllCards()) {
      const w = atOnceWireSpec(c);
      if (w !== null) { expect(w.counts.length).toBe(1); }
    }
  });

  it('an ordinary Trainer derives no spec', () => {
    const potion = cm.getAllCards().find(c => c.name === 'Potion');
    expect(potion).toBeDefined();
    expect(atOnceSpec(potion!)).toBeNull();
  });
});
