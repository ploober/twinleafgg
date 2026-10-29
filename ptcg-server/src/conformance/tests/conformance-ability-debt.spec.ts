import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralState, NeutralAction, StepResponse } from '../neutral-types';

// Frozen public-wire witnesses from pmtcg-conformance-tests, 2026-10-29.
// AF-004 predates the required owner discard choice; keep it unchanged and insert
// that action explicitly below, asserting both options before resolving either.
function request(id: string): { initialState: NeutralState; actions: NeutralAction[] } {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ability-debt', id + '.json'), 'utf8'));
}
function run(id: string): StepResponse {
  const q = request(id); return step(q.initialState, q.actions);
}
function main(r: StepResponse, applied: number): void {
  expect(r.status).toBe('awaitingAction'); expect(r.applied).toBe(applied);
  expect(r.pending!.legalActions.some(a => a.type === 'endTurn')).toBe(true);
}
function offers(r: StepResponse, type: string): boolean {
  return (r.pending?.legalActions || []).some(a => a.type === type);
}

describe('Ability debt: TA-211 / TA-803–806', () => {
  for (const id of ['AF-001', 'AF-003']) {
    it(id + ': attaches the second Tool after benching or directly from import [TA-211 pfl-029]', () => {
      const q = request(id), r = run(id); main(r, q.actions.length);
      expect(r.state.players.A.bench[0].tools.map(t => t.iid).sort()).toEqual(['abt2', 'ah1']);
      expect(r.state.players.A.hand.some(c => c.iid === 'ah1')).toBe(false);
    });
  }
  it('rejects a third Tool, even with two providers [TA-211 pfl-029]', () => {
    const q = request('AF-003'), a = q.initialState.players.A;
    a.bench[1].stack = [{iid: 'ab2', printing: 'pfl-029'}];
    a.bench[0].tools.push({iid: 'extra', printing: 'meg-166'});
    expect(offers(step(q.initialState, []), 'attachTool')).toBe(true); // other targets still accept one
    expect(step(q.initialState, q.actions).status).toBe('invalidAction');
  });
  for (const control of ['absent', 'opponent', 'non-Rotom', 'suppressed']) {
    it('does not grant a second Tool: ' + control, () => {
      const q = request('AF-003'), a = q.initialState.players.A, b = q.initialState.players.B;
      if (control === 'absent' || control === 'opponent') { a.active!.stack = [{iid:'a0',printing:'asc-004'}]; }
      if (control === 'opponent') { b.active!.stack = [{iid:'b0',printing:'pfl-029'}]; }
      if (control === 'non-Rotom') { a.bench[0].stack = [{iid:'ab1',printing:'asc-004'}]; }
      if (control === 'suppressed') { b.active!.stack = [{iid:'b0',printing:'svi-096'}]; }
      const menu = step(q.initialState, []);
      expect(menu.pending!.legalActions.some(x => x.type === 'attachTool' && x.target === 'ab1')).toBe(false);
      expect(step(q.initialState, q.actions).status).toBe('invalidAction');
    });
  }
  it('does not leak capacity into a subsequent game using the same printing', () => {
    main(run('AF-001'), 2);
    const q = request('AF-003'); q.initialState.players.A.active!.stack = [{iid:'a0',printing:'asc-004'}];
    expect(step(q.initialState, q.actions).status).toBe('invalidAction');
  });
  for (const discarded of ['abt1', 'abt2']) {
    it('asks the owner which excess Tool to discard after KO: ' + discarded, () => {
      const q = request('AF-004'), prefix = q.actions.slice(0, 1);
      const paused = step(q.initialState, prefix);
      expect(paused.status).toBe('awaitingAction'); expect(paused.pending!.actor).toBe('A');
      expect(paused.pending!.legalActions.filter(x => x.type === 'discard').map(x => (x as {target:string}).target).sort()).toEqual(['abt1','abt2']);
      expect(paused.state.players.A.bench[0].tools.length).toBe(2);
      const actions: NeutralAction[] = [...prefix, {type:'discard',actor:'A',owner:'A',target:discarded}, ...q.actions.slice(1)];
      const r = step(q.initialState, actions); main(r, actions.length);
      expect(r.state.players.A.active!.tools.map(t => t.iid)).toEqual([discarded === 'abt1' ? 'abt2' : 'abt1']);
      expect(r.state.players.A.discard.filter(c => c.iid === discarded).length).toBe(1);
    });
  }
  it('keeps both Tools when another provider survives the KO', () => {
    const q = request('AF-004'); q.initialState.players.A.bench[1].stack = [{iid:'ab2',printing:'pfl-029'}];
    const r = step(q.initialState, q.actions); main(r, q.actions.length);
    expect(r.state.players.A.active!.tools.length).toBe(2);
  });
  it('heals with a Benched Grass Mega partner [TA-803 pfl-007]', () => {
    const r = run('AF-002'); main(r, 1); expect(r.state.players.A.active!.damage).toBe(0);
  });
  it('also heals with an Active Grass Mega partner', () => {
    const q = request('AF-002'), a = q.initialState.players.A;
    [a.active, a.bench[0]] = [a.bench[0], a.active!];
    const r = step(q.initialState,q.actions); main(r,1); expect(r.state.players.A.bench[0].damage).toBe(0);
  });
  for (const control of ['absent','ordinary-Grass','opponent','buried']) {
    it('withholds Excited Heal without a qualifying in-play partner: ' + control, () => {
      const q = request('AF-002'), a = q.initialState.players.A;
      if (control === 'opponent') { q.initialState.players.B.bench = [a.bench[0]]; a.bench.splice(0,1); }
      else if (control === 'buried') { a.bench[0].stack.push({iid:'cover',printing:'asc-004'}); }
      else if (control === 'ordinary-Grass') { a.bench[0].stack.pop(); }
      else { a.bench.splice(0,1); }
      expect(offers(step(q.initialState, []),'useAbility')).toBe(false);
      expect(step(q.initialState, q.actions).status).toBe('invalidAction');
    });
  }
  it('projects Fan Call as used while its search is still pending [TA-806 scr-118]', () => {
    const r = run('reservation'); expect(r.applied).toBe(1);
    expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toContain('Fan Call');
    expect(r.pending!.legalActions.some(a => a.type === 'choose')).toBe(true);
  });
  it('consumes Fan Call on an empty search for every copy [TA-805 scr-118]', () => {
    const q = request('empty-search-shared-limit'), r = run('empty-search-shared-limit'); main(r,q.actions.length);
    expect((r.pending!.legalActions as Array<{ability?:string}>).some(a => a.ability === 'Fan Call')).toBe(false);
    for (const source of ['a0','ab1']) {
      expect(step(q.initialState,[...q.actions,{type:'useAbility',actor:'A',source,ability:'Fan Call'}]).status).toBe('invalidAction');
    }
  });
  it('consumes Fan Call after finding a Pokemon and shuffling the remaining deck', () => {
    const q = request('reservation');
    const actions: NeutralAction[] = [...q.actions,{type:'choose',actor:'A',target:'ad0'},
      {type:'shuffle',actor:'system',order:q.initialState.players.A.deck.filter(c=>c.iid!=='ad0').map(c=>c.iid)}];
    const r = step(q.initialState, actions); main(r,actions.length);
    expect(r.state.players.A.hand.some(c => c.iid==='ad0')).toBe(true);
    expect((r.pending!.legalActions as Array<{ability?:string}>).some(a => a.ability === 'Fan Call')).toBe(false);
  });
  it('still refuses Fan Call after the first turn', () => {
    const q = request('reservation'); q.initialState.turn = 3;
    expect(step(q.initialState,q.actions).status).toBe('invalidAction');
  });
});
