import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION
} from '../neutral-types';

/**
 * TA-244 — `GameMessage.CHOOSE_NEW_ACTIVE_POKEMON` carries TWO flows, and `choose-pokemon`'s CF-14
 * gate used to exclude BOTH from the collapse by name.
 *
 *   post-KO REPLACEMENT   the Active was Knocked Out; the player must promote from the Bench.
 *                         BOTH engines surface this even at one candidate, so it must STAY surfaced —
 *                         collapsing it would manufacture a new divergence, not close one.
 *   attack-rider SELF-SWITCH  "You may switch this Pokémon with 1 of your Benched Pokémon"
 *                         (Mega Latias ex `meg-181` *Strafe*). Answered `confirm:true` with one
 *                         Benched Pokémon, the switch is forced — rotomancer applies it and moves on,
 *                         twinleaf surfaced a 1-option `promoteBench`. This was the largest residual
 *                         noise class after the 2026-08-11 batch: all 8 newly-reporting seeds in the
 *                         post-fix targeted re-fuzz carried this one signature.
 *
 * The flows are separated by the BOARD, not the message: at a replacement the prompting player's
 * Active slot is EMPTY; at a self-switch it is still OCCUPIED. Both halves were measured on both
 * engines before the gate was written, and both are locked here — the negative control is the load-
 * bearing one, because the tempting over-broad fix (collapse the message unconditionally) passes the
 * genuine cell and breaks the post-KO promote silently.
 */

const WATER = 'sve-003', COLOR = 'sve-001';
const RALTS = 'sit-067';          // Ralts, 70 HP neutral (printing id: the projection emits ids, not fullNames)
const LATIAS = 'meg-181';         // Mega Latias ex — "Strafe" [C] 40, "You may switch this Pokémon…"
const BELLSPROUT = 'asc-004';     // Erika's Bellsprout, 60 HP — "Vine Slap" [G] 20

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function en(printing: string, n: number, tag: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}e${i}`, printing }));
}
function pip(iid: string, printing: string, energy: CardRef[] = [], damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const wd = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}-pz${i}`, printing: WATER, faceUp: false })),
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: wd(A, 'A'), B: wd(B, 'B') },
  };
}
const types = (r: ReturnType<typeof step>): string[] =>
  (r.pending?.legalActions ?? []).map(a => (a as { type: string }).type);
const confirmYes = { actor: 'A' as const, type: 'confirm' as const, value: true };

describe('Conformance — CHOOSE_NEW_ACTIVE_POKEMON: a self-switch collapses, a post-KO promote does not (TA-244)', () => {

  it('a FORCED self-switch is applied atomically — no 1-option promoteBench', () => {
    const r = step(
      board(player({ active: pip('A-act', LATIAS, en(COLOR, 1, 'a')), bench: [pip('A-b0', RALTS)] }),
            player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A' as const, type: 'declareAttack' as const, source: 'A-act', name: 'Strafe' }, confirmYes],
    );
    // No decision is externalized for a switch with exactly one destination...
    expect(types(r)).not.toContain('promoteBench');
    // ...and the EFFECT landed: the Bench Pokémon is Active and Mega Latias ex is benched. Asserting
    // the swap rather than the absent menu is the CF-14 guard rule — an absent pending is also what a
    // silently DROPPED decision looks like, and only the state tells them apart.
    expect(r.state.players.A.active!.stack[0].printing).toBe(RALTS);
    expect(r.state.players.A.bench[0].stack[0].printing).toBe(LATIAS);
  });

  it('NEGATIVE CONTROL — a post-KO promote with one Bench is still SURFACED (both engines pend it)', () => {
    // Vine Slap (20) finishes a Ralts already on 50 of its 70 HP. Prizes come first (CF-7 / #2026),
    // so one takePrize precedes the promotion. The promotion itself must remain a decision: the
    // over-broad fix — collapsing CHOOSE_NEW_ACTIVE_POKEMON whenever it has one candidate — passes
    // the cell above and breaks THIS one, which is the whole reason the gate reads the board.
    const r = step(
      board(player({ active: pip('A-act', BELLSPROUT, en('sve-009', 1, 'a')) }),
            player({ active: pip('B-act', RALTS, [], 50), bench: [pip('B-b0', RALTS)] })),
      [
        { actor: 'A' as const, type: 'declareAttack' as const, source: 'A-act', name: 'Vine Slap' },
        { actor: 'A' as const, type: 'takePrize' as const, index: 0 },
      ],
    );
    expect(r.pending?.actor).toBe('B');
    expect(types(r)).toContain('promoteBench');
    // The KO really happened — otherwise this cell would pass for the wrong reason.
    expect(r.state.players.A.prizes.length).toBe(5);
  });

  it('a self-switch with TWO Benched Pokémon stays a genuine choice', () => {
    // The collapse is gated on the candidate count, not on "self-switch always collapses". With two
    // destinations the player really is choosing, so the pending must appear.
    const r = step(
      board(player({ active: pip('A-act', LATIAS, en(COLOR, 1, 'a')),
                     bench: [pip('A-b0', RALTS), pip('A-b1', BELLSPROUT)] }),
            player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A' as const, type: 'declareAttack' as const, source: 'A-act', name: 'Strafe' }, confirmYes],
    );
    expect(types(r)).toContain('promoteBench');
    expect((r.pending?.legalActions ?? []).length).toBe(2);
    expect(r.state.players.A.active!.stack[0].printing).toBe(LATIAS);  // nothing applied yet
  });
});
