import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralState, NeutralAction, StepResponse } from '../neutral-types';
type Request = {
    initialState: NeutralState;
    actions: NeutralAction[];
};
function request(id: number): Request { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ability-closeout', 'TA-' + id + '.json'), 'utf8')); }
function run(q: Request, actions = q.actions): StepResponse { const r = step(q.initialState, actions); expect(r.status).toBe('awaitingAction'); expect(r.applied).toBe(actions.length); return r; }
const offer = (r: StepResponse, type: string) => r.pending!.legalActions.some(a => a.type === type);
const flip = (face: 'heads' | 'tails'): NeutralAction => ({ actor: 'system', type: 'flip', face });
function survival(heads: number, damage = 0): Request { const q = request(808); q.initialState.players.A.active!.damage = damage; q.actions = [q.actions[0], ...Array.from({ length: heads }, () => flip('heads')), flip('tails')]; return q; }
describe('Potent Glare menu agrees with native hand play [TA-809 dri-113]', () => {
    it('withholds and rejects the prohibited Basic', () => { const q = request(809); expect(offer(run(q), 'benchBasic')).toBe(false); expect(step(q.initialState, [{ actor: 'B', type: 'benchBasic', card: 'bh1' }]).status).toBe('invalidAction'); });
    for (const printing of ['dri-081', 'asc-004'])
        it('permits and executes ' + printing, () => { const q = request(809); q.initialState.players.B.hand[0].printing = printing; expect(offer(run(q), 'benchBasic')).toBe(true); const r = run(q, [{ actor: 'B', type: 'benchBasic', card: 'bh1' }]); expect(r.state.players.B.bench.some(b => b.stack.some(c => c.iid === 'bh1'))).toBe(true); });
    it('permits the Fossil Item exception', () => { const q = request(809); q.initialState.players.B.hand[0].printing = 'scr-129'; expect(offer(run(q), 'playItem')).toBe(true); const r = run(q, [{ actor: 'B', type: 'playItem', card: 'bh1' }]); expect(r.state.players.B.bench.some(b => b.stack.some(c => c.iid === 'bh1'))).toBe(true); });
    it('permits a Basic when Arbok is on the Bench', () => { const q = request(809); const a = q.initialState.players.A; const arbok = a.active!; a.active = a.bench[0]; a.bench[0] = arbok; expect(offer(run(q), 'benchBasic')).toBe(true); run(q, [{ actor: 'B', type: 'benchBasic', card: 'bh1' }]); });
    it('does not offer a Basic on a full Bench', () => { const q = request(809); const b = q.initialState.players.B; q.initialState.players.A.active!.stack = [{ iid: 'a0', printing: 'asc-004' }]; while (b.bench.length < 5) {
        const slot = JSON.parse(JSON.stringify(b.bench[0]));
        slot.stack[0].iid = 'extra' + b.bench.length;
        b.bench.push(slot);
    } expect(offer(run(q), 'benchBasic')).toBe(false); });
});
describe('Tenacious Body resolves before lethal damage [TA-808 asc-116]', () => {
    it('waits without applying damage or a KO until the survival answer', () => { const q = survival(3); const r = run(q); expect(offer(r, 'flip')).toBe(true); expect(r.state.players.A.active!.damage).toBe(0); expect(r.events.some(e => e.kind === 'damaged' || e.kind === 'ko')).toBe(false); });
    for (const [heads, damage] of [[3, 0], [1, 0], [0, 50]])
        it('survives heads at ' + heads + ' attack heads with ' + damage + ' prior damage', () => { const q = survival(heads, damage); q.actions.push(flip('heads')); const r = run(q); expect(r.state.players.A.active!.damage).toBe(240); expect(r.state.players.A.active!.stack[0].iid).toBe('a0'); expect(r.events.some(e => e.kind === 'ko')).toBe(false); expect(r.pending!.descriptor).toBe('main'); });
    it('tails causes the KO and the three-Prize decision', () => { const q = survival(3); q.actions.push(flip('tails')); const r = run(q); expect(r.events.some(e => e.kind === 'ko' && e.target === 'a0')).toBe(true); expect(offer(r, 'takePrize')).toBe(true); });
    it('nonlethal damage requires no survival coin', () => { const q = survival(0); const r = run(q); expect(r.state.players.A.active!.damage).toBe(200); expect(offer(r, 'flip')).toBe(false); expect(r.pending!.descriptor).toBe('main'); });
    it('suppression prevents the survival offer', () => { const q = survival(3); q.initialState.stadium = { iid: 'stadium', printing: 'cre-148', owner: 'B' }; const r = run(q); expect(offer(r, 'flip')).toBe(false); expect(r.events.some(e => e.kind === 'ko' && e.target === 'a0')).toBe(true); });
});
