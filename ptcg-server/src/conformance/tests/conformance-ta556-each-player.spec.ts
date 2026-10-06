import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-556 (B.74) — the "each player shuffles their hand into their deck" family runs in LOCKSTEP: every hand goes into
 * its deck, then every deck is shuffled (one `system` shuffle per deck), then any step the card prints in between
 * (Harlequin's coin flip), then every player draws. Iono is TA-608 (conformance-ta608-iono.spec.ts).
 *
 *   Judge por-076 / svi-176 / paf-228: "Each player shuffles their hand into their deck and draws 4 cards."
 *   Harlequin wht-083: "Each player shuffles their hand into their deck. Then, flip a coin. If heads, you draw 5 cards,
 *     and your opponent draws 3 cards. If tails, you draw 3 cards, and your opponent draws 5 cards."
 *   Team Rocket's Archer dri-170 / dri-223 / asc-201: "... Each player shuffles their hand into their deck. Then, you
 *     draw 5 cards, and your opponent draws 3 cards."
 *   Unfair Stamp twm-165: "... Each player shuffles their hand into their deck. Then, you draw 5 cards, and your
 *     opponent draws 2 cards."
 *
 * Base (6ff123d78): Judge ran A's whole sequence (hand in, shuffle, draw 4) before B's hand moved. Harlequin flipped the
 * coin BEFORE any hand moved, and Harlequin / Archer drew from decks whose shuffle had not been answered yet (the
 * SHUFFLE_DECK prompt does not hold the draws). Unfair Stamp was already lockstep (guard cell).
 *
 * Mutation guards: restore Judge's player-by-player prefab chain and the Judge cells red (B's hand still in hand at A's
 * shuffle; A has drawn at B's shuffle); move Harlequin's flip ahead of the hand moves and its first cell reds.
 */

const BELLSPROUT = 'asc-004';
const GRASS = 'sve-001';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing = BELLSPROUT): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: GRASS }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n).map(c => ({ ...c, faceUp: false }));
}

/** A to act, A holds the card + x0 x1 over ad0..ad5; B holds y0..y2 over bd0..bd6. */
function board(printing: string): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: mon('a1'), hand: [{ iid: 'sup', printing }, ...cards('x', 2)], deck: cards('ad', 6), prizes: prizes('ap', 4) }),
      B: player({ active: mon('b1'), hand: cards('y', 3), deck: cards('bd', 7), prizes: prizes('bp', 5) }),
    },
  };
}

/**
 * B to act: B's Team Rocket's Nidoran♂ dri-117 (Pierce, 10) knocks out A's damaged Active (Team Rocket's Chingling
 * dri-085, 30 HP, 20 damage); B takes bp0, A promotes a2 and draws ad0 for turn. A then holds the card + x0 x1 ad0
 * over ad1..ad6 and B holds y0..y2 bp0 over bd0..bd6: the "Knocked Out during your opponent's last turn" gate is met.
 */
function koBoard(printing: string): NeutralState {
  const a = mon('a1', 'dri-085');
  a.damage = 20;
  const b = mon('b1', 'dri-117');
  b.energy = [{ iid: 'be0', printing: 'sve-007' }];
  return {
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'B', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: a, bench: [mon('a2')], hand: [{ iid: 'sup', printing }, ...cards('x', 2)], deck: cards('ad', 7), prizes: prizes('ap', 4) }),
      B: player({ active: b, hand: cards('y', 3), deck: cards('bd', 7), prizes: prizes('bp', 5) }),
    },
  };
}
const KO_PRELUDE = [
  { actor: 'B', type: 'declareAttack', source: 'b1', name: 'Pierce' },
  { actor: 'B', type: 'takePrize', index: 0 },
  { actor: 'A', type: 'promoteBench', target: 'a2' },
];

type Pending = { actor: string; legalActions: Array<{ type: string; deck?: string[] }> };
type Ev = { kind: string; player?: string; zone?: string; count?: number };
const shuffle = (order: string[]) => ({ actor: 'system', type: 'shuffle', order });
const flip = (face: 'heads' | 'tails') => ({ actor: 'system', type: 'flip', face });
const run = (b: NeutralState, actions: object[]) => step(b, actions as never);
const ids = (cs: CardRef[]) => cs.map(c => c.iid);
const pend = (r: ReturnType<typeof step>) => r.pending as unknown as Pending;
/** The `shuffled` and `draw` events in emitted order, e.g. ['shuffled:A', 'shuffled:B', 'draw:A:4']. */
const seq = (r: ReturnType<typeof step>) => (r.events as Ev[])
  .filter(e => e.kind === 'shuffled' || e.kind === 'draw')
  .map(e => e.kind === 'draw' ? `draw:${e.player}:${e.count}` : `shuffled:${e.player}`);

// Shuffle answers: A's deck after Judge is ad0..ad5 x0 x1; B's is bd0..bd6 y0..y2.
const JA = shuffle(['x1', 'ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5', 'x0']);
const JB = shuffle(['y0', 'y1', 'y2', 'bd0', 'bd1', 'bd2', 'bd3', 'bd4', 'bd5', 'bd6']);

describe('TA-556 (B.74): Judge por-076 runs hand-in, shuffle, draw in lockstep', () => {
  const PLAY = { actor: 'A', type: 'playSupporter', card: 'sup' };

  it('at the first shuffle (A\'s deck) both hands are already in their decks and nobody has drawn [TA-556]', () => {
    const r = run(board('por-076'), [PLAY]);
    expect(pend(r).actor).toBe('system');
    expect([...(pend(r).legalActions[0].deck ?? [])].sort()).toEqual(['ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5', 'x0', 'x1']);
    expect(ids(r.state.players.A.hand)).toEqual([]);
    expect(ids(r.state.players.B.hand)).toEqual([]);
    expect(r.state.players.B.deck.length).toBe(10);
  });

  it('after A\'s answer B\'s shuffle is pending and A has NOT drawn yet [TA-556]', () => {
    const r = run(board('por-076'), [PLAY, JA]);
    expect(pend(r).actor).toBe('system');
    expect([...(pend(r).legalActions[0].deck ?? [])].sort())
      .toEqual(['bd0', 'bd1', 'bd2', 'bd3', 'bd4', 'bd5', 'bd6', 'y0', 'y1', 'y2']);
    expect(ids(r.state.players.A.hand)).toEqual([]);
    expect(r.state.players.A.deck.length).toBe(8);
  });

  it('both shuffles come before either draw; each draws 4 from its answered order [TA-556]', () => {
    const r = run(board('por-076'), [PLAY, JA, JB]);
    expect(seq(r)).toEqual(['shuffled:A', 'shuffled:B', 'draw:A:4', 'draw:B:4']);
    expect(ids(r.state.players.A.hand)).toEqual(['x1', 'ad0', 'ad1', 'ad2']);
    expect(ids(r.state.players.B.hand)).toEqual(['y0', 'y1', 'y2', 'bd0']);
    expect(r.state.players.A.deck.length).toBe(4);
    expect(r.state.players.B.deck.length).toBe(6);
  });

  it('svi-176 and paf-228 (same class) are lockstep too [TA-556]', () => {
    for (const p of ['svi-176', 'paf-228']) {
      const r = run(board(p), [PLAY]);
      expect(ids(r.state.players.B.hand)).toEqual([], p);
      expect(seq(run(board(p), [PLAY, JA, JB]))).toEqual(['shuffled:A', 'shuffled:B', 'draw:A:4', 'draw:B:4'], p);
    }
  });

  it('Milotic evs-038 (Dew Guard) protects B: B keeps the hand, is not shuffled and does not draw; A still draws 4 [TA-556]', () => {
    const b = board('por-076');
    b.players.B.bench = [{ stack: [{ iid: 'm0', printing: 'evs-037' }, { iid: 'm1', printing: 'evs-038' }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() }];
    const r = run(b, [PLAY, JA]);
    expect(r.status).toBe('awaitingAction');
    expect(pend(r).actor).toBe('A');
    expect(ids(r.state.players.B.hand)).toEqual(['y0', 'y1', 'y2']);
    expect(r.state.players.B.deck.length).toBe(7);
    expect(ids(r.state.players.A.hand)).toEqual(['x1', 'ad0', 'ad1', 'ad2']);
    expect(seq(r)).toEqual(['shuffled:A', 'draw:A:4']);
  });
});

describe('TA-556 (B.74): Harlequin wht-083 puts both hands in, shuffles both decks, THEN flips, then draws', () => {
  const PLAY = { actor: 'A', type: 'playSupporter', card: 'sup' };

  it('the first decision is A\'s deck shuffle (not the coin flip), with both hands already in their decks [TA-556]', () => {
    const r = run(board('wht-083'), [PLAY]);
    expect(pend(r).actor).toBe('system');
    expect(pend(r).legalActions[0].type).toBe('shuffle');
    expect([...(pend(r).legalActions[0].deck ?? [])].sort()).toEqual(['ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5', 'x0', 'x1']);
    expect(ids(r.state.players.A.hand)).toEqual([]);
    expect(ids(r.state.players.B.hand)).toEqual([]);
  });

  it('after both shuffles the coin flip is pending and nobody has drawn [TA-556]', () => {
    const r = run(board('wht-083'), [PLAY, JA, JB]);
    expect(pend(r).actor).toBe('system');
    expect(pend(r).legalActions.map(a => a.type)).toEqual(['flip', 'flip']);
    expect(ids(r.state.players.A.hand)).toEqual([]);
    expect(ids(r.state.players.B.hand)).toEqual([]);
    expect(seq(r)).toEqual(['shuffled:A', 'shuffled:B']);
  });

  it('heads: A draws 5 and B draws 3 from the answered orders [TA-556]', () => {
    const r = run(board('wht-083'), [PLAY, JA, JB, flip('heads')]);
    expect(ids(r.state.players.A.hand)).toEqual(['x1', 'ad0', 'ad1', 'ad2', 'ad3']);
    expect(ids(r.state.players.B.hand)).toEqual(['y0', 'y1', 'y2']);
    expect(seq(r)).toEqual(['shuffled:A', 'shuffled:B', 'draw:A:5', 'draw:B:3']);
  });

  it('tails: A draws 3 and B draws 5 [TA-556]', () => {
    const r = run(board('wht-083'), [PLAY, JA, JB, flip('tails')]);
    expect(ids(r.state.players.A.hand)).toEqual(['x1', 'ad0', 'ad1']);
    expect(ids(r.state.players.B.hand)).toEqual(['y0', 'y1', 'y2', 'bd0', 'bd1']);
  });
});

// After the KO prelude: A's deck is ad1..ad6 x0 x1 ad0; B's is bd0..bd6 y0..y2 bp0.
const KA = shuffle(['x1', 'ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5', 'ad6', 'x0']);
const KB = shuffle(['y0', 'y1', 'bp0', 'y2', 'bd0', 'bd1', 'bd2', 'bd3', 'bd4', 'bd5', 'bd6']);

describe('TA-556 (B.74): Team Rocket\'s Archer dri-170 shuffles both decks before anyone draws', () => {
  const PLAY = { actor: 'A', type: 'playSupporter', card: 'sup' };

  it('at the first shuffle (A\'s deck) both hands are in their decks and nobody has drawn [TA-556]', () => {
    const r = run(koBoard('dri-170'), [...KO_PRELUDE, PLAY]);
    expect(pend(r).actor).toBe('system');
    expect([...(pend(r).legalActions[0].deck ?? [])].sort())
      .toEqual(['ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5', 'ad6', 'x0', 'x1']);
    expect(ids(r.state.players.A.hand)).toEqual([]);
    expect(ids(r.state.players.B.hand)).toEqual([]);
  });

  it('after both shuffles A draws 5 and B draws 3 from the answered orders [TA-556]', () => {
    const r = run(koBoard('dri-170'), [...KO_PRELUDE, PLAY, KA, KB]);
    expect(ids(r.state.players.A.hand)).toEqual(['x1', 'ad0', 'ad1', 'ad2', 'ad3']);
    expect(ids(r.state.players.B.hand)).toEqual(['y0', 'y1', 'bp0']);
    expect(seq(r).slice(-4)).toEqual(['shuffled:A', 'shuffled:B', 'draw:A:5', 'draw:B:3']);
  });

  it('asc-201 (inherits) is lockstep too [TA-556]', () => {
    const r = run(koBoard('asc-201'), [...KO_PRELUDE, PLAY, KA, KB]);
    expect(ids(r.state.players.A.hand)).toEqual(['x1', 'ad0', 'ad1', 'ad2', 'ad3']);
    expect(seq(r).slice(-4)).toEqual(['shuffled:A', 'shuffled:B', 'draw:A:5', 'draw:B:3']);
  });
});

describe('TA-556 (B.74): Unfair Stamp twm-165 is already lockstep (guard)', () => {
  const PLAY = { actor: 'A', type: 'playItem', card: 'sup' };

  it('both hands in before A\'s shuffle; both shuffles before the draws (A 5, B 2) [TA-556]', () => {
    const first = run(koBoard('twm-165'), [...KO_PRELUDE, PLAY]);
    expect(ids(first.state.players.B.hand)).toEqual([]);
    expect(ids(first.state.players.A.hand)).toEqual([]);
    const r = run(koBoard('twm-165'), [...KO_PRELUDE, PLAY, KA, KB]);
    expect(ids(r.state.players.A.hand)).toEqual(['x1', 'ad0', 'ad1', 'ad2', 'ad3']);
    expect(ids(r.state.players.B.hand)).toEqual(['y0', 'y1']);
    expect(seq(r).slice(-4)).toEqual(['shuffled:A', 'shuffled:B', 'draw:A:5', 'draw:B:2']);
  });
});

describe('TA-556 (B.74): an answered shuffle is applied at once, while the other deck\'s shuffle is still pending', () => {
  // A's deck in A's answered order at B's shuffle pending (a batched prompt pair held it back until B answered).
  it('Judge por-076 [TA-556]', () => {
    const r = run(board('por-076'), [{ actor: 'A', type: 'playSupporter', card: 'sup' }, JA]);
    expect(ids(r.state.players.A.deck)).toEqual(['x1', 'ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5', 'x0']);
  });
  it('Harlequin wht-083 [TA-556]', () => {
    const r = run(board('wht-083'), [{ actor: 'A', type: 'playSupporter', card: 'sup' }, JA]);
    expect(ids(r.state.players.A.deck)).toEqual(['x1', 'ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5', 'x0']);
  });
  it('Team Rocket\'s Archer dri-170 [TA-556]', () => {
    const r = run(koBoard('dri-170'), [...KO_PRELUDE, { actor: 'A', type: 'playSupporter', card: 'sup' }, KA]);
    expect(ids(r.state.players.A.deck)).toEqual(['x1', 'ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5', 'ad6', 'x0']);
  });
  it('Unfair Stamp twm-165 [TA-556]', () => {
    const r = run(koBoard('twm-165'), [...KO_PRELUDE, { actor: 'A', type: 'playItem', card: 'sup' }, KA]);
    expect(pend(r).actor).toBe('system');
    expect(ids(r.state.players.A.deck)).toEqual(['x1', 'ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5', 'ad6', 'x0']);
  });
});

describe('TA-556: Milotic evs-038 Dew Guard protects B even when B\'s hand is EMPTY (protection does not depend on hand size)', () => {
  // "Whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to you or
  // your hand." An empty hand has nothing to move, but the shuffle and the draw are still effects done to B.
  const withMilotic = (printing: string): NeutralState => {
    const b = board(printing);
    b.players.B.hand = [];
    b.players.B.bench = [{ stack: [{ iid: 'm0', printing: 'evs-037' }, { iid: 'm1', printing: 'evs-038' }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() }];
    return b;
  };
  const PLAY = { actor: 'A', type: 'playSupporter', card: 'sup' };

  it('Judge por-076: B is not shuffled and does not draw; A draws 4 [TA-556]', () => {
    const r = run(withMilotic('por-076'), [PLAY, JA]);
    expect(pend(r).actor).toBe('A');
    expect(ids(r.state.players.B.hand)).toEqual([]);
    expect(ids(r.state.players.B.deck)).toEqual(['bd0', 'bd1', 'bd2', 'bd3', 'bd4', 'bd5', 'bd6']);
    expect(seq(r)).toEqual(['shuffled:A', 'draw:A:4']);
  });

  it('Harlequin wht-083 (tails): B is not shuffled and does not draw; A draws 3 [TA-556]', () => {
    const r = run(withMilotic('wht-083'), [PLAY, JA, flip('tails')]);
    expect(pend(r).actor).toBe('A');
    expect(ids(r.state.players.B.hand)).toEqual([]);
    expect(ids(r.state.players.B.deck)).toEqual(['bd0', 'bd1', 'bd2', 'bd3', 'bd4', 'bd5', 'bd6']);
    expect(ids(r.state.players.A.hand)).toEqual(['x1', 'ad0', 'ad1']);
    expect(seq(r)).toEqual(['shuffled:A', 'draw:A:3']);
  });
});
