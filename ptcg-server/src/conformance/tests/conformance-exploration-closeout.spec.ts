import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralAction, NeutralState, StepResponse } from '../neutral-types';
interface Case {
  id: string;
  request: { initialState: NeutralState; actions: NeutralAction[] };
  expected: { status: string; applied: number; menu?: object[]; checks: [string, unknown][]; absent: object[] };
}
const cases: Case[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/exploration-closeout/cases.json'), 'utf8'));
// Expected results are authored from the printed effects and the agreed wire verbs,
// never copied from either engine. Optional decision metadata is tested elsewhere.
function menu(action: object): string {
  return JSON.stringify(Object.entries(action).filter(([key]) =>
    ['actor', 'type', 'card', 'source', 'target', 'recipient', 'ability', 'name', 'value', 'index'].includes(key)
  ).sort(([a], [b]) => a.localeCompare(b)));
}
function value(result: StepResponse, key: string): unknown {
  const parts = key.split('.');
  let current: any = result;
  if (parts[0] === 'pokemon') {
    const iid = parts[1];
    current = Object.values(result.state.players).flatMap(p => [p.active, ...p.bench])
      .find(p => p?.stack.some(c => c.iid === iid));
    parts.splice(0, 2);
  }
  for (const part of parts) { current = current?.[part]; }
  return current;
}
describe('Exploration closeout [TA-812 svi-076] [TA-813 sfa-059] [TA-814 meg-101] [TA-815 pal-015]', () => {
  for (const cell of cases) {
    it(cell.id, () => {
      const r = step(cell.request.initialState, cell.request.actions);
      expect(r.status).toBe(cell.expected.status);
      expect(r.applied).toBe(cell.expected.applied);
      const actual = (r.pending?.legalActions || []).map(menu).sort();
      if (cell.expected.menu) { expect(actual).toEqual(cell.expected.menu.map(menu).sort()); }
      for (const [key, expected] of cell.expected.checks) { expect({ path: key, value: value(r, key) }).toEqual({ path: key, value: expected }); }
      for (const action of cell.expected.absent) { expect(actual).not.toContain(menu(action)); }
    });
  }
});
