/** Tracks the currently registered worker generation, including replacements and late IPC. */
export class ClusterReadiness {
  private members = new Map<number, { pid: number; initializedAtMs?: number; listeningAtMs?: number }>();
  private released = false;

  constructor(private expected: number) { }

  add(id: number, pid: number): void { this.members.set(id, { pid }); }
  remove(id: number): void { this.members.delete(id); }

  initialized(id: number, pid: number, now = Date.now()): number[] {
    const member = this.members.get(id);
    if (member === undefined || member.pid !== pid || member.initializedAtMs !== undefined) { return []; }
    member.initializedAtMs = now;
    if (this.released) { return [id]; }
    if (this.members.size !== this.expected || [...this.members.values()].some(m => m.initializedAtMs === undefined)) {
      return [];
    }
    this.released = true;
    return [...this.members.keys()];
  }

  listening(id: number, pid: number, now = Date.now()): boolean {
    const member = this.members.get(id);
    if (!this.released || member === undefined || member.pid !== pid || member.initializedAtMs === undefined) {
      return false;
    }
    member.listeningAtMs = now;
    return this.snapshot().ready;
  }

  snapshot(): { ready: boolean; expectedWorkers: number; workers: Array<{ id: number; pid: number; initializedAtMs?: number; listeningAtMs?: number }> } {
    const workers = [...this.members].map(([id, member]) => ({ id, ...member }));
    return {
      ready: this.released && workers.length === this.expected && workers.every(w => w.listeningAtMs !== undefined),
      expectedWorkers: this.expected,
      workers,
    };
  }
}
