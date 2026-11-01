import { deepClone } from '../../utils/utils';
import { types } from 'util';
import { Card } from './card/card';
import { State } from './state/state';
import { StateLog } from './state/state-log';
import { CardList } from './state/card-list';
import { copyExistingSnapshotProvenance, copySnapshotProvenance, snapshotProvenanceUsed } from './snapshot-provenance';

export type SnapshotSite = 'reaction' | 'menu' | 'rollback' | 'prompt-answer' | 'test';
export interface StateSnapshot<T = undefined> { state: State; effect: T; cards?: ReadonlyArray<Card>; }
export interface StateSnapshotBackend {
  readonly name: 'legacy' | 'graph';
  capture<T>(state: State, effect: T, site: SnapshotSite, pins?: ReadonlyArray<object>): StateSnapshot<T>;
}
interface Diagnostic { calls: number; milliseconds: number; fallbacks: { [reason: string]: number }; }
const diagnostics: { [site: string]: Diagnostic } = {};
export function snapshotDiagnostics(): typeof diagnostics { return diagnostics; }
class UnsupportedSnapshot extends Error { }
const canonicalPrototypes = new WeakSet<object>();
const nativePrototypes = new Set<object>([
  Date.prototype, Map.prototype, Set.prototype, RegExp.prototype, WeakMap.prototype,
  WeakSet.prototype, ArrayBuffer.prototype, Error.prototype, Promise.prototype,
  Number.prototype, String.prototype, Boolean.prototype, Object.getPrototypeOf(Uint8Array.prototype),
  DataView.prototype
]);
for (const name of ['WeakRef', 'FinalizationRegistry', 'BigInt', 'Symbol']) {
  const ctor = (global as any)[name];
  if (ctor) { nativePrototypes.add(ctor.prototype); }
}

function legacy<T>(state: State, effect: T, pins: ReadonlyArray<object>, provenance: boolean): StateSnapshot<T> {
  const refs = new Map<object, object>();
  for (const pin of pins) { refs.set(pin, pin); }
  const result = { state: deepClone(state, [Card, StateLog], refs), effect: effect === undefined ? effect : deepClone(effect, [Card, StateLog], refs) };
  if (provenance) {
    for (const [source, destination] of refs) {
      if (source !== destination && source instanceof CardList) { copyExistingSnapshotProvenance(source, destination); }
    }
  }
  return result;
}

function prototypeOf(source: object): object {
  let proto = Object.getPrototypeOf(source);
  if (proto === null) { throw new UnsupportedSnapshot('null-prototype'); }
  if (canonicalPrototypes.has(proto)) { return proto; }
  while (!Object.prototype.hasOwnProperty.call(proto, 'constructor')) {
    if (Object.getOwnPropertySymbols(proto).length !== 0) { throw new UnsupportedSnapshot('inherited-symbol'); }
    for (const key of Object.getOwnPropertyNames(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)!;
      if (descriptor.get || descriptor.set) { throw new UnsupportedSnapshot('inherited-accessor'); }
      if (!(key === 'fromZoneRef' && source instanceof CardList) && !Object.prototype.hasOwnProperty.call(source, key)) {
        throw new UnsupportedSnapshot('inherited-data');
      }
    }
    proto = Object.getPrototypeOf(proto);
    if (proto === null) { throw new UnsupportedSnapshot('custom-prototype'); }
  }
  const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor')!;
  if (typeof ctor.value !== 'function' || ctor.value.prototype !== proto) {
    throw new UnsupportedSnapshot('custom-constructor');
  }
  for (let current: object | null = proto; current !== null; current = Object.getPrototypeOf(current)) {
    if (nativePrototypes.has(current)) { throw new UnsupportedSnapshot('native-container'); }
  }
  canonicalPrototypes.add(proto);
  return proto;
}

function graph<T>(state: State, effect: T, pins: ReadonlyArray<object>, collectCards: boolean): StateSnapshot<T> {
  const refs = new Map<object, object>();
  const cards = collectCards ? new Set<Card>() : undefined;
  for (const pin of pins) { refs.set(pin, pin); }
  const clone = (source: any): any => {
    if (source === null || typeof source !== 'object') { return source; }
    if (types.isProxy(source)) { throw new UnsupportedSnapshot('proxy'); }
    if (source instanceof Card) { if (cards) { cards.add(source); } return source; }
    if (source instanceof StateLog) { return source; }
    // Match legacy array aliasing and holes; arrays deliberately do not enter refs.
    if (Array.isArray(source)) {
      if (Object.getPrototypeOf(source) !== Array.prototype || Object.prototype.hasOwnProperty.call(source, 'map')
        || Object.prototype.hasOwnProperty.call(source, 'constructor')) { throw new UnsupportedSnapshot('custom-array'); }
      const destination = new Array(source.length);
      for (let index = 0; index < source.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
        if (descriptor === undefined) {
          if (index in source) { throw new UnsupportedSnapshot('inherited-array-index'); }
          continue;
        }
        if (descriptor.get || descriptor.set) { throw new UnsupportedSnapshot('array-accessor'); }
        destination[index] = clone(descriptor.value);
      }
      return destination;
    }
    const known = refs.get(source);
    if (known !== undefined) { return known; }
    const proto = prototypeOf(source);
    const destination = Object.create(proto);
    refs.set(source, destination);
    for (const key of Reflect.ownKeys(source)) {
      if (typeof key !== 'string') { throw new UnsupportedSnapshot('symbol-property'); }
      if (key === '__proto__') { throw new UnsupportedSnapshot('prototype-key'); }
      const descriptor = Object.getOwnPropertyDescriptor(source, key)!;
      if (descriptor.get || descriptor.set) { throw new UnsupportedSnapshot('own-accessor'); }
      if ('writable' in descriptor && !descriptor.writable && descriptor.enumerable) { throw new UnsupportedSnapshot('readonly-property'); }
      if (!descriptor.enumerable) {
        if (key === 'fromZoneRef' && source instanceof CardList) { continue; }
        throw new UnsupportedSnapshot('non-enumerable-property');
      }
      const value = clone(descriptor.value);
      // Ordinary assignment gives stable shapes without a descriptor allocation per copied field.
      // An inherited accessor/read-only method still needs an explicit owned property.
      if (key in proto) {
        Object.defineProperty(destination, key, { value, enumerable: true, writable: true, configurable: true });
      } else { destination[key] = value; }
    }
    if (source instanceof CardList) {
      if ((Object.prototype as any).__lookupGetter__.call(source, 'fromZoneRef')) { throw new UnsupportedSnapshot('provenance-accessor'); }
      copySnapshotProvenance(source, destination);
    }
    return destination;
  };
  return { state: clone(state), effect: clone(effect), cards: cards && Array.from(cards) };
}

export const legacyStateSnapshots: StateSnapshotBackend = {
  name: 'legacy', capture: (state, effect, _site, pins = []) => legacy(state, effect, pins, false)
};

/** Same legacy snapshot semantics, specialized for conformance's two opaque types. */
export const conformanceLegacyStateSnapshots: StateSnapshotBackend = {
  name: 'legacy',
  capture: <T>(state: State, effect: T, _site: SnapshotSite, pins: ReadonlyArray<object> = []): StateSnapshot<T> => {
    const refs = new Map<object, object>();
    for (const pin of pins) { refs.set(pin, pin); }
    const clone = (source: any): any => {
      if (source === null || typeof source !== 'object') { return source; }
      if (source instanceof Array) { return source.map(clone); }
      if (!(source instanceof Object) || source instanceof Card || source instanceof StateLog) { return source; }
      const known = refs.get(source);
      if (known !== undefined) { return known; }
      const destination = Object.create(source);
      refs.set(source, destination);
      for (const key of Object.keys(source)) {
        if (Object.prototype.hasOwnProperty.call(source, key)) { destination[key] = clone(source[key]); }
      }
      return destination;
    };
    const captured = { state: clone(state), effect: clone(effect) };
    if (snapshotProvenanceUsed()) {
      refs.forEach((destination, source) => {
        if (source !== destination && source instanceof CardList) { copyExistingSnapshotProvenance(source, destination); }
      });
    }
    return captured;
  }
};
export const graphStateSnapshots: StateSnapshotBackend = {
  name: 'graph',
  capture: <T>(state: State, effect: T, site: SnapshotSite, pins: ReadonlyArray<object> = []): StateSnapshot<T> => {
    const measured = process.env.CONFORMANCE_SNAPSHOT_DIAGNOSTICS === '1';
    const start = measured ? process.hrtime() : undefined;
    const stats = measured ? diagnostics[site] ?? (diagnostics[site] = { calls: 0, milliseconds: 0, fallbacks: {} }) : undefined;
    if (stats) { stats.calls++; }
    try {
      return graph(state, effect, pins, site === 'menu' || site === 'test');
    } catch (error) {
      if (!(error instanceof UnsupportedSnapshot)) { throw error; }
      if (stats) { stats.fallbacks[error.message] = (stats.fallbacks[error.message] || 0) + 1; }
      return legacy(state, effect, pins, true);
    } finally {
      if (start && stats) { const elapsed = process.hrtime(start); stats.milliseconds += elapsed[0] * 1000 + elapsed[1] / 1e6; }
    }
  }
};
