import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * Adapter defects filed from the full fuzz results/fuzz-20261010-full (TA-693, TA-694, TA-696, TA-698): the wire
 * projection of events (B.80 / B.81 / B.93 / B.103). Each cell asserts the ruling and was red on c3e4e93e8.
 */

const E: Record<string, string> = {
  G: 'sve-001', R: 'sve-002', W: 'sve-003', L: 'sve-004', P: 'sve-005', F: 'sve-006', D: 'sve-007', M: 'sve-008',
};

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, ps: string[]): CardRef[] {
  return ps.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, Array(n).fill(E.M)).map(c => ({ ...c, faceUp: false }));
}
function game(a: PlayerState, b: PlayerState, over: Partial<NeutralState> = {}): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
    stadium: null, players: { A: a, B: b }, ...over,
  } as NeutralState;
}
const moved = (events: NeutralEvent[]) => events.filter((e): e is Moved => e.kind === 'moved');
const place = (owner: string, l: { zone: string; pokemon?: string; role?: string; position?: string }) =>
  l.pokemon !== undefined ? `${l.zone}:${l.pokemon}:${l.role}` : `${owner}.${l.zone}${l.position !== undefined ? ':' + l.position : ''}`;
const legs = (events: NeutralEvent[], iid: string) =>
  moved(events).filter(e => e.card === iid).map(e => `${place(e.owner, e.origin)}>${place(e.owner, e.destination)}`);
const kinds = (events: NeutralEvent[]) => events.map(e => e.kind);

describe('TA-693 / B.103: Slight Shift blk-040 with one movable Energy records no chosen; only the destination is a decision', () => {
  // A's Active holds a Mist Energy (tef-161): the attack's effect cannot move its Energy (TA-169), so the only movable
  // Energy is the one on the Bench; A has two other Pokemon, so the destination is a real decision. B.103: a pick with
  // one possible card records no `chosen` even when its destination is chosen; the answered pending carries it.
  const initial = () => game(
    player({
      active: mon('a1', 'twm-118', [{ iid: 'a1e0', printing: 'tef-161' }, { iid: 'a1e1', printing: E.G }]),
      bench: [mon('a2', 'twm-118', [{ iid: 'a2e0', printing: E.W }]), mon('a3', 'twm-118')],
      deck: cards('ad', Array(4).fill(E.W)), prizes: prizes('ap', 6),
    }),
    player({ active: mon('b1', 'blk-040', [{ iid: 'b1e0', printing: E.P }]), deck: cards('bd', Array(4).fill(E.W)), prizes: prizes('bp', 6) }),
    { turn: 4, activePlayer: 'B' });
  const attack = { actor: 'B', type: 'declareAttack', source: 'b1', name: 'Slight Shift' } as never;
  const move = { actor: 'B', type: 'moveEnergy', card: 'a2e0', source: 'a2', target: 'a1' } as never;

  it('the pending offers the one movable Energy for each of the two destinations', () => {
    const res = step(initial(), [attack]);
    expect(res.pending?.legalActions.map(a => `${a.type} ${(a as { card?: string }).card}>${(a as { target?: string }).target}`).sort())
      .toEqual(['moveEnergy a2e0>a1', 'moveEnergy a2e0>a3']);
  });

  it('after the move: the Energy is on the chosen Pokemon with its leg, and no chosen is recorded', () => {
    const res = step(initial(), [attack, move]);
    expect((res.state.players.A.active?.energy ?? []).map(c => c.iid)).toEqual(['a1e0', 'a1e1', 'a2e0']);
    expect(legs(res.events, 'a2e0')).toEqual(['bench:a2:energy>active:a1:energy']);
    expect(kinds(res.events)).not.toContain('chosen');
  });
});

describe('TA-694: a game-ending end-of-turn effect still ends the turn (Intense Kiss pbl-032)', () => {
  // "At the end of your opponent's next turn, discard the Defending Pokemon and all attached cards." When that discard
  // leaves the opponent with no Pokemon the game is over, but the turn whose end-of-turn step ran DID end: turnEnded
  // for that player, then gameOver (rotomancer emits both; twinleaf dropped the turnEnded, reading it from a log the
  // engine wrote only once the next turn started).
  const JYNX = 'pbl-032';
  const WALL = 'meg-181';
  const BELLSPROUT = 'asc-004';
  const kiss = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Intense Kiss' } as never;
  const endB = { actor: 'B', type: 'endTurn' } as never;
  const turnEvents = (events: NeutralEvent[]) => events.filter(e => e.kind === 'turnEnded' || e.kind === 'turnStarted' || e.kind === 'gameOver')
    .map(e => `${e.kind} ${(e as { player?: string }).player ?? (e as { outcome?: string }).outcome}`);

  it('with no Bench: A kisses, B ends the turn, B\'s last Pokemon is discarded: turnEnded B, then gameOver', () => {
    const res = step(game(
      player({ active: mon('a1', JYNX, [{ iid: 'a1e0', printing: E.P }]), deck: cards('ad', Array(6).fill(E.R)), prizes: prizes('ap', 6) }),
      player({ active: mon('b1', WALL), deck: cards('bd', Array(6).fill(E.R)), prizes: prizes('bp', 6) })),
      [kiss, endB]);
    expect(res.status).toBe('gameOver');
    expect(res.state.players.B.active).toBeNull();
    expect(turnEvents(res.events)).toEqual(['turnEnded A', 'turnStarted B', 'turnEnded B', 'gameOver winA']);
  });

  it('the filed reproducer: two kisses, the second discard empties B\'s board: turnEnded B x2, the last before gameOver', () => {
    const res = step(game(
      player({ active: mon('a1', JYNX, [{ iid: 'a1e0', printing: E.P }]), bench: [mon('ab1', BELLSPROUT)], hand: cards('ah', [E.R]),
        deck: cards('ad', Array(12).fill(E.R)), prizes: prizes('ap', 6) }),
      player({ active: mon('b1', WALL), bench: [mon('bb1', BELLSPROUT)], hand: cards('bh', [E.R]),
        deck: cards('bd', Array(12).fill(E.R)), prizes: prizes('bp', 6) })),
      [kiss, endB, { actor: 'B', type: 'promoteBench', target: 'bb1' } as never, kiss, endB]);
    expect(res.status).toBe('gameOver');
    expect(turnEvents(res.events)).toEqual([
      'turnEnded A', 'turnStarted B', 'turnEnded B', 'turnStarted A', 'turnEnded A', 'turnStarted B', 'turnEnded B', 'gameOver winA']);
    const last = res.events.length - 1 - [...res.events].reverse().findIndex(e => e.kind === 'turnEnded');
    expect(last).toBeLessThan(res.events.findIndex(e => e.kind === 'gameOver'));
  });
});
