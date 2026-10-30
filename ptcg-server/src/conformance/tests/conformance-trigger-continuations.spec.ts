import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralState, NeutralAction, StepResponse } from '../neutral-types';
interface Cell {
  id: string; initialState: NeutralState; prefix: NeutralAction[]; suffix: NeutralAction[];
  actor: 'A' | 'B'; usedIid: string; ability: string; accepted: boolean; expectTrigger: boolean;
}
const cells: Cell[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/trigger-continuations.json'), 'utf8'));
function menu(r: StepResponse): string[] {
  return (r.pending?.legalActions || []).map(a => JSON.stringify(Object.entries(a).sort())).sort();
}
function labels(r: StepResponse, c: Cell): string[] {
  const p = r.state.players[c.actor];
  return [p.active, ...p.bench].find(s => s?.stack.some(a => a.iid === c.usedIid))!.markers.abilitiesUsedThisTurn;
}
// Printed once-per-turn clauses; #43: declining a trigger is not using the Ability.
// Checkpoints are settled main-phase boards, not suspended prompts.
describe('Triggered Ability export/reload [TA-827 meg-038] [TA-827 meg-141] [TA-827 dri-003]', () => {
  for (const c of cells) {
    it(c.id, () => {
      const prefix = step(c.initialState, c.prefix);
      expect(prefix.applied).toBe(c.prefix.length);
      expect(prefix.pending?.descriptor).toBe('main');
      expect(labels(prefix, c).includes(c.ability)).toBe(c.accepted);
      const continuous = step(c.initialState, [...c.prefix, ...c.suffix]);
      const resumed = step(prefix.state, c.suffix);
      expect(continuous.applied).toBe(c.prefix.length + c.suffix.length);
      expect(resumed.applied).toBe(c.suffix.length);
      for (const r of [continuous, resumed]) {
        expect(r.status).toBe('awaitingAction');
        expect(r.pending?.legalActions.some(a => a.type === 'confirm' && a.value === true)).toBe(c.expectTrigger);
      }
      expect(menu(resumed)).toEqual(menu(continuous));
      expect(labels(resumed, c)).toEqual(labels(continuous, c));
    });
  }
});
