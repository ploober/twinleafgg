import * as fs from 'fs';
import * as path from 'path';
import { step, replay } from '../driver';
import { importState } from '../state-adapter';
import { NeutralState, NeutralAction } from '../neutral-types';
import { BoardEffect } from '../../game/store/card/card-types';
function input(name: string): {initialState: NeutralState; actions: NeutralAction[]} {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/four-followups', name+'.json'), 'utf8'));
}
describe('First-turn once-per-turn reservation and historical labels [TA-830 mew-132 pal-169]', () => {
  it('Ditto reserves its native named use before the search answer', () => {
    const q=input('ditto-start'), g=importState(q.initialState); replay(g,q.actions);
    expect(g.state.players[0].active.boardEffect).toContain(BoardEffect.ABILITY_USED);
    expect(g.state.players[0].active.abilitiesUsedThisTurn).toContain('Transformative Start');
    expect(step(q.initialState,q.actions).state.players.A.active!.markers.abilitiesUsedThisTurn).toContain('Transformative Start');
  });
  it('a declined Ditto search consumes the use and refuses direct replay of it', () => {
    const q=input('ditto-decline'), r=step(q.initialState,q.actions);
    expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toContain('Transformative Start');
    expect(r.pending!.legalActions.some(a=>a.type==='useAbility' && a.ability==='Transformative Start')).toBe(false);
    const retry=step(q.initialState,[...q.actions,q.actions[0]]);
    expect(retry.status).toBe('invalidAction');expect(retry.applied).toBe(q.actions.length);
  });
  it('an exported mid-search state cannot forget the reservation on import', () => {
    const q=input('ditto-start'), r=step(q.initialState,q.actions);
    expect(step(r.state,q.actions).status).toBe('invalidAction');
  });
  it('a successful replacement carries no Ditto use onto the new Pokemon', () => {
    const q=input('ditto-start');
    const actions:NeutralAction[]=[...q.actions,{type:'choose',actor:'A',target:'ad0'},
      {type:'shuffle',actor:'system',order:q.initialState.players.A.deck.filter(c=>c.iid!=='ad0').map(c=>c.iid)}];
    const r=step(q.initialState,actions);expect(r.applied).toBe(actions.length);
    expect(r.state.players.A.active!.stack[0].iid).toBe('ad0');
    expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toEqual([]);
  });
  it('still rejects Ditto after its first turn', () => {
    const q=input('ditto-start');q.initialState.turn=4;
    expect(step(q.initialState,q.actions).status).toBe('invalidAction');
  });
  it('Squawkabilly keeps its native named use and projected label during Motivate', () => {
    const q=input('squawk-motivate'), g=importState(q.initialState);replay(g,q.actions);
    expect(g.state.players[0].usedSquawkAndSeizeThisTurn).toBe(true);
    expect(g.state.players[0].active.abilitiesUsedThisTurn).toContain('Squawk and Seize');
    expect(step(q.initialState,q.actions).state.players.A.active!.markers.abilitiesUsedThisTurn).toContain('Squawk and Seize');
  });
  it('clears the Squawkabilly label once Motivate and its turn actually end', () => {
    const q=input('squawk-motivate');const actions:NeutralAction[]=[...q.actions,{type:'confirm',actor:'A',value:false}];
    const r=step(q.initialState,actions);expect(r.applied).toBe(actions.length);expect(r.state.activePlayer).toBe('B');
    expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toEqual([]);
  });
});
