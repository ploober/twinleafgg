import { createHash } from 'crypto';
import { types } from 'util';
import { performance } from 'perf_hooks';
import { step, stepWithReplaySession, ReplayFrame, ReplayResume, ReplayCheckpointSession } from './driver';
import { NeutralState, NeutralAction, StepResponse, SCHEMA_VERSION } from './neutral-types';
import { ImportedGame } from './state-adapter';
import { createConformanceStore } from './conformance-store';
import { ReplayCheckpointCodec, UnsupportedCheckpoint } from './replay-checkpoint-codec';
import { runtimeBuildIdentity } from './capabilities';
import { ConformanceStoreHandler } from './conformance-store-handler';

interface Payload { state: ImportedGame['state']; ctx: ImportedGame['ctx']; inFlightAttack: ImportedGame['inFlightAttack']; frame: ReplayFrame; bookkeeping: { logId: number }; }
interface Entry { key: string; payload: Buffer; bytes: number; applied: number; }
export interface CheckpointStats {
  requests: number; hits: number; avoidedActions: number; captures: number; captureAttempts: number;
  published: number; evictions: number; decodeFailures: number; entries: number; bytes: number; peakBytes: number;
  keyMs: number; captureMs: number; restoreMs: number; skipped: { [reason: string]: number };
  serializedBytes?: number;
}

/** Canonical complete inputs; unknown in-process shapes use the ordinary reference path. */
export function checkpointCanonical(value: unknown, seen = new Set<object>()): string {
  if (value === null) { return 'null'; }
  if (typeof value === 'string' || typeof value === 'boolean') { return JSON.stringify(value); }
  if (typeof value === 'number' && Number.isFinite(value)) { return Object.is(value, -0) ? '-0' : String(value); }
  if (value === undefined) { return 'undefined'; }
  if (typeof value !== 'object' || value === null || types.isProxy(value) || seen.has(value)) { throw new UnsupportedCheckpoint('request-shape'); }
  const proto = Object.getPrototypeOf(value);
  if (proto !== (Array.isArray(value) ? Array.prototype : Object.prototype)) { throw new UnsupportedCheckpoint('request-prototype'); }
  // Keep identities: non-JSON object aliases also use the uncached path.
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some(k => typeof k !== 'string')) { throw new UnsupportedCheckpoint('request-symbol'); }
  const field = (key: string): string => {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (d.get || d.set) { throw new UnsupportedCheckpoint('request-accessor'); }
    if (!d.writable || !d.enumerable || !d.configurable) { throw new UnsupportedCheckpoint('request-descriptor'); }
    return checkpointCanonical(d.value, seen);
  };
  if (Array.isArray(value)) {
    if (value.length > 100000) { throw new UnsupportedCheckpoint('request-array-size'); }
    if (keys.some(k => k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k as string))) { throw new UnsupportedCheckpoint('request-array-property'); }
    return '[' + Array.from({ length: value.length }, (_, i) => Object.prototype.hasOwnProperty.call(value, String(i)) ? field(String(i)) : 'hole').join(',') + ']';
  }
  return '{' + (keys as string[]).sort().map(k => JSON.stringify(k) + ':' + field(k)).join(',') + '}';
}

export class ReplayCheckpointCache {
  private readonly codec = new ReplayCheckpointCodec();
  private prepared = false;
  private readonly entries = new Map<string, Entry>();
  // Bounded admission history avoids encoding prefixes that are never seen again.
  private readonly admission = new Map<string, number>();
  private readonly counters: CheckpointStats = { requests: 0, hits: 0, avoidedActions: 0, captures: 0, captureAttempts: 0, published: 0, evictions: 0, decodeFailures: 0, entries: 0, bytes: 0, peakBytes: 0, keyMs: 0, captureMs: 0, restoreMs: 0, skipped: {} };
  constructor(private readonly namespace = 'checkpoint-v1|' + SCHEMA_VERSION + '|' + runtimeBuildIdentity() + '|legacy',
    private readonly limits = { bytes: 16 * 1024 * 1024, entries: 32, entryBytes: 1024 * 1024 },
    private readonly hash: (key: string) => string = key => createHash('sha256').update(key).digest('hex')) { }
  stats(): CheckpointStats { return { ...this.counters, serializedBytes: this.codec.serializedBytes, skipped: { ...this.counters.skipped } }; }
  clear(): void { this.entries.clear(); this.admission.clear(); this.counters.entries = 0; this.counters.bytes = 0; }
  private skip(reason: string): void { this.counters.skipped[reason] = (this.counters.skipped[reason] || 0) + 1; }
  private remove(hash: string): void {
    const old = this.entries.get(hash);
    if (old) { this.counters.bytes -= old.bytes; this.entries.delete(hash); }
    this.counters.entries = this.entries.size;
  }
  private put(hash: string, entry: Entry): void {
    this.remove(hash); this.entries.set(hash, entry); this.counters.bytes += entry.bytes;
    while (this.entries.size > this.limits.entries || this.counters.bytes > this.limits.bytes) {
      this.remove(this.entries.keys().next().value!); this.counters.evictions++;
    }
    this.counters.entries = this.entries.size;
    this.counters.peakBytes = Math.max(this.counters.peakBytes, this.counters.bytes);
  }

  step(initial: NeutralState, actions: NeutralAction[]): StepResponse {
    this.counters.requests++;
    if (initial.phase === 'setup' || actions.length > 128) { this.skip('setup-or-long-input'); return step(initial, actions); }
    let root: string, parts: string[];
    const keyStart = performance.now();
    try {
      const seen = new Set<object>();
      root = this.namespace + '\n' + checkpointCanonical(initial, seen); parts = actions.map(a => checkpointCanonical(a, seen));
    }
    catch (error) {
      // JSON can contain deeper unused fields than the optional recursive key encoder supports.
      if (error instanceof RangeError) { this.skip('request-depth'); return step(initial, actions); }
      if (!(error instanceof UnsupportedCheckpoint)) { throw error; }
      this.skip(error.message); return step(initial, actions);
    }
    finally { this.counters.keyMs += performance.now() - keyStart; }
    if (Buffer.byteLength(root) + parts.reduce((n, part) => n + Buffer.byteLength(part), 0) > this.limits.entryBytes) {
      this.skip('key-budget'); return step(initial, actions);
    }
    const keys = new Map<number, { key: string; hash: string }>();
    const keyAt = (n: number): { key: string; hash: string } => {
      let value = keys.get(n);
      if (!value) {
        const start = performance.now(), key = root + '\n[' + parts.slice(0, n).join(',') + ']';
        value = { key, hash: this.hash(key) }; keys.set(n, value);
        if (keys.size > 64) { keys.delete(keys.keys().next().value!); }
        this.counters.keyMs += performance.now() - start;
      }
      return value;
    };
    const staged = new Map<string, Entry>(), observed = new Set<number>();
    let stagedBytes = 0;
    let hit: Entry | undefined;
    const lengths = Array.from(new Set(Array.from(this.entries.values(), e => e.applied)))
      .filter(n => n > 0 && n < actions.length).sort((a, b) => b - a);
    for (const n of lengths) {
      const k = keyAt(n), entry = this.entries.get(k.hash);
      if (entry?.key === k.key) { hit = entry; this.entries.delete(k.hash); this.entries.set(k.hash, entry); break; }
    }
    const session: ReplayCheckpointSession = {
      prepare: (): void => { if (!this.prepared) { this.codec.approveEngineDefinitions(); this.prepared = true; } },
      restore: (): ReplayResume | undefined => {
        if (!hit) { return undefined; }
        const entry = hit; hit = undefined;
        const start = performance.now();
        try {
          const p = this.codec.decode<Payload>(entry.payload);
          if (p.frame.cursor.i !== entry.applied) { throw new UnsupportedCheckpoint('cursor-mismatch'); }
          const handler = new ConformanceStoreHandler(), store = createConformanceStore(handler);
          store.state = p.state; store.restoreReplayBookkeeping(p.bookkeeping);
          const game: ImportedGame = { store, handler, state: p.state, ctx: p.ctx, inFlightAttack: p.inFlightAttack };
          // Rebind callbacks through a fresh conformance handler, never the source request's handler.
          this.counters.hits++; this.counters.avoidedActions += entry.applied;
          return { game, frame: p.frame };
        } catch (error) {
          this.remove(this.hash(entry.key)); this.counters.decodeFailures++;
          if (!(error instanceof UnsupportedCheckpoint) && !(error instanceof Error)) { throw error; }
          return undefined;
        } finally { this.counters.restoreMs += performance.now() - start; }
      },
      wantsCapture: (n: number): boolean => {
        if (n <= 0 || observed.has(n)) { return false; }
        observed.add(n); const k = keyAt(n), count = this.admission.get(k.hash) || 0;
        this.admission.delete(k.hash); this.admission.set(k.hash, count + 1);
        while (this.admission.size > 128) { this.admission.delete(this.admission.keys().next().value!); }
        return count > 0 && !(this.entries.get(k.hash)?.key === k.key);
      },
      capture: (game, frame): void => {
        const bookkeeping = game.store.captureReplayBookkeeping();
        if (!bookkeeping) { this.skip('store-boundary'); return; }
        this.counters.captureAttempts++; const start = performance.now(), k = keyAt(frame.cursor.i);
        try {
          const limit = this.limits.entryBytes - Buffer.byteLength(k.key);
          if (limit <= 0) { throw new UnsupportedCheckpoint('key-size'); }
          const payload = this.codec.encode({ state: game.state, ctx: game.ctx, inFlightAttack: game.inFlightAttack, frame, bookkeeping }, limit);
          const previous = staged.get(k.hash); if (previous) { stagedBytes -= previous.bytes; staged.delete(k.hash); }
          const entry = { ...k, payload, bytes: Buffer.byteLength(k.key) + payload.length, applied: frame.cursor.i };
          staged.set(k.hash, entry); stagedBytes += entry.bytes;
          while (this.entries.size > 0 && (this.entries.size + staged.size > this.limits.entries || this.counters.bytes + stagedBytes > this.limits.bytes)) {
            this.remove(this.entries.keys().next().value!); this.counters.evictions++;
          }
          while (staged.size > this.limits.entries || stagedBytes > this.limits.bytes) {
            const first = staged.keys().next().value!; stagedBytes -= staged.get(first)!.bytes; staged.delete(first); this.skip('staging-budget');
          }
          this.counters.peakBytes = Math.max(this.counters.peakBytes, this.counters.bytes + stagedBytes);
          this.counters.captures++;
        } catch (error) {
          // A deep inherited graph may exhaust the codec stack before its node budget.
          // Decline this optional capture; normal replay errors are outside this catch.
          if (error instanceof RangeError) { this.skip('capture-depth'); }
          else if (error instanceof UnsupportedCheckpoint) { this.skip(error.message); }
          else { throw error; }
        }
        finally { this.counters.captureMs += performance.now() - start; }
      }
    };
    const response = stepWithReplaySession(initial, actions, session);
    if (response.status !== 'invalidAction' && response.applied === actions.length) {
      for (const [hash, entry] of staged) { this.put(hash, entry); this.counters.published++; }
    }
    return response;
  }
}

export function replayCheckpointMode(): 'off' | 'on' {
  const mode = process.env.CONFORMANCE_REPLAY_CHECKPOINTS ?? 'off';
  if (mode !== 'off' && mode !== 'on') { throw new Error('Invalid CONFORMANCE_REPLAY_CHECKPOINTS: expected off or on'); }
  if (mode === 'on' && (process.env.CONFORMANCE_STATE_SNAPSHOTS ?? 'legacy') !== 'legacy') {
    throw new Error('Replay checkpoints currently require legacy conformance snapshots');
  }
  return mode;
}
let cache: ReplayCheckpointCache | undefined;
export function checkpointStats(): CheckpointStats | undefined { return cache?.stats(); }
export function clearReplayCheckpoints(): void { cache?.clear(); }
export function executeConformanceStep(initial: NeutralState, actions: NeutralAction[]): StepResponse {
  if (replayCheckpointMode() === 'off') { return step(initial, actions); }
  cache ??= new ReplayCheckpointCache();
  return cache.step(initial, actions);
}
