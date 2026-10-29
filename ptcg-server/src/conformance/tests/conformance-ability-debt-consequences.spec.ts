import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';
function request(id: string): { initialState: NeutralState; actions: NeutralAction[] } {
  return JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/ability-debt',id+'.json'),'utf8'));
}
describe('Multi Adapter loss consequences', () => {
  it('requires cleanup immediately after suppression enters play', () => {
    const q=request('AF-003'), a=q.initialState.players.A, b=q.initialState.players.B;
    a.bench[0].tools.push({iid:'extra',printing:'meg-166'});
    const klefki=JSON.parse(JSON.stringify(b.active));klefki.stack=[{iid:'klefki',printing:'svi-096'}];klefki.energy=[];
    b.bench=[klefki];q.initialState.activePlayer='B';b.hand.push({iid:'switch',printing:'svi-194'});
    const actions: NeutralAction[]=[{type:'playItem',actor:'B',card:'switch'}];
    const pending=step(q.initialState,actions);
    expect(pending.pending!.actor).toBe('A');
    expect(pending.pending!.legalActions.some(x=>x.type==='discard'&&x.target==='extra')).toBe(true);
    actions.push({type:'discard',actor:'A',owner:'A',target:'extra'});
    const r=step(q.initialState,actions);
    expect(r.applied).toBe(2);expect(r.pending!.descriptor).toBe('main');
    expect(r.state.players.A.bench[0].tools.map(c=>c.iid)).toEqual(['abt2']);
  });
  it('requires cleanup when the last provider returns to the hand [TA-804 pfl-029]', () => {
    const q=request('AF-003'), a=q.initialState.players.A;
    a.bench[0].tools.push({iid:'extra',printing:'meg-166'});a.hand.push({iid:'turo',printing:'par-171'});
    const actions: NeutralAction[]=[{type:'playSupporter',actor:'A',card:'turo'},{type:'choose',actor:'A',target:'a0'}];
    const pending=step(q.initialState,actions);
    expect(pending.pending!.legalActions.some(x=>x.type==='discard')).toBe(true);
    actions.push({type:'discard',actor:'A',owner:'A',target:'extra'},{type:'promoteBench',actor:'A',target:'ab1'});
    const r=step(q.initialState,actions);
    expect(r.applied).toBe(4);expect(r.pending!.descriptor).toBe('main');
    expect(r.state.players.A.active!.tools.map(c=>c.iid)).toEqual(['abt2']);
    expect(r.state.players.A.hand.some(c=>c.iid==='a0')).toBe(true);
  });
  it('resolves the further KO caused by discarding an HP Tool before Prizes and promotion', () => {
    const q=request('AF-004'), a=q.initialState.players.A;
    a.bench[0].tools[0].printing='tef-152';a.bench[0].damage=80;
    const actions: NeutralAction[]=[q.actions[0],{type:'discard',actor:'A',owner:'A',target:'abt1'}];
    const pending=step(q.initialState,actions);
    expect(pending.applied).toBe(2);
    expect(pending.state.players.A.bench.every(b=>b.stack.every(c=>c.iid!=='ab1'))).toBe(true);
    expect(pending.state.players.A.discard.filter(c=>c.iid==='ab1').length).toBe(1);
    for (let index=0;index<3;index++) actions.push({type:'takePrize',actor:'B',index});
    const prizes=step(q.initialState,actions);
    expect(prizes.pending!.legalActions.some(x=>x.type==='promoteBench' && x.target==='ab2')).toBe(true);
    actions.push({type:'promoteBench',actor:'A',target:'ab2'});
    const r=step(q.initialState,actions);
    expect(r.applied).toBe(6);expect(r.status).toBe('awaitingAction');
    // The non-turn player still supplies the promotion decision.
    expect(r.state.players.A.active!.stack[0].iid).toBe('ab2');
    expect(r.state.players.B.prizes.filter(c=>c.faceUp).length).toBe(0);
    expect(r.state.players.B.prizes.length).toBe(3);
  });
});
