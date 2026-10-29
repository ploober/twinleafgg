import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralState, NeutralAction, StepResponse } from '../neutral-types';
function request(id: string): { initialState: NeutralState; actions: NeutralAction[] } {
  return JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/ability-followup',id+'.json'),'utf8'));
}
function main(r: StepResponse, count: number): void {
  expect(r.status).toBe('awaitingAction'); expect(r.applied).toBe(count);
  expect(r.pending!.descriptor).toBe('main');
}
function envoy(r: StepResponse): boolean {
  return (r.pending?.legalActions || []).some(a=>a.type==='useAbility'&&a.ability==='Shadowy Envoy');
}
describe('Shadowy Envoy after a real Janine play', () => {
  it('draws to eight after Janine resolves [TA-807 sfa-029]', () => {
    const q=request('shadowy-envoy');const r=step(q.initialState,q.actions);main(r,q.actions.length);
    expect(r.state.players.A.hand.length).toBe(8);
    expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toContain('Shadowy Envoy');
  });
  it('withholds the ability before Janine is played [TA-807 no-Janine]', () => {
    const q=request('shadowy-envoy'); expect(envoy(step(q.initialState,[]))).toBe(false);
    expect(step(q.initialState,[q.actions[q.actions.length - 1]]).status).toBe('invalidAction');
  });
  it('still allows the ability after a legal empty search [TA-807 failed-search]', () => {
    const q=request('shadowy-envoy');const actions: NeutralAction[]=[...q.actions.slice(0,3),{actor:'A',type:'confirm',value:false},
      {actor:'system',type:'shuffle',order:q.initialState.players.A.deck.map(c=>c.iid)},q.actions[q.actions.length - 1]];
    const r=step(q.initialState,actions);main(r,q.actions.length);expect(r.state.players.A.hand.length).toBe(8);
  });
  it('does not offer a draw with eight cards already in hand [TA-807 hand-limit]', () => {
    const q=request('shadowy-envoy');for(let i=0;i<8;i++)q.initialState.players.A.hand.push({iid:'extra'+i,printing:'sve-003'});
    const r=step(q.initialState,q.actions.slice(0,-1));main(r,q.actions.length - 1);expect(r.state.players.A.hand.length).toBe(8);
    expect(envoy(r)).toBe(false);expect(step(q.initialState,q.actions).status).toBe('invalidAction');
  });
  it('refuses a second use after the hand drops below eight [TA-807 once-per-turn]', () => {
    const q=request('shadowy-envoy');const actions: NeutralAction[]=[...q.actions,{actor:'A',type:'attachEnergy',card:'ad1',target:'a0'}];
    const r=step(q.initialState,actions);main(r,q.actions.length + 1);expect(r.state.players.A.hand.length).toBe(7);expect(envoy(r)).toBe(false);
    expect(step(q.initialState,[...actions,q.actions[q.actions.length - 1]]).status).toBe('invalidAction');
  });
  it('clears both markers so a fresh Janine play works next turn [TA-807 next-turn]', () => {
    const q=request('shadowy-envoy');q.initialState.players.A.deck[1].printing='sfa-059';q.initialState.players.A.deck[2].printing='svi-194';
    const actions: NeutralAction[]=[...q.actions,{actor:'A',type:'endTurn'},{actor:'B',type:'endTurn'},
      {actor:'A',type:'playItem',card:'ad2'},{actor:'A',type:'promoteBench',target:'ab2'},
      {actor:'A',type:'playSupporter',card:'ad1'},
      {actor:'A',type:'choose',target:'a0'},{actor:'A',type:'confirm',value:false},
      {actor:'system',type:'shuffle',order:q.initialState.players.A.deck.slice(10).map(c=>c.iid)},q.actions[q.actions.length - 1]];
    const r=step(q.initialState,actions);main(r,actions.length);expect(r.state.players.A.hand.length).toBe(8);
    expect(r.state.players.A.bench.some(b=>b.stack.some(c=>c.iid==='a0')&&b.markers.abilitiesUsedThisTurn.includes('Shadowy Envoy'))).toBe(true);
  });
});
describe('Metal Road requires another Pokemon with eligible Energy', () => {
  for(const printing of ['064','103']) {
    it('withholds an empty-source offer for '+printing+' [TA-810 empty-source]', () => {
      const q=request('re288-cri-'+printing+'-empty');const r=step(q.initialState,q.actions);main(r,q.actions.length);
      expect(r.state.players.A.active!.stack[0].printing).toBe('cri-'+printing);
      expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toEqual([]);
    });
    it('offers both choices with a real source for '+printing+' [TA-810 source-offer]', () => {
      const q=request('re288-cri-'+printing+'-source');const r=step(q.initialState,q.actions);
      expect(r.applied).toBe(q.actions.length);expect(r.state.players.A.active!.stack[0].printing).toBe('cri-'+printing);
      expect(r.pending!.legalActions.filter(a=>a.type==='confirm').map(a=>(a as {value:boolean}).value).sort()).toEqual([false,true]);
    });
    it('declining does not consume the use for '+printing+' [TA-810 decline]', () => {
      const q=request('re288-cri-'+printing+'-source');q.actions.push({actor:'A',type:'confirm',value:false});
      const r=step(q.initialState,q.actions);main(r,q.actions.length);expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toEqual([]);
      expect(r.state.players.A.bench.some(b=>b.energy.some(e=>e.iid==='a3e0'))).toBe(true);
    });
    it('transfers Metal from the actual source for '+printing+' [TA-810 transfer]', () => {
      const q=request('re288-cri-'+printing+'-source');q.actions.push({actor:'A',type:'confirm',value:true});
      const prompt=step(q.initialState,q.actions);const move=prompt.pending!.legalActions.find(a=>a.type==='choose' && a.target==='a3e0');
      expect(move).toBeDefined();q.actions.push(move as NeutralAction);
      const r=step(q.initialState,q.actions);main(r,q.actions.length);
      expect(r.state.players.A.active!.energy.some(e=>e.iid==='a3e0')).toBe(true);
      expect(r.state.players.A.bench.some(b=>b.energy.some(e=>e.iid==='a3e0'))).toBe(false);
      expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toContain('Metal Road');
    });
  }
});
