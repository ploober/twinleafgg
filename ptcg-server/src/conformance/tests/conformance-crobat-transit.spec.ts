import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralAction, NeutralState } from '../neutral-types';
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/crobat-transit.json'), 'utf8'));
function swap(v: any): any {
  if (typeof v === 'string') { return v === 'A' ? 'B' : v === 'B' ? 'A' : v; }
  if (Array.isArray(v)) { return v.map(swap); }
  if (v && typeof v === 'object') { return Object.fromEntries(Object.entries(v).map(([k,x]) => [swap(k),swap(x)])); }
  return v;
}
describe('Crobat held search destination [TA-816 cri-051]', () => {
  for (const owner of ['A', 'B'] as const) {
    it(`keeps the ${owner} pick private and above the shuffled remainder until next draw`, () => {
      const q = owner === 'A' ? JSON.parse(JSON.stringify(fixture)) : swap(fixture);
      const initial = q.initialState as NeutralState;
      const actions = q.actions as NeutralAction[];
      const held = step(initial, actions);
      expect(held.status).toBe('awaitingAction');
      expect(held.applied).toBe(actions.length);
      expect(held.state.players[owner].transit).toEqual([{
        iid: 'ad0', printing: 'sve-003', origin: {zone: 'deck'},
        destination: {zone: 'deck', position: 'top'}, visibility: 'owner'
      }]);
      const deck = (held.pending!.legalActions[0] as any).deck as string[];
      expect(deck).not.toContain('ad0');
      expect(deck.length).toBe(19);
      const order = [...deck].reverse();
      actions.push({ actor: 'system', type: 'shuffle', order } as NeutralAction);
      const placed = step(initial, actions);
      expect(placed.applied).toBe(actions.length);
      expect(placed.state.players[owner].transit ?? []).toEqual([]);
      expect(placed.state.players[owner].deck.map(c => c.iid)).toEqual(['ad0', ...order]);
      actions.push({actor: owner, type: 'endTurn'}, {actor: owner === 'A' ? 'B' : 'A', type: 'endTurn'});
      const drawn = step(initial, actions);
      expect(drawn.applied).toBe(actions.length);
      expect(drawn.state.activePlayer).toBe(owner);
      expect(drawn.state.players[owner].hand.map(c => c.iid)).toContain('ad0');
      expect(drawn.state.players[owner].deck.map(c => c.iid)).toEqual(order);
    });
  }
});
