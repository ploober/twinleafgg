import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralState, NeutralAction, StepResponse, NeutralEvent } from '../neutral-types';
type Request = {
    initialState: NeutralState;
    actions: NeutralAction[];
};
type Moved = Extract<NeutralEvent, {
    kind: 'moved';
}>;
function request(id: number): Request { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ability-closeout', 'TA-' + id + '.json'), 'utf8')); }
function run(q: Request, actions = q.actions): StepResponse { const r = step(q.initialState, actions); expect(r.status).toBe('awaitingAction'); expect(r.applied).toBe(actions.length); return r; }
const moves = (r: StepResponse) => r.events.filter((e): e is Moved => e.kind === 'moved');
const offer = (r: StepResponse, type: string) => r.pending!.legalActions.some(a => a.type === type);
const flip = (face: 'heads' | 'tails'): NeutralAction => ({ actor: 'system', type: 'flip', face });
describe('Recon Directive declares the bottom [TA-798 twm-129]', () => {
    for (const filler of [false, true])
        it('places the remainder at the bottom with filler=' + filler, () => { const q = request(798); if (filler) {
            q.initialState = run(q, q.actions.slice(0, 4)).state;
            q.actions = q.actions.slice(4);
            q.initialState.players.A.deck.push({ iid: 'filler', printing: 'sve-003' });
        } const r = run(q); const legs = moves(r).filter(e => e.card === 'ad1' && e.destination.zone === 'deck'); expect(legs.length).toBe(filler ? 1 : 2); expect(legs.every(e => e.destination.position === 'bottom')).toBe(true); expect(r.state.players.A.deck.map(c => c.iid)).toEqual(filler ? ['filler', 'ad1'] : ['ad1']); });
});
describe('Destructive Horn damage precedes the coin [TA-799 scr-075]', () => {
    it('applies the 80 damage before exposing the flip', () => { const r = run(request(799)); expect(r.state.players.B.active!.damage).toBe(80); expect(offer(r, 'flip')).toBe(true); expect(r.events.some(e => e.kind === 'damaged' && e.target === 'b1s0' && e.hp === 80)).toBe(true); });
    it('tails preserves Energy and ends the attack', () => { const q = request(799); q.initialState = run(q, q.actions.slice(0, 3)).state; q.initialState.players.B.active!.stack = [{ iid: 'b1s0', printing: 'scr-076' }]; q.actions = [q.actions[3], flip('tails')]; const r = run(q); expect(r.state.players.B.active!.damage).toBe(80); expect(r.state.players.B.active!.energy.map(c => c.iid)).toContain('b1e1'); expect(r.pending!.descriptor).toBe('main'); });
    it('heads discards only the chosen Energy after damage', () => { const q = request(799); q.initialState = run(q, q.actions.slice(0, 3)).state; q.initialState.players.B.active!.stack = [{ iid: 'b1s0', printing: 'scr-076' }]; q.actions = [q.actions[3], flip('heads')]; const p = run(q); const a = p.pending!.legalActions.find(a => a.type === 'discard' && a.target === 'b1e1'); expect(a).toBeDefined(); q.actions.push(a as NeutralAction); const r = run(q); expect(r.state.players.B.active!.damage).toBe(80); expect(r.state.players.B.discard.some(c => c.iid === 'b1e1')).toBe(true); const damage = r.events.findIndex(e => e.kind === 'damaged' && e.target === 'b1s0'); expect(moves(r).some(e => e.card === 'b1e1' && e.destination.zone === 'discardPile')).toBe(true); expect(r.events.findIndex(e => e.kind === 'moved' && e.card === 'b1e1' && e.destination.zone === 'discardPile')).toBeGreaterThan(damage); });
});
describe('Drill Run records the choice before damage [TA-800 scr-076]', () => {
    it('keeps Energy attached at the pre-damage choice', () => { const q = request(800); const r = run(q, q.actions.slice(0, -1)); expect(r.state.players.B.active!.damage).toBe(0); expect(r.state.players.B.active!.energy.some(c => c.iid === 'b1e1')).toBe(true); expect(offer(r, 'discard')).toBe(true); });
    for (const lethal of [true, false])
        it('orders chosen, damaged, discard with lethal=' + lethal, () => { const q = request(800); if (!lethal) {
            q.initialState = run(q, q.actions.slice(0, 3)).state;
            q.initialState.players.B.active!.stack = [{ iid: 'b1s0', printing: 'scr-076' }];
            q.actions = q.actions.slice(3);
        } const r = run(q); const chosen = r.events.findIndex(e => e.kind === 'chosen' && e.card === 'b1e1'); const damage = r.events.findIndex(e => e.kind === 'damaged' && e.target === 'b1s0'); const discard = r.events.findIndex(e => e.kind === 'moved' && e.card === 'b1e1' && e.destination.zone === 'discardPile'); expect(chosen).toBeGreaterThan(-1); expect(damage).toBeGreaterThan(chosen); expect(discard).toBeGreaterThan(damage); expect(r.events.some(e => e.kind === 'ko' && e.target === 'b1s0')).toBe(lethal); });
});
describe('Licking Catch reveals its union-filter search [TA-801 wht-019]', () => {
    it('reveals both selected cards and makes their hand legs public', () => { const r = run(request(801)); expect(r.events.filter(e => e.kind === 'reveal').flatMap(e => (e as {
        cards: string[];
    }).cards).sort()).toEqual(['ad16', 'ad20']); for (const iid of ['ad16', 'ad20'])
        expect(moves(r).filter(e => e.card === iid && e.destination.zone === 'hand').map(e => e.visibility)).toEqual(['public']); });
    it('reveals a single selected card when stopping early', () => { const q = request(801); q.actions = q.actions.slice(0, 2); q.actions.push({ actor: 'A', type: 'confirm', value: false }); const r = run(q); expect(r.events.filter(e => e.kind === 'reveal').flatMap(e => (e as {
        cards: string[];
    }).cards)).toEqual(['ad16']); });
    it('allows an empty search without an empty reveal', () => { const q = request(801); q.actions = [q.actions[0], { actor: 'A', type: 'confirm', value: false }]; const r = run(q); expect(r.events.some(e => e.kind === 'reveal')).toBe(false); expect(offer(r, 'shuffle')).toBe(true); });
});
describe('Astonish hides a card again when it enters the deck [TA-802 twm-051]', () => {
    it('reveals the hand-to-deck leg but keeps the later draw owner-only', () => { const r = run(request(802)); expect(moves(r).filter(e => e.card === 'bh1').map(e => [e.origin.zone, e.destination.zone, e.visibility])).toEqual([['hand', 'deck', 'public'], ['deck', 'hand', 'owner']]); expect(r.events.filter(e => e.kind === 'reveal').length).toBe(1); });
    it('preserves a normal shuffle decision with a nonempty deck', () => { const q = request(802); q.initialState.players.B.deck = [{ iid: 'bd-extra', printing: 'sve-003' }]; const p = run(q); expect(offer(p, 'shuffle')).toBe(true); q.actions.push({ actor: 'system', type: 'shuffle', order: ['bh1', 'bd-extra'] }); const r = run(q); expect(moves(r).filter(e => e.card === 'bh1' && e.destination.zone === 'hand').map(e => e.visibility)).toEqual(['owner']); });
});
