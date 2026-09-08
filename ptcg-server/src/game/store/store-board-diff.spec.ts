import { boardDiffers } from './store';
import { Card } from './card/card';
import { StateLog } from './state/state-log';

function chain(length: number, leaf: any): any {
  for (let i = 0; i < length; i++) { leaf = { next: leaf }; }
  return leaf;
}

describe('boardDiffers graph comparison', () => {
  it('finds additions, removals, and changes on either side', () => {
    expect(boardDiffers({ hp: 10 }, { hp: 10 })).toBe(false);
    expect(boardDiffers({ hp: 10 }, { hp: 20 })).toBe(true);
    expect(boardDiffers({}, { hp: 10 })).toBe(true);
    expect(boardDiffers({ hp: 10 }, {})).toBe(true);
    expect(boardDiffers({}, { optional: undefined })).toBe(false);
    expect(boardDiffers({ optional: undefined }, {})).toBe(false);
  });

  it('uses inherited values when a key is owned only by the other side', () => {
    const inherited = Object.create({ hp: 10 });
    expect(boardDiffers(inherited, { hp: 10 })).toBe(false);
    expect(boardDiffers({ hp: 10 }, inherited)).toBe(false);
    expect(boardDiffers(inherited, { hp: 20 })).toBe(true);
    expect(boardDiffers({ hp: 20 }, inherited)).toBe(true);
  });

  it('preserves array order, lengths, and sparse-array comparisons', () => {
    expect(boardDiffers([1, 2], [2, 1])).toBe(true);
    expect(boardDiffers([1], [1, 2])).toBe(true);
    expect(boardDiffers([], {})).toBe(true);
    const a = new Array(2);
    const b = new Array(2);
    a[1] = { hp: 10 };
    b[1] = { hp: 10 };
    expect(boardDiffers(a, b)).toBe(false);
    b[1].hp = 20;
    expect(boardDiffers(a, b)).toBe(true);
  });

  it('preserves function and null handling', () => {
    expect(boardDiffers({ effect: () => 1 }, { effect: () => 2 })).toBe(false);
    expect(boardDiffers({ effect: () => 1 }, {})).toBe(true);
    expect(boardDiffers(null, undefined)).toBe(true);
    expect(boardDiffers({ value: null }, { value: null })).toBe(false);
  });

  it('compares shared card definitions and log entries by identity', () => {
    for (const prototype of [Card.prototype, StateLog.prototype]) {
      const original = Object.create(prototype);
      const different = Object.create(prototype);
      expect(boardDiffers({ value: original }, { value: original })).toBe(false);
      expect(boardDiffers({ value: original }, { value: different })).toBe(true);
    }
  });

  it('terminates cyclic pairs and still checks a mutation beyond the back-reference', () => {
    let reads = 0;
    const a: any = {};
    const b: any = {};
    a.self = a;
    b.self = b;
    a.hp = 10;
    Object.defineProperty(b, 'hp', { enumerable: true, get: () => { reads++; return 20; } });
    expect(boardDiffers(a, b)).toBe(true);
    expect(reads).toBe(1);
    expect(boardDiffers(a, { self: a, hp: 10 })).toBe(false);
  });

  it('does not confuse two different partners for the same left object', () => {
    const shared = { hp: 10 };
    expect(boardDiffers({ first: shared, second: shared },
      { first: { hp: 10 }, second: { hp: 20 } })).toBe(true);
  });

  it('reuses a compared pair without reading the same shared graph twice', () => {
    let reads = 0;
    const a = { hp: 10 };
    const b = { get hp() { reads++; return 10; } };
    expect(boardDiffers({ first: a, second: a }, { first: b, second: b })).toBe(false);
    expect(reads).toBe(1);
  });

  it('revisits a pair when a later path has more depth budget', () => {
    const a = { hp: 10 };
    const b = { hp: 20 };
    // The first path only reaches hp beyond the existing depth cap. A plain visited-pair set
    // would wrongly skip the second, shallow path and turn a real mutation into "no effect".
    expect(boardDiffers({ deep: chain(23, a), shallow: a },
      { deep: chain(23, b), shallow: b })).toBe(true);
  });

  it('preserves the existing depth boundary', () => {
    expect(boardDiffers(chain(24, 10), chain(24, 20))).toBe(true);
    expect(boardDiffers(chain(25, 10), chain(25, 20))).toBe(false);
  });
});
