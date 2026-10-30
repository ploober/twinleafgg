import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralState, NeutralAction, NeutralPlayerId } from '../neutral-types';
function fixtures():Array<{receiverSlots:string;request:{initialState:NeutralState;actions:NeutralAction[]}}> {
 return JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/four-followups/peer-slot-cases.json'),'utf8'));
}
describe('Transformation Tome replacement metadata uses the actual receiver [CF-70 cri-083 receiver slots]',()=>{
 for(const fmt of ['standard','unlimited'] as const) for(const fixture of fixtures()) {
  it(fmt+' seat '+fixture.request.actions[0].actor+' '+fixture.receiverSlots+' slot metadata and continuation controls',()=>{
   const q=JSON.parse(JSON.stringify(fixture.request)) as {initialState:NeutralState;actions:NeutralAction[]};q.initialState.format=fmt;
   const actor=q.actions[0].actor as NeutralPlayerId;
   const start=step(q.initialState,q.actions);expect(start.applied).toBe(1);
   const receivers=fixture.receiverSlots==='ambiguous'?['source','receiver']:[undefined];
   if(fixture.receiverSlots==='ambiguous') {
    expect(start.pending!.legalActions.filter(a=>a.type==='choose').map(a=>a.target).sort()).toEqual(['receiver','source']);
   }
   for(const receiver of receivers) {
    const prefix=receiver?[...q.actions,{type:'choose',actor,target:receiver} as NeutralAction]:q.actions;
    const response=step(q.initialState,prefix);expect(response.applied).toBe(prefix.length);
    const destination=receiver?(receiver==='source'?'active':'bench'):fixture.receiverSlots;
    const picks=response.pending!.legalActions.filter(a=>a.type==='choose');
    expect(picks.map(a=>a.target).sort()).toEqual(['replacement1','replacement2']);
    expect(picks.every(a=>a.op==='moveTo' && a.destination===destination)).toBe(true);
    for(const mode of ['omit','echo','wrong-destination','wrong-operation','wrong-actor','wrong-target']) {
     const answer:any={type:'choose',actor,target:'replacement1'};
     if(mode!=='omit'){answer.op='moveTo';answer.destination=destination;}
     if(mode==='wrong-destination')answer.destination=destination==='active'?'bench':'active';
     if(mode==='wrong-operation')answer.op='discard';
     if(mode==='wrong-actor')answer.actor=actor==='A'?'B':'A';
     if(mode==='wrong-target')answer.target='missing-card';
     const result=step(q.initialState,[...prefix,answer]);
     if(mode==='omit'||mode==='echo') {
      expect(result.applied).toBe(prefix.length+1);
      const player=result.state.players[actor];const slot=destination==='active'?player.active!:player.bench[0];
      expect(slot.stack[0].iid).toBe('replacement1');expect(player.discard.some(c=>c.iid==='t1')).toBe(true);expect(player.discard.some(c=>c.iid==='t2')).toBe(true);
     }else{
      expect(result.status).toBe('invalidAction');expect(result.applied).toBe(prefix.length);
      expect(result.state).toEqual(response.state);expect(result.events).toEqual(response.events);
     }
    }
   }
  });
 }
});
