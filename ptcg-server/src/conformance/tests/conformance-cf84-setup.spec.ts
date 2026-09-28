import { step } from '../driver';
import { handleStep, BadRequestError } from '../http/handlers';
import { NeutralState, PlayerState, PlayerFlags, CardRef, SCHEMA_VERSION, NeutralAction } from '../neutral-types';

/**
 * CF-84 — the setup walk. A PRE-DEAL `initialState` (phase setup, turn 0, firstPlayer null, empty boards,
 * decks as ordered lists) starts the engine's own `setupGame`, and every setup decision surfaces as an
 * ordinary pending: system flip (heads = A wins) → the winner's `confirm op:goFirst` → system shuffle A,
 * then B → placement picks tagged `destination: active|bench` → prizes from the deck TOP → (mulligans) →
 * compensation `selectOption` → turn 1. Sequence law: B.67.
 *
 * These cells pin the ADAPTER's wire (templates, projection, events), not engine card logic: the setup
 * defects G-62 lists (Talonflame benchable, extra-bench over-offer, …) are scenario-level findings.
 *
 * Mutation guard: drop `startSetup` and every cell but the validation one fails; drop the `destination` tag
 * and the placement cell fails; echo `ctx.firstPlayer` instead of deriving it and the go-second cell fails;
 * remove the setup guard on `promotedFromBench`/`turnEnded` and the boundary cell fails; take prizes from the
 * deck tail in the engine and the prize cell fails.
 */

const DROWZEE = 'sit-060'; // Basic
const GRASS = 'sve-001';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function deck(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function player(d: CardRef[]): PlayerState {
  return { active: null, bench: [], hand: [], deck: d, discard: [], lostZone: [], prizes: [], flags: flags() };
}
function preDeal(a: CardRef[], b: CardRef[]): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 0, activePlayer: 'A', firstPlayer: null, phase: 'setup', outcome: 'ongoing',
    stadium: null, players: { A: player(a), B: player(b) },
  };
}
const fill = (n: number) => Array.from({ length: n }, () => GRASS);
const shuffle = (d: CardRef[]): NeutralAction => ({ actor: 'system', type: 'shuffle', order: d.map(c => c.iid) } as NeutralAction);
const flip = (face: 'heads' | 'tails'): NeutralAction => ({ actor: 'system', type: 'flip', face } as NeutralAction);
const confirm = (actor: 'A' | 'B', value: boolean): NeutralAction => ({ actor, type: 'confirm', value } as NeutralAction);
const choose = (actor: 'A' | 'B', target: string): NeutralAction => ({ actor, type: 'choose', target } as NeutralAction);
const ids = (cs: { iid: string }[]) => cs.map(c => c.iid);

// Both players hold a Basic in the opening 7: A has two (a0, a2), B one (b1).
const A = deck('a', [DROWZEE, GRASS, DROWZEE, ...fill(17)]);
const B = deck('b', [GRASS, DROWZEE, ...fill(18)]);
const DEAL: NeutralAction[] = [flip('heads'), confirm('A', true), shuffle(A), shuffle(B)];

describe('CF-84 setup walk (pre-deal initialState)', () => {
  it('starts at the who-goes-first flip with firstPlayer null', () => {
    const r = step(preDeal(A, B), []);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.phase).toBe('setup');
    expect(r.state.firstPlayer).toBeNull();
    expect(r.pending?.actor).toBe('system');
    expect(r.pending?.legalActions.map(a => (a as { face?: string }).face).sort()).toEqual(['heads', 'tails']);
  });

  it('heads = A wins: A answers a confirm tagged op:goFirst; firstPlayer stays null until it resolves', () => {
    const r = step(preDeal(A, B), [flip('heads')]);
    expect(r.state.firstPlayer).toBeNull();
    expect(r.pending?.actor).toBe('A');
    expect(r.pending?.legalActions).toEqual([
      jasmine.objectContaining({ type: 'confirm', value: true, op: 'goFirst' }),
      jasmine.objectContaining({ type: 'confirm', value: false, op: 'goFirst' }),
    ]);
    const t = step(preDeal(A, B), [flip('tails')]);
    expect(t.pending?.actor).toBe('B');
  });

  it('deals 7 from the top after the shuffles and offers only starter candidates, the first tagged active', () => {
    const r = step(preDeal(A, B), DEAL);
    expect(ids(r.state.players.A.hand)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(r.state.firstPlayer).toBe('A');
    expect(r.pending?.actor).toBe('A');
    expect(r.pending?.legalActions).toEqual([
      jasmine.objectContaining({ type: 'choose', target: 'a0', destination: 'active' }),
      jasmine.objectContaining({ type: 'choose', target: 'a2', destination: 'active' }),
    ]);
    const after = step(preDeal(A, B), [...DEAL, choose('A', 'a0')]);
    expect(after.pending?.legalActions).toEqual([
      jasmine.objectContaining({ type: 'choose', target: 'a2', destination: 'bench' }),
      jasmine.objectContaining({ type: 'confirm', value: false }),
    ]);
  });

  it('places face down and lays the 6 Prize cards from the deck TOP', () => {
    const r = step(preDeal(A, B), [...DEAL, choose('A', 'a0'), choose('A', 'a2')]);
    const a = r.state.players.A;
    expect(r.state.phase).toBe('setup');
    expect(a.active?.faceDown).toBe(true);
    expect(a.bench[0].faceDown).toBe(true);
    expect(ids(a.prizes)).toEqual(['a7', 'a8', 'a9', 'a10', 'a11', 'a12']);
    expect(r.pending?.actor).toBe('B');
  });

  it('crosses into turn 1 revealed, with turnStarted but no phantom promotedFromBench / turnEnded', () => {
    const r = step(preDeal(A, B), [...DEAL, choose('A', 'a0'), choose('A', 'a2'), choose('B', 'b1')]);
    expect(r.state.phase).toBe('main');
    expect(r.state.turn).toBe(1);
    expect(r.state.activePlayer).toBe('A');
    expect(r.state.players.A.active?.faceDown).toBeUndefined();
    const kinds = r.events.map(e => e.kind);
    expect(kinds).toContain('turnStarted');
    expect(kinds).not.toContain('promotedFromBench');
    expect(kinds).not.toContain('turnEnded');
  });

  it('go second: firstPlayer is DERIVED from the decision, not echoed', () => {
    const r = step(preDeal(A, B), [flip('heads'), confirm('A', false), shuffle(A), shuffle(B),
      choose('A', 'a0'), choose('A', 'a2'), choose('B', 'b1')]);
    expect(r.state.firstPlayer).toBe('B');
    expect(r.state.activePlayer).toBe('B');
    expect(r.state.turn).toBe(1);
  });

  it('a pick outside the offer is invalidAction, not an engine fault', () => {
    const r = step(preDeal(A, B), [...DEAL, choose('A', 'a1')]); // a1 is an Energy
    expect(r.status).toBe('invalidAction');
    expect(r.index).toBe(DEAL.length);
  });

  describe('one-sided mulligan (B.67)', () => {
    // A's opening 7 has no Basic; B's does. A second Basic sits at B's index 13 = the first card B draws in
    // compensation (7 dealt + 6 prizes).
    const MA = deck('a', [...fill(7), DROWZEE, DROWZEE, ...fill(13)]);
    const MB = deck('b', [DROWZEE, ...fill(12), DROWZEE, ...fill(8)]);
    const reshuffle: NeutralAction = { actor: 'system', type: 'shuffle',
      order: ['a7', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', ...Array.from({ length: 14 }, (_, i) => `a${i + 8}`)] } as NeutralAction;
    const WALK = [flip('heads'), confirm('A', true), shuffle(MA), shuffle(MB)];

    it('the player WITH a Basic places and lays prizes first; the other then mulligans', () => {
      const r = step(preDeal(MA, MB), WALK);
      expect(r.pending?.actor).toBe('B');
      const placed = step(preDeal(MA, MB), [...WALK, choose('B', 'b0')]);
      expect(placed.state.players.B.prizes.length).toBe(6);
      expect(placed.pending?.actor).toBe('system'); // A's mulligan reshuffle
    });

    it('reveals each mulligan once, then offers the compensation count as one selectOption', () => {
      const r = step(preDeal(MA, MB), [...WALK, choose('B', 'b0'), reshuffle, choose('A', 'a7')]);
      const reveals = r.events.filter(e => e.kind === 'mulliganRevealed');
      expect(reveals).toEqual([{ kind: 'mulliganRevealed', player: 'A', hand: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'] }]);
      expect(r.pending?.actor).toBe('B');
      expect(r.pending?.legalActions.every(a => a.type === 'selectOption')).toBe(true);
      expect(r.pending?.legalActions.length).toBe(2); // draw 1 | draw 0
    });

    it('the drawn Basic may go to the Bench, then the game starts', () => {
      const drew = step(preDeal(MA, MB), [...WALK, choose('B', 'b0'), reshuffle, choose('A', 'a7'),
        { actor: 'B', type: 'selectOption', option: 0 } as NeutralAction]);
      expect(drew.pending?.legalActions).toContain(jasmine.objectContaining({ type: 'choose', target: 'b13', destination: 'bench' }));
      const done = step(preDeal(MA, MB), [...WALK, choose('B', 'b0'), reshuffle, choose('A', 'a7'),
        { actor: 'B', type: 'selectOption', option: 0 } as NeutralAction, choose('B', 'b13')]);
      expect(done.state.phase).toBe('main');
      expect(ids(done.state.players.B.bench.map(p => p.stack[0]))).toEqual(['b13']);
    });
  });

  it('rejects a phase-setup initialState that is not the pre-deal state (HTTP 400)', () => {
    const bad = preDeal(A, B);
    bad.turn = 1;
    expect(() => handleStep({ schemaVersion: SCHEMA_VERSION, initialState: bad, actions: [] })).toThrowError(BadRequestError);
    const dealt = preDeal(A, B);
    dealt.players.A.hand = [{ iid: 'x0', printing: GRASS }];
    expect(() => handleStep({ schemaVersion: SCHEMA_VERSION, initialState: dealt, actions: [] })).toThrowError(BadRequestError);
  });
});
