import { serialize, deserialize } from 'v8';
import { types } from 'util';
import { resolve, sep } from 'path';
import { Card } from '../game/store/card/card';
import { CardList } from '../game/store/state/card-list';
import { captureSnapshotLineage, restoreSnapshotLineage } from '../game/store/snapshot-provenance';

export class UnsupportedCheckpoint extends Error { }
type Ref = [0, any] | [1, number] | [2, number];
interface Node {
  kind: 'object' | 'array' | 'map' | 'set'; prototype?: number; length?: number;
  properties: Array<[string, Ref, number]>; entries?: Ref[][]; extensible: boolean;
  lineage?: Ref; cardMetadata?: Ref;
}
// This reducer keeps attack bookkeeping in a module-scoped WeakMap, outside the owned graph.
// Decline the whole checkpoint until that state has an explicit replay contract.
const externalStateClasses = new Set(['Orthwormex']);

/** Detached buffers contain neither request objects nor source-instance prototypes. */
export class ReplayCheckpointCodec {
  public serializedBytes = 0;
  private readonly prototypes: object[] = [Object.prototype];
  private readonly prototypeIds = new Map<object, number>([[Object.prototype, 0]]);
  private readonly approvedPrototypes = new WeakSet<object>([Object.prototype]);
  constructor(private readonly approvedFunctions: ReadonlyArray<Function> = []) { this.approveEngineDefinitions(); }

  /** Called before actions run; module-exported definitions cannot close over that request. */
  approveEngineDefinitions(): void {
    const root = resolve(__dirname, '..') + sep;
    for (const filename of Object.keys(require.cache)) {
      if (!filename.startsWith(root + 'game' + sep) && !filename.startsWith(root + 'sets' + sep)) { continue; }
      if (filename.includes(sep + 'tests' + sep) || /\.spec\.[jt]s$/.test(filename)) { continue; }
      const value = require.cache[filename]?.exports;
      if (!value || types.isProxy(value)) { continue; }
      const values = typeof value === 'function' ? [value] : Object.values(Object.getOwnPropertyDescriptors(value)).map(d => d.value);
      for (const definition of values) {
        if (typeof definition !== 'function' || types.isProxy(definition)) { continue; }
        const prototype = Object.getOwnPropertyDescriptor(definition, 'prototype')?.value;
        if (prototype && /^class\s/.test(Function.prototype.toString.call(definition))) { this.approvedPrototypes.add(prototype); }
      }
    }
  }

  private prototype(source: object): number {
    let p = Object.getPrototypeOf(source);
    if (p === null) { return -1; }
    while (!Object.prototype.hasOwnProperty.call(p, 'constructor')) {
      if (types.isProxy(p)) { throw new UnsupportedCheckpoint('prototype-proxy'); }
      for (const key of Reflect.ownKeys(p)) {
        const d = Object.getOwnPropertyDescriptor(p, key)!;
        if (typeof key !== 'string' || d.get || d.set) { throw new UnsupportedCheckpoint('inherited-shape'); }
        if (!(source instanceof CardList && key === 'fromZoneRef') && !Object.prototype.hasOwnProperty.call(source, key)) {
          throw new UnsupportedCheckpoint('inherited-data');
        }
      }
      p = Object.getPrototypeOf(p);
      if (p === null) { throw new UnsupportedCheckpoint('custom-prototype'); }
    }
    const ctor = Object.getOwnPropertyDescriptor(p, 'constructor')!.value;
    if (!this.approvedPrototypes.has(p)) { throw new UnsupportedCheckpoint('unapproved-prototype'); }
    if (typeof ctor !== 'function' || ctor.prototype !== p || types.isProxy(p)
      || (ctor !== Object && /\[native code\]/.test(Function.prototype.toString.call(ctor)))) {
      throw new UnsupportedCheckpoint('native-or-custom-prototype');
    }
    for (let prototype = p; prototype !== null && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
      const base = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      if (typeof base === 'function') {
        if (externalStateClasses.has(base.name)) { throw new UnsupportedCheckpoint('external-class-state'); }
        for (const key of Reflect.ownKeys(base)) {
          if (key === 'prototype') { continue; }
          // These WeakMaps have explicit per-Card encode/restore handling below.
          if (base === CardList && (key === 'deckStamp' || key === 'transit' || key === 'deckEnd')) { continue; }
          const descriptor = Object.getOwnPropertyDescriptor(base, key)!;
          if (descriptor.get || descriptor.set || (descriptor.value !== null && typeof descriptor.value === 'object')) {
            throw new UnsupportedCheckpoint('class-static-state');
          }
        }
      }
      if (typeof base === 'function' && /\[native code\]/.test(Function.prototype.toString.call(base))) {
        throw new UnsupportedCheckpoint('native-base');
      }
      for (const key of Reflect.ownKeys(prototype)) {
        const d = Object.getOwnPropertyDescriptor(prototype, key)!;
        if ('value' in d && d.value !== null && typeof d.value === 'object') {
          throw new UnsupportedCheckpoint('mutable-class-prototype');
        }
      }
    }
    let id = this.prototypeIds.get(p);
    if (id === undefined) { id = this.prototypes.length; this.prototypes.push(p); this.prototypeIds.set(p, id); }
    return id;
  }

  encode(value: unknown, limit: number = 1024 * 1024): Buffer {
    const nodes: Node[] = [], refs = new Map<object, number>();
    let estimated = 0, edges = 0;
    const copy = (source: any): Ref => {
      if (++edges > 200000) { throw new UnsupportedCheckpoint('edge-budget'); }
      if (typeof source === 'function') {
        const id = this.approvedFunctions.indexOf(source);
        if (id < 0) { throw new UnsupportedCheckpoint('unapproved-function'); }
        return [2, id];
      }
      if (typeof source === 'symbol') { throw new UnsupportedCheckpoint('symbol'); }
      if (source === null || typeof source !== 'object') {
        estimated += typeof source === 'string' ? Buffer.byteLength(source) : 8;
        if (estimated > limit * 2) { throw new UnsupportedCheckpoint('size-budget'); }
        return [0, source];
      }
      if (types.isProxy(source)) { throw new UnsupportedCheckpoint('proxy'); }
      const previous = refs.get(source);
      if (previous !== undefined) { return [1, previous]; }
      if (nodes.length >= 20000) { throw new UnsupportedCheckpoint('node-budget'); }
      const id = nodes.length, kind = Array.isArray(source) ? 'array' : source instanceof Map ? 'map' : source instanceof Set ? 'set' : 'object';
      const node: Node = { kind, properties: [], extensible: Object.isExtensible(source) };
      refs.set(source, id); nodes.push(node); estimated += 32;
      if (kind === 'array') {
        if (Object.getPrototypeOf(source) !== Array.prototype) { throw new UnsupportedCheckpoint('custom-array'); }
        node.length = source.length;
      } else if (kind === 'map' || kind === 'set') {
        if (Object.getPrototypeOf(source) !== (kind === 'map' ? Map.prototype : Set.prototype)) { throw new UnsupportedCheckpoint('custom-container'); }
        node.entries = kind === 'map' ? Array.from(Map.prototype.entries.call(source), ([k, v]: any) => [copy(k), copy(v)])
          : Array.from(Set.prototype.values.call(source), (v: any) => [copy(v)]);
      } else { node.prototype = this.prototype(source); }
      for (const key of Reflect.ownKeys(source)) {
        if (typeof key !== 'string' || key === '__proto__') { throw new UnsupportedCheckpoint('property-key'); }
        const d = Object.getOwnPropertyDescriptor(source, key)!;
        if (d.get || d.set) { throw new UnsupportedCheckpoint('accessor'); }
        if (source instanceof CardList && key === 'fromZoneRef') { continue; }
        node.properties.push([key, copy(d.value), (d.writable ? 1 : 0) | (d.enumerable ? 2 : 0) | (d.configurable ? 4 : 0)]);
      }
      if (source instanceof CardList) {
        if ((Object.prototype as any).__lookupGetter__.call(source, 'fromZoneRef')) { throw new UnsupportedCheckpoint('provenance-accessor'); }
        node.lineage = copy(captureSnapshotLineage(source));
      }
      if (source instanceof Card) {
        node.cardMetadata = copy({ deckStamp: CardList.deckStamp.get(source), transit: CardList.transit.get(source), deckEnd: CardList.deckEnd.get(source) });
      }
      return [1, id];
    };
    const root = copy(value), payload = serialize({ version: 1, root, nodes });
    this.serializedBytes += payload.length;
    if (payload.length > limit) { throw new UnsupportedCheckpoint('entry-size'); }
    return payload;
  }

  decode<T>(payload: Buffer): T {
    const document = deserialize(payload);
    if (document?.version !== 1 || !Array.isArray(document.nodes) || document.nodes.length > 20000) {
      throw new UnsupportedCheckpoint('invalid-payload');
    }
    const nodes: Node[] = document.nodes;
    const objects = nodes.map(n => {
      if (n.kind === 'array') { return new Array(n.length!); }
      if (n.kind === 'map') { return new Map(); }
      if (n.kind === 'set') { return new Set(); }
      if (n.kind !== 'object' || !Number.isInteger(n.prototype) || n.prototype! < -1 || n.prototype! >= this.prototypes.length) {
        throw new UnsupportedCheckpoint('invalid-prototype');
      }
      return Object.create(n.prototype === -1 ? null : this.prototypes[n.prototype!]);
    });
    const read = (r: Ref): any => {
      if (!Array.isArray(r)) { throw new UnsupportedCheckpoint('invalid-reference'); }
      if (r[0] === 0) { return r[1]; }
      if (!Number.isInteger(r[1]) || r[1] < 0) { throw new UnsupportedCheckpoint('invalid-reference'); }
      if (r[0] === 1 && r[1] < objects.length) { return objects[r[1]]; }
      if (r[0] === 2 && r[1] < this.approvedFunctions.length) { return this.approvedFunctions[r[1]]; }
      throw new UnsupportedCheckpoint('invalid-reference');
    };
    nodes.forEach((n, i) => {
      const object = objects[i];
      for (const [key, ref, flags] of n.properties) {
        const prototype = Object.getPrototypeOf(object);
        if (flags === 7 && (prototype === null || !(key in prototype))) { object[key] = read(ref); }
        else { Object.defineProperty(object, key, { value: read(ref), writable: !!(flags & 1), enumerable: !!(flags & 2), configurable: !!(flags & 4) }); }
      }
      if (n.kind === 'map') { for (const [k, v] of n.entries!) { Map.prototype.set.call(object, read(k), read(v)); } }
      if (n.kind === 'set') { for (const [v] of n.entries!) { Set.prototype.add.call(object, read(v)); } }
    });
    nodes.forEach((n, i) => {
      const object = objects[i];
      if (n.lineage !== undefined) { restoreSnapshotLineage(object, read(n.lineage)); }
      if (n.cardMetadata !== undefined) { CardList.restoreReplayCardMetadata(object, read(n.cardMetadata)); }
      if (!n.extensible) { Object.preventExtensions(object); }
    });
    return read(document.root);
  }
}
