/** Snapshot ancestry contains only small handles, never earlier state/list objects. */
export interface Lineage { readonly parent?: Lineage; }
export interface SnapshotLineage { readonly identity: Lineage; readonly origin?: Lineage; }
const lists = new WeakMap<object, Lineage>();
const origins = new WeakMap<object, Lineage>();
let used = false;
export function snapshotProvenanceUsed(): boolean { return used; }

function identity(list: object): Lineage {
  let node = lists.get(list);
  if (node === undefined) { node = {}; lists.set(list, node); }
  return node;
}

function legacyIdentity(list: object): Lineage {
  const known = lists.get(list);
  if (known !== undefined) { return known; }
  const parent = Object.getPrototypeOf(list);
  // Instance-as-prototype layers have no owned constructor; class prototypes do.
  const node: Lineage = parent !== null && !Object.prototype.hasOwnProperty.call(parent, 'constructor')
    ? { parent: legacyIdentity(parent) } : {};
  lists.set(list, node);
  return node;
}

/** Detached checkpoint metadata contains handles, never earlier lists or States. */
export function captureSnapshotLineage(source: object): SnapshotLineage {
  // Capturing may register a live legacy list. Its subsequent snapshots must carry the handles,
  // even when the encoded checkpoint is rejected or has not yet been restored.
  used = true;
  const ref = (source as { fromZoneRef?: object }).fromZoneRef;
  const origin = origins.get(source) ?? (ref === undefined ? undefined : legacyIdentity(ref));
  if (origin !== undefined) { origins.set(source, origin); }
  return { identity: legacyIdentity(source), origin };
}

export function restoreSnapshotLineage(destination: object, value: SnapshotLineage): void {
  used = true;
  lists.set(destination, value.identity);
  if (value.origin !== undefined) { origins.set(destination, value.origin); }
}

export function copySnapshotProvenance(source: object, destination: object): void {
  used = true;
  lists.set(destination, { parent: legacyIdentity(source) });
  const ref = (source as { fromZoneRef?: object }).fromZoneRef;
  const origin = origins.get(source) ?? (ref === undefined ? undefined : legacyIdentity(ref));
  if (origin !== undefined) { origins.set(destination, origin); }
}

export function copyExistingSnapshotProvenance(source: object, destination: object): void {
  const parent = lists.get(source);
  if (parent !== undefined) { lists.set(destination, { parent }); }
  const origin = origins.get(source);
  if (origin !== undefined) { origins.set(destination, origin); }
}

/** True selects explicit conformance provenance; ordinary gameplay retains its legacy path. */
export function recordSnapshotSource(source: object & { zoneTag?: string }, destination: object): boolean {
  if (!lists.has(source)) { return false; }
  const origin = source.zoneTag !== undefined ? identity(source) : origins.get(source);
  if (origin !== undefined) { origins.set(destination, origin); }
  identity(destination);
  if (Object.prototype.hasOwnProperty.call(destination, 'fromZoneRef')) {
    delete (destination as { fromZoneRef?: object }).fromZoneRef;
  }
  return true;
}

function related(a: Lineage, b: Lineage): boolean {
  for (let x: Lineage | undefined = a; x !== undefined; x = x.parent) { if (x === b) { return true; } }
  for (let x: Lineage | undefined = b; x !== undefined; x = x.parent) { if (x === a) { return true; } }
  return false;
}

export function snapshotSourceMatches(pile: object, zone: object): boolean {
  const origin = origins.get(pile);
  if (origin !== undefined) { return related(origin, legacyIdentity(zone)); }
  const ref = (pile as { fromZoneRef?: object }).fromZoneRef;
  if (ref === undefined) { return false; }
  for (let x: object | null = ref; x !== null && x !== Object.prototype; x = Object.getPrototypeOf(x)) {
    if (x === zone) { return true; }
  }
  for (let x: object | null = zone; x !== null && x !== Object.prototype; x = Object.getPrototypeOf(x)) {
    if (x === ref) { return true; }
  }
  return false;
}

export function hasSnapshotSource(pile: object): boolean {
  return origins.has(pile) || (pile as { fromZoneRef?: object }).fromZoneRef !== undefined;
}
