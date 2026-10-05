import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-608 / TA-556 (B.74) — Iono pal-185: "Each player shuffles their hand and puts it on the bottom of their deck.
 * If either player put any cards on the bottom of their deck in this way, each player draws a card for each of their
 * remaining Prize cards."
 *
 * TA-608: the card shuffled each hand with an inline Math.random, so no `system` shuffle was ever pending and the
 * bottom order could not be supplied (the card sat in EXCLUDED_RANDOM_CARDS). TA-556 / B.74: the steps run in
 * lockstep — both hands go under their decks, then both hand piles are shuffled, then both players draw; the card
 * ran A's whole sequence (put, draw) before B's hand moved.
 *
 * Mutation guards: restore the inline shuffle and the first cell reds (no shuffle pending); move B's put after A's
 * shuffle answer and the lockstep expectation reds (B's hand still in hand at A's shuffle).
 */

const IONO = 'pal-185';
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
function basic(iid: string): PokemonInPlay {
  return { stack: [{ iid, printing: BELLSPROUT }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: GRASS }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n).map(c => ({ ...c, faceUp: false }));
}
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: basic('a1'), hand: [{ iid: 'iono', printing: IONO }, ...cards('x', 2)], deck: cards('ad', 6), prizes: prizes('ap', 4) }),
      B: player({ active: basic('b1'), hand: cards('y', 3), deck: cards('bd', 7), prizes: prizes('bp', 5) }),
    },
  };
}

type Pending = { actor: string; legalActions: Array<{ type: string; deck?: string[] }> };
const PLAY = { actor: 'A', type: 'playSupporter', card: 'iono' };
const shuffle = (order: string[]) => ({ actor: 'system', type: 'shuffle', order });

describe('TA-608 / TA-556: Iono pal-185 shuffles each hand through a system shuffle, in lockstep (B.74)', () => {
  it('at the first shuffle both hands are already under their decks and nobody has drawn [TA-608]', () => {
    const res = step(board(), [PLAY as never]);
    const pending = res.pending as unknown as Pending;
    expect(pending.actor).toBe('system');
    expect(pending.legalActions[0].type).toBe('shuffle');
    expect([...(pending.legalActions[0].deck ?? [])].sort()).toEqual(['x0', 'x1']);
    expect(res.state.players.B.hand).toEqual([]);
    expect(res.state.players.A.hand).toEqual([]);
  });

  it('A\'s answer is applied to A\'s bottom block; then B\'s hand is shuffled; then each player draws per Prize [TA-608]', () => {
    const mid = step(board(), [PLAY as never, shuffle(['x1', 'x0']) as never]);
    const pending = mid.pending as unknown as Pending;
    expect(pending.actor).toBe('system');
    expect([...(pending.legalActions[0].deck ?? [])].sort()).toEqual(['y0', 'y1', 'y2']);

    const res = step(board(), [PLAY as never, shuffle(['x1', 'x0']) as never, shuffle(['y2', 'y0', 'y1']) as never]);
    const A = res.state.players.A;
    const B = res.state.players.B;
    expect(A.hand.map(c => c.iid)).toEqual(['ad0', 'ad1', 'ad2', 'ad3']);
    expect(B.hand.map(c => c.iid)).toEqual(['bd0', 'bd1', 'bd2', 'bd3', 'bd4']);
    expect(A.deck.slice(-2).map(c => c.iid)).toEqual(['x1', 'x0']);
    expect(B.deck.slice(-3).map(c => c.iid)).toEqual(['y2', 'y0', 'y1']);
    const zones = (res.events as Array<{ kind: string; player?: string; zone?: string }>)
      .filter(e => e.kind === 'shuffled').map(e => `${e.player}:${e.zone}`);
    expect(zones).toEqual(['A:hand', 'B:hand']);
  });

  it('lockstep projection: at A\'s shuffle BOTH hands are lifted {hand -> deck bottom, owner}; both decks untouched [TA-556]', () => {
    const res = step(board(), [PLAY as never]);
    const lifted = (who: 'A' | 'B') => (res.state.players[who].transit ?? []).map(t => `${t.iid}:${t.origin?.zone}>${t.destination?.zone}:${t.destination?.position}:${t.visibility}`);
    expect(lifted('A').sort()).toEqual(['x0:hand>deck:bottom:owner', 'x1:hand>deck:bottom:owner']);
    expect(lifted('B').sort()).toEqual(['y0:hand>deck:bottom:owner', 'y1:hand>deck:bottom:owner', 'y2:hand>deck:bottom:owner']);
    expect(res.state.players.A.deck.map(c => c.iid)).toEqual(['ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5']);
    expect(res.state.players.B.deck.map(c => c.iid)).toEqual(['bd0', 'bd1', 'bd2', 'bd3', 'bd4', 'bd5', 'bd6']);
  });

  it('lockstep projection: after A\'s answer A\'s shuffled block is still lifted (no put before every hand is shuffled) [TA-556]', () => {
    const res = step(board(), [PLAY as never, shuffle(['x1', 'x0']) as never]);
    expect((res.state.players.A.transit ?? []).map(t => t.iid)).toEqual(['x1', 'x0']);
    expect(res.state.players.A.deck.map(c => c.iid)).toEqual(['ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5']);
  });

  it('Milotic evs-038 (Dew Guard) protects B: B keeps the hand and does not draw; A still puts and draws [TA-608]', () => {
    const b = board();
    b.players.B.bench = [{ stack: [{ iid: 'm0', printing: 'evs-037' }, { iid: 'm1', printing: 'evs-038' }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() }];
    const res = step(b, [PLAY as never, shuffle(['x1', 'x0']) as never]);
    expect(res.state.players.B.hand.map(c => c.iid)).toEqual(['y0', 'y1', 'y2']);
    expect(res.state.players.B.deck.length).toBe(7);
    expect(res.state.players.A.hand.map(c => c.iid)).toEqual(['ad0', 'ad1', 'ad2', 'ad3']);
  });
});
