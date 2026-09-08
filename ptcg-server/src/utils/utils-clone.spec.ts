import { deepClone } from './utils';

class SharedDefinition {
  name = 'shared';
}

class Board {
  damage = 10;
  nested = { energy: [1, 2] };
  handler = () => 'effect';
}

describe('deepClone own-field traversal', () => {
  it('keeps the existing prototype and copies owned fields independently through repeated clones', () => {
    const original = new Board();
    const first = deepClone(original);
    const second = deepClone(first);
    expect(Object.getPrototypeOf(first)).toBe(original);
    expect(Object.getPrototypeOf(second)).toBe(first);
    expect(second instanceof Board).toBe(true);
    expect(Object.keys(second)).toEqual(Object.keys(original));
    second.nested.energy.push(3);
    second.damage = 20;
    expect(original.nested.energy).toEqual([1, 2]);
    expect(first.nested.energy).toEqual([1, 2]);
    expect(original.damage).toBe(10);
    expect(second.handler).toBe(original.handler);
  });

  it('leaves inherited enumerable values inherited instead of cloning or reading them', () => {
    const prototype = { inherited: { marker: 1 } };
    Object.defineProperty(prototype, 'unreadable', {
      enumerable: true, get: () => { throw new Error('inherited getter must not run'); }
    });
    const original = Object.assign(Object.create(prototype), { own: { marker: 2 } });
    const copy = deepClone(original);
    expect(Object.keys(copy)).toEqual(['own']);
    expect(copy.inherited).toBe(prototype.inherited);
    expect(copy.own).not.toBe(original.own);
    expect(copy.own).toEqual(original.own);
  });

  it('retains object cycles, shared subgraphs, and ignored definitions', () => {
    const shared = { damage: 10 };
    const definition = new SharedDefinition();
    const original: any = { left: shared, right: shared, definition };
    original.self = original;
    const copy = deepClone(original, [SharedDefinition]);
    expect(copy.self).toBe(copy);
    expect(copy.left).toBe(copy.right);
    expect(copy.left).not.toBe(shared);
    expect(copy.definition).toBe(definition);
  });

  it('honors a reference map shared between state and effect clones', () => {
    const player = { damage: 10 };
    const references = new Map<object, object>();
    const state = deepClone({ player }, [], references);
    const effect = deepClone({ target: player }, [], references);
    expect(effect.target).toBe(state.player);
    expect(effect.target).not.toBe(player);
  });

  it('preserves sparse array holes, null values, and functions', () => {
    const original = new Array(3);
    const handler = () => 42;
    original[1] = { nullValue: null, handler };
    const copy = deepClone(original);
    expect(copy.length).toBe(3);
    expect(0 in copy).toBe(false);
    expect(2 in copy).toBe(false);
    expect(copy[1]).not.toBe(original[1]);
    expect(copy[1].nullValue).toBe(null);
    expect(copy[1].handler).toBe(handler);
  });
});
