import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { liftToTransit } from '../transit-projection';
import { NeutralAction, NeutralState, StepResponse } from '../neutral-types';

function fixture(): { initialState: NeutralState; actions: NeutralAction[] } {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ability-closeout/TA-811.json'), 'utf8'));
}
function run(state: NeutralState, actions: NeutralAction[]): StepResponse {
  const result = step(state, actions);
  expect(result.status).toBe('awaitingAction');
  expect(result.applied).toBe(actions.length);
  return result;
}

describe('Public selections stay visible [TA-811 obf-193]', () => {
  for (const source of ['active', 'bench'] as const) {
    for (const count of [1, 2]) {
      it(`keeps ${count} Energy public from the ${source} through placement`, () => {
        const q = fixture();
        if (source === 'bench') {
          const a = q.initialState.players.A;
          const active = a.active!;
          a.active = a.bench[0];
          a.bench[0] = active;
        }
        const actions = q.actions.slice(0, 2 + count);
        const picked = ['a0e0', 'a0e1'].slice(0, count);
        const pending = run(q.initialState, actions);
        expect(pending.state.players.A.transit!.map(t => t.iid)).toEqual(picked);
        for (const card of pending.state.players.A.transit!) {
          expect(card.visibility).toBe('public');
          expect(card.origin).toEqual({ zone: source, pokemon: 'a0', role: 'energy' });
        }
        if (count === 1) {
          actions.push({ actor: 'A', type: 'confirm', value: false } as NeutralAction);
          expect(run(q.initialState, actions).state.players.A.transit![0].visibility).toBe('public');
        }
        actions.push(q.actions[4]);
        const done = run(q.initialState, actions);
        const a = done.state.players.A;
        const destination = [a.active, ...a.bench].find(p => p?.stack[0].iid === 'a1')!;
        expect(destination.energy.map(e => e.iid)).toEqual(jasmine.arrayContaining(picked));
        expect(a.transit ?? []).toEqual([]);
        const moves = done.events.filter(e => e.kind === 'moved' && picked.includes(e.card));
        expect(moves.length).toBeGreaterThan(0);
        expect(moves.every(e => e.kind === 'moved' && e.visibility === 'public')).toBe(true);
      });
    }
  }

  for (const zone of ['hand', 'deck', 'discard', 'lostZone'] as const) {
    it(`preserves the visibility of a ${zone} selection`, () => {
      const state = fixture().initialState;
      const card = state.players.A.active!.energy.shift()!;
      state.players.A[zone].push(card);
      expect(liftToTransit(state, card.iid, { visibility: 'owner' })).toBe(true);
      const held = state.players.A.transit!.find(t => t.iid === card.iid)!;
      expect(held.visibility).toBe(zone === 'hand' || zone === 'deck' ? 'owner' : 'public');
    });
  }

  it('keeps public origin visibility when a held selection is projected again', () => {
    const state = fixture().initialState;
    liftToTransit(state, 'a0e0', { visibility: 'owner' });
    liftToTransit(state, 'a0e0', { visibility: 'owner' });
    expect(state.players.A.transit!.filter(t => t.iid === 'a0e0').length).toBe(1);
    expect(state.players.A.transit![0].visibility).toBe('public');
  });
});
