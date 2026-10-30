import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { importState } from '../state-adapter';
import { NeutralState, NeutralAction } from '../neutral-types';
import { ResolvePromptAction } from '../../game/store/actions/resolve-prompt-action';
import { PowerEffect } from '../../game/store/effects/game-effects';
import { PlayerType, SlotType } from '../../game/store/actions/play-card-action';
function input(two=false): {initialState: NeutralState; actions: NeutralAction[]} {
  const q=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/four-followups/shocks-start.json'),'utf8'));
  if(two)q.initialState.players.A.discard.push({iid:'ax2',printing:'sve-006'});
  return q;
}
describe('Magnetic Absorption is restricted to its source [TA-831 par-108]', () => {
  it('one Energy and the forced Active source resolve without a recipient prompt', () => {
    const q=input(),r=step(q.initialState,q.actions);
    expect(r.applied).toBe(1);expect(r.state.players.A.active!.energy.map(c=>c.iid)).toEqual(['ax1']);
    expect(r.pending!.descriptor).toBe('main');expect(r.pending!.legalActions.some(a=>a.type==='attachEnergy' && a.card==='ax1')).toBe(false);
  });
  it('also forces the exact source when it is Benched', () => {
    const q=input(),a=q.initialState.players.A,source=a.active!;a.active=a.bench[0];a.bench[0]=source;
    const r=step(q.initialState,q.actions);expect(r.applied).toBe(1);
    expect(r.state.players.A.bench[0].energy.map(c=>c.iid)).toEqual(['ax1']);expect(r.state.players.A.active!.energy).toEqual([]);
  });
  it('two eligible Energy cards remain a genuine choice, both to the same source', () => {
    const q=input(true),r=step(q.initialState,q.actions);
    const picks=r.pending!.legalActions.filter(a=>a.type==='choose' && a.op==='attach');
    expect(picks.length).toBe(2);expect(picks.every(a=>a.recipient==='a0')).toBe(true);
    const actions:NeutralAction[]=[...q.actions,{type:'choose',actor:'A',target:'ax2',op:'attach',recipient:'a0'}];
    const done=step(q.initialState,actions);expect(done.applied).toBe(2);
    expect(done.state.players.A.active!.energy.map(c=>c.iid)).toEqual(['ax2']);
    expect(done.state.players.A.discard.map(c=>c.iid)).toEqual(['ax1']);
  });
  it('refuses a forged unrelated-recipient continuation without moving the Energy', () => {
    const q=input(true),r=step(q.initialState,[...q.actions,{type:'choose',actor:'A',target:'ax1',op:'attach',recipient:'ab1'}]);
    expect(r.status).toBe('invalidAction');expect(r.applied).toBe(1);
    expect(r.state.players.A.discard.map(c=>c.iid)).toEqual(['ax1','ax2']);expect(r.state.players.A.bench[0].energy).toEqual([]);
  });
  it('native: refuses the wrong recipient even when a caller bypasses the wire menu', () => {
    const q=input(true),g=importState(q.initialState),player=g.state.players[0],card=player.active.getPokemonCard()!;
    g.store.reduceEffect(g.state,new PowerEffect(player,card.powers[0],card));
    const prompt=g.state.prompts.find(p=>p.result===undefined)!;expect(prompt).toBeDefined();
    expect(()=>g.store.dispatch(new ResolvePromptAction(prompt.id,[{index:0,to:{player:PlayerType.BOTTOM_PLAYER,slot:SlotType.BENCH,index:0}}]))).toThrow();
    expect(g.store.state.players[0].bench[0].cards.some(c=>c.name==='Fighting Energy')).toBe(false);
  });
  it('still withholds the Ability when the opponent has five Prizes', () => {
    const q=input();q.initialState.players.B.prizes.push({iid:'bp4',printing:'sve-003',faceUp:false});q.initialState.players.B.flags.prizesTaken=1;
    expect(step(q.initialState,q.actions).status).toBe('invalidAction');
  });
});
