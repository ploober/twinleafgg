import { ClusterReadiness } from '../http/cluster-readiness';

describe('Conformance cluster startup barrier', () => {
  it('releases no listeners until every registered worker has finished warming', () => {
    const barrier = new ClusterReadiness(3);
    barrier.add(1, 101); barrier.add(2, 102); barrier.add(3, 103);
    expect(barrier.initialized(2, 102, 10)).toEqual([]);
    expect(barrier.initialized(1, 101, 11)).toEqual([]);
    expect(barrier.snapshot().ready).toBe(false);
    expect(barrier.listening(1, 101, 12)).toBe(false);
    expect(barrier.initialized(3, 103, 13)).toEqual([1, 2, 3]);
    expect(barrier.listening(1, 101, 14)).toBe(false);
    expect(barrier.listening(3, 103, 15)).toBe(false);
    expect(barrier.snapshot().ready).toBe(false);
    expect(barrier.listening(2, 102, 16)).toBe(true);
    expect(barrier.snapshot().ready).toBe(true);
  });

  it('does not release a partially registered cluster or accept uninitialized listeners', () => {
    const barrier = new ClusterReadiness(2);
    barrier.add(1, 101);
    expect(barrier.initialized(1, 101)).toEqual([]);
    expect(barrier.listening(1, 101)).toBe(false);
    barrier.add(2, 102);
    expect(barrier.listening(2, 102)).toBe(false);
    expect(barrier.initialized(2, 102)).toEqual([1, 2]);
  });

  it('ignores duplicate initialization and messages for a dead worker or wrong PID', () => {
    const barrier = new ClusterReadiness(2);
    barrier.add(1, 101); barrier.add(2, 102);
    expect(barrier.initialized(1, 999)).toEqual([]);
    expect(barrier.initialized(1, 101)).toEqual([]);
    expect(barrier.initialized(1, 101)).toEqual([]);
    barrier.remove(2);
    expect(barrier.initialized(2, 102)).toEqual([]);
    barrier.add(3, 103);
    expect(barrier.listening(2, 102)).toBe(false);
    expect(barrier.initialized(3, 103)).toEqual([1, 3]);
  });

  it('withdraws readiness on exit and warms a replacement before it can rejoin', () => {
    const barrier = new ClusterReadiness(2);
    barrier.add(1, 101); barrier.add(2, 102);
    barrier.initialized(1, 101); barrier.initialized(2, 102);
    barrier.listening(1, 101); barrier.listening(2, 102);
    expect(barrier.snapshot().ready).toBe(true);
    barrier.remove(2);
    expect(barrier.snapshot().ready).toBe(false);
    barrier.add(3, 103);
    expect(barrier.listening(3, 103)).toBe(false);
    expect(barrier.initialized(2, 102)).toEqual([]);
    expect(barrier.initialized(3, 103)).toEqual([3]);
    expect(barrier.snapshot().ready).toBe(false);
    expect(barrier.listening(3, 103)).toBe(true);
    expect(barrier.snapshot().workers.map(w => w.pid)).toEqual([101, 103]);
  });
});
