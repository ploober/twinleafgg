import { NeutralAction, NeutralState, StepResponse } from './neutral-types';
import { ImportedGame } from './state-adapter';

/** Optional diagnostics; never installed by normal gameplay or conformance execution. */
export interface ReplayObservation {
  measure<T>(phase: string, operation: () => T): T;
  boundary(game: ImportedGame, applied: number, reason?: string): void;
  finish(response?: StepResponse, error?: unknown): void;
}
export interface ReplayObserver {
  begin(initial: NeutralState, actions: NeutralAction[], recursive: boolean): ReplayObservation;
}
let observer: ReplayObserver | undefined;
let current: ReplayObservation | undefined;
export function setReplayObserver(value?: ReplayObserver): void { observer = value; }
export function replayObservation(): ReplayObservation | undefined { return current; }
export function measureReplay<T>(phase: string, operation: () => T): T {
  return current === undefined ? operation() : current.measure(phase, operation);
}
export function observeReplay(initial: NeutralState, actions: NeutralAction[], operation: () => StepResponse): StepResponse {
  if (observer === undefined) { return operation(); }
  const parent = current;
  const observation = observer.begin(initial, actions, parent !== undefined);
  current = observation;
  let response: StepResponse | undefined;
  let failure: unknown;
  try { response = operation(); return response; }
  catch (error) { failure = error; throw error; }
  finally { try { observation.finish(response, failure); } finally { current = parent; } }
}
