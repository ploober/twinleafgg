import { ReplayCheckpointCache, checkpointCanonical, replayCheckpointMode } from '../replay-checkpoints';
import { step } from '../driver';
import { materializeNeutral } from './support/scenario-runner';
import { NeutralAction } from '../neutral-types';
import { createConformanceApp } from '../http/app';

function board() {
  return materializeNeutral({ turn: 3, players: {
    A: { active: { card: 'asc-004' }, deck: Array(12).fill('sve-003'), prizeCount: 6 },
    B: { active: { card: 'asc-004' }, deck: Array(12).fill('sve-003'), prizeCount: 6 },
  } });
}
const prefix: NeutralAction[] = [{ type: 'endTurn', actor: 'A' }, { type: 'endTurn', actor: 'B' }];

describe('Conformance replay checkpoints', () => {
  let snapshots: string | undefined, checkpoints: string | undefined;
  beforeEach(() => {
    snapshots = process.env.CONFORMANCE_STATE_SNAPSHOTS; checkpoints = process.env.CONFORMANCE_REPLAY_CHECKPOINTS;
    process.env.CONFORMANCE_STATE_SNAPSHOTS = 'legacy';
  });
  afterEach(() => {
    if (snapshots === undefined) { delete process.env.CONFORMANCE_STATE_SNAPSHOTS; } else { process.env.CONFORMANCE_STATE_SNAPSHOTS = snapshots; }
    if (checkpoints === undefined) { delete process.env.CONFORMANCE_REPLAY_CHECKPOINTS; } else { process.env.CONFORMANCE_REPLAY_CHECKPOINTS = checkpoints; }
  });
  it('resumes a proper prefix and preserves complete responses and isolated sibling rejections', () => {
    const initial = board(), cache = new ReplayCheckpointCache('test');
    expect(cache.step(initial, prefix)).toEqual(step(initial, prefix));
    expect(cache.step(initial, prefix)).toEqual(step(initial, prefix));
    expect(cache.stats().entries).toBeGreaterThan(0);
    const branches: NeutralAction[][] = [
      [...prefix, { type: 'endTurn', actor: 'A' }],
      // Deliberately malformed wire input must retain the reference rejection after restoration.
      [...prefix, { type: 'flip', face: 'heads' } as unknown as NeutralAction],
      [...prefix, { type: 'endTurn', actor: 'B' }],
      [...prefix, { type: 'endTurn', actor: 'A' }],
    ];
    for (const actions of branches) { expect(cache.step(initial, actions)).toEqual(step(initial, actions)); }
    expect(cache.stats().hits).toBeGreaterThan(0); expect(cache.stats().decodeFailures).toBe(0);
    expect(cache.stats().avoidedActions).toBeGreaterThan(0);
  });
  it('keeps exact-key checks under forced hash collisions and excludes whole-log hits', () => {
    const initial = board(), cache = new ReplayCheckpointCache('collision', { bytes: 1024 * 1024, entries: 2, entryBytes: 1024 * 1024 }, () => 'same');
    for (let i = 0; i < 3; i++) { expect(cache.step(initial, prefix)).toEqual(step(initial, prefix)); }
    const other = board(); other.turn = 9;
    expect(cache.step(other, prefix)).toEqual(step(other, prefix));
    expect(cache.stats().avoidedActions).toBeLessThan(cache.stats().requests * prefix.length);
  });
  it('evicts bounded entries, clears buffers and declines oversized inputs', () => {
    const initial = board(), cache = new ReplayCheckpointCache('bounded', { bytes: 1024 * 1024, entries: 1, entryBytes: 1024 * 1024 });
    cache.step(initial, prefix); cache.step(initial, prefix);
    const other = board(); other.turn = 7;
    cache.step(other, prefix); cache.step(other, prefix);
    expect(cache.stats().entries).toBeLessThanOrEqual(1); expect(cache.stats().evictions).toBeGreaterThan(0);
    cache.clear(); expect(cache.stats().entries).toBe(0); expect(cache.stats().bytes).toBe(0);
    const tiny = new ReplayCheckpointCache('tiny', { bytes: 50, entries: 1, entryBytes: 50 });
    expect(tiny.step(initial, prefix)).toEqual(step(initial, prefix)); expect(tiny.stats().entries).toBe(0);
  });
  it('canonicalizes property order while preserving action order and omitted values', () => {
    expect(checkpointCanonical({ b: 2, a: 1 })).toBe(checkpointCanonical({ a: 1, b: 2 }));
    expect(checkpointCanonical([1, 2])).not.toBe(checkpointCanonical([2, 1]));
    expect(checkpointCanonical({ a: undefined })).not.toBe(checkpointCanonical({}));
    expect(checkpointCanonical(-0)).not.toBe(checkpointCanonical(0));
  });
  it('uses reference replay when optional key or capture recursion exceeds the stack', () => {
    const initial = board(), cache = new ReplayCheckpointCache('depth');
    let extra: object = {};
    for (let i = 0; i < 12000; i++) { extra = { child: extra }; }
    const deep = { ...initial, extra };
    expect(cache.step(deep, prefix)).toEqual(step(deep, prefix));
    expect(cache.stats().skipped['request-depth']).toBe(1);
    const capture = new ReplayCheckpointCache('capture-depth');
    spyOn((capture as any).codec, 'encode').and.callFake(() => { throw new RangeError('codec depth'); });
    capture.step(initial, prefix);
    expect(capture.step(initial, prefix)).toEqual(step(initial, prefix));
    expect(capture.stats().skipped['capture-depth']).toBeGreaterThan(0);
    expect(capture.stats().entries).toBe(0);
  });
  it('defaults off and refuses invalid configuration before startup', () => {
    delete process.env.CONFORMANCE_REPLAY_CHECKPOINTS; expect(replayCheckpointMode()).toBe('off');
    process.env.CONFORMANCE_REPLAY_CHECKPOINTS = 'bad'; expect(() => createConformanceApp()).toThrowError(/CONFORMANCE_REPLAY_CHECKPOINTS/);
    process.env.CONFORMANCE_REPLAY_CHECKPOINTS = 'on'; process.env.CONFORMANCE_STATE_SNAPSHOTS = 'graph';
    expect(() => createConformanceApp()).toThrowError(/require legacy/);
  });
});
