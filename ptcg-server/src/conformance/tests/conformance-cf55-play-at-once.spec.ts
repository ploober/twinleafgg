import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * CF-55 — "play N copies at once" on the wire: `cards` answers, `candidates` + `counts` template.
 *
 * Driven on `cri-083` Transformation Tome ("You must play 2 … at once"), which is the ONLY at-once
 * printing in the engine intersection — the other 9 sit in LOT/UPR/BKP/SIT/FST, which rotomancer
 * does not carry. So every cell here is twinleaf-side; the cross-engine reach of this contract is
 * one printing with `counts: [2]`, and that is recorded rather than glossed.
 */

const BELLSPROUT = 'asc-004';
const WATER = 'sve-003';
const TOME = 'cri-083';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function basic(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}

/** N Tomes in hand, a Basic in play and a Basic in the discard — Transformation Tome's own gates. */
function board(tomes: number): NeutralState {
  const hand = Array.from({ length: tomes }, (_, i) => ({ iid: `A-t${i}`, printing: TOME }));
  const A = player({
    active: basic('A-act', BELLSPROUT),
    hand,
    discard: [{ iid: 'A-dp', printing: BELLSPROUT }],
    deck: [{ iid: 'A-d', printing: WATER }],
    prizes: [{ iid: 'A-pz', printing: WATER, faceUp: false }],
  });
  const B = player({
    active: basic('B-act', BELLSPROUT),
    deck: [{ iid: 'B-d', printing: WATER }],
    prizes: [{ iid: 'B-pz', printing: WATER, faceUp: false }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}

const tomeOffers = (res: ReturnType<typeof step>) =>
  (res.pending?.legalActions ?? []).filter((a: any) =>
    a.type === 'playItem'
    && ((a.candidates ?? []).some((c: string) => c.startsWith('A-t')) || String(a.card ?? '').startsWith('A-t')));

describe('Conformance — CF-55 play N copies at once', () => {

  // ── the menu ────────────────────────────────────────────────────────────────────────────────

  it('offers ONE template carrying candidates + counts, not one entry per copy', () => {
    const offers = tomeOffers(step(board(2), []));
    expect(offers.length).toBe(1);
    expect((offers[0] as any).candidates).toEqual(['A-t0', 'A-t1']);
    expect((offers[0] as any).counts).toEqual([2]);
  });

  it('never offers the singular `card` for an at-once printing', () => {
    // Row 2's menu-side twin. If the singular offer survives alongside the template, a client can
    // play a lone copy straight off the menu and the count gate is decorative.
    const offers = tomeOffers(step(board(2), []));
    expect(offers.every(o => (o as any).card === undefined)).toBe(true);
  });

  it('four copies still yield ONE template — not C(4,2)=6 combinations', () => {
    // The whole reason the contract mirrors `shuffle` rather than enumerating concrete plays.
    const offers = tomeOffers(step(board(4), []));
    expect(offers.length).toBe(1);
    expect((offers[0] as any).candidates).toEqual(['A-t0', 'A-t1', 'A-t2', 'A-t3']);
    expect((offers[0] as any).counts).toEqual([2]);
  });

  it('⚠️ the template SURVIVES the menu probe (rotomancer\'s dry-run trap)', () => {
    // A template names no single card, so it is not dispatchable by construction and fails its own
    // dry run. An enumerator that probes what it offers drops the entry SILENTLY — the menu simply
    // has one fewer row and nothing reports a problem. We probe the concrete play and offer the
    // template. This cell exists because that split is invisible in the code's shape.
    expect(tomeOffers(step(board(2), [])).length).toBe(1);
  });

  it('offers nothing when the hand cannot supply the count', () => {
    // "must play 2" with one copy: the engine's own canPlay already refuses, and `counts` filtered
    // against the hand would be empty anyway. Both roads lead to no offer.
    expect(tomeOffers(step(board(1), [])).length).toBe(0);
  });

  // ── the four invalidAction rows ─────────────────────────────────────────────────────────────

  it('row 1 — `cards` on a printing with NO at-once clause is invalid', () => {
    // ⚠️ MUTATION NOTE, recorded because the first mutant I wrote was EQUIVALENT and read as a dead
    // cell. Deleting the row-1 throw alone leaves this green: control falls through to the
    // `card === undefined` guard below, which rejects for a different reason and produces the same
    // status. The mutant that actually discriminates is one where the play PROCEEDS — an engine
    // that happily plays `cards` on an ordinary printing — and against that one this cell reds.
    // "The mutation did not kill it" and "the guard is not load-bearing" are different claims.
    const b = board(2);
    b.players.A.hand.push({ iid: 'A-w', printing: WATER });
    expect(step(b, [{ actor: 'A', type: 'playItem', cards: ['A-w'] } as any]).status).toBe('invalidAction');
  });

  it('row 2 — `card` on a printing WITH an at-once clause is invalid', () => {
    // #2366: else a lone copy back-doors the count gate through the singular field.
    expect(step(board(2), [{ actor: 'A', type: 'playItem', card: 'A-t0' } as any]).status)
      .toBe('invalidAction');
  });

  it('row 3 — a `cards` length that is not one of `counts` is invalid', () => {
    expect(step(board(2), [{ actor: 'A', type: 'playItem', cards: ['A-t0'] } as any]).status)
      .toBe('invalidAction');
  });

  it('row 4 — a duplicate iid in `cards` is invalid (a physical card cannot be played twice)', () => {
    // ⚠️ ROTOMANCER'S ROW-4 WARNING. This is only enforceable while the check runs on the RAW IID
    // ARRAY. Resolve to Cards first and both entries become the same object, the length still reads
    // 2, and the gate accepts it — the defect would be invisible from here down.
    expect(step(board(2), [{ actor: 'A', type: 'playItem', cards: ['A-t0', 'A-t0'] } as any]).status)
      .toBe('invalidAction');
  });

  // ── the happy path ──────────────────────────────────────────────────────────────────────────

  it('a legal 2-card play is ACCEPTED and pauses inside its own effect', () => {
    const res = step(board(2), [{ actor: 'A', type: 'playItem', cards: ['A-t0', 'A-t1'] } as any]);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.descriptor).toContain('CHOOSE_CARD_TO_PUT_ONTO_BENCH');
    // CF-42 cross-check, and it is worth having the two contracts meet in one cell: the played card
    // is STAGED, not discarded, while its own prompt is open (#919 cost -> effect -> discard).
    // B.80 / TA-567 (2026-10-04): BOTH copies are played at once ("You must play 2 Transformation Tome cards at
    // once"), so both are on the playing field while the effect is in flight — the companion is no longer left in
    // the hand until the effect completes (this cell used to pin that; rotomancer shows both in resolving).
    expect((res.state.players.A.resolving ?? []).map(c => c.printing)).toEqual([TOME, TOME]);
    expect((res.state.players.A.hand ?? []).map(c => c.iid)).toEqual([]);
  });

  it('driven to completion, BOTH copies are spent', () => {
    // The count gate is only real if the second copy actually leaves. Drive the effect's own prompt
    // (one Basic in play, so the switch target auto-resolves and only the discard pick remains).
    const first = step(board(2), [{ actor: 'A', type: 'playItem', cards: ['A-t0', 'A-t1'] } as any]);
    const res = step(board(2), [
      { actor: 'A', type: 'playItem', cards: ['A-t0', 'A-t1'] } as any,
      first.pending!.legalActions[0] as any,
    ]);
    expect((res.state.players.A.hand ?? []).filter(c => c.printing === TOME)).toEqual([]);
    expect(res.state.players.A.resolving ?? []).toEqual([]);
  });

  it('order does not matter — `cards` is a SET', () => {
    const fwd = step(board(2), [{ actor: 'A', type: 'playItem', cards: ['A-t0', 'A-t1'] } as any]);
    const rev = step(board(2), [{ actor: 'A', type: 'playItem', cards: ['A-t1', 'A-t0'] } as any]);
    expect(rev.status).toBe(fwd.status);
  });
});
