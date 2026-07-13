import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * Broken-evolution + mis-staged fixes surfaced by `tools/check_card_invariants.py` — a pure
 * INTRA-ENGINE structural invariant over the card registry (no reference data), the same idea that
 * made the conventions checker work. This matters because the twinleaf-vs-rotomancer differential
 * covers only 16 of ~154 sets: 24 of the 27 cards below sit OUTSIDE it, so nothing else could see
 * them.
 *
 * Twinleaf resolves evolution by matching `evolvesFrom` against a card's `name`. Two failure modes,
 * and the second is worse than the first:
 *
 *   1. UNPLAYABLE — the card declares no `evolvesFrom` (Nidoking, Poliwrath, Electrode…), or names
 *      a card that does not exist (Cloyster→'Shelder' when the card is 'Shellder'; Floette→'Flabebe'
 *      when every Flabébé card is accented), or evolves from itself. Nothing can ever evolve into
 *      it, so the card is dead.
 *
 *   2. ILLEGAL — a Stage 2 tagged `Basic` while still declaring a pre-evolution (Gengar, Feraligatr,
 *      Flygon). That is not a dead card, it is a CHEAT: the card can be played straight from hand to
 *      the bench, skipping its whole evolution line.
 *
 * RED before the fix: the evolve cases return `invalidAction` (CANNOT_EVOLVE), and the Gengar
 * bench-play SUCCEEDS when it must not.
 */

const WATER = 'sve-003';
const RALTS = 'Ralts SIT';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function basic(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
function opponent(): PlayerState {
  return player({
    active: basic('B-b', RALTS),
    deck: [{ iid: 'B-d', printing: WATER }],
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `B-pz${i}`, printing: WATER, faceUp: false })),
  });
}

describe('Conformance — card structural-invariant fixes (evolvesFrom / stage)', () => {
  /** `pre` in play since turn 1 + `evo` in hand → evolving must SUCCEED. */
  function evolve(pre: string, evo: string): ReturnType<typeof step> {
    const A = player({
      active: basic('A-b', pre),
      hand: [{ iid: 'A-evo', printing: evo }],
      deck: [{ iid: 'A-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })),
    });
    return step(board(A, opponent()), [{ actor: 'A', type: 'evolve', card: 'A-evo', target: 'A-b' }]);
  }

  // Each was UNPLAYABLE: nothing could evolve into it.
  const CASES: Array<[string, string, string]> = [
    ['Nidoking bs-011 evolves from Nidorino (evolvesFrom was absent)', 'bs-037', 'bs-011'],
    ['Electrode ju-002 evolves from Voltorb (evolvesFrom was absent)', 'bs-067', 'ju-002'],
    ["Cloyster df-014 evolves from Shellder (was misspelled 'Shelder')", 'df-063', 'df-014'],
    ["Floette flf-064 evolves from Flabébé (was unaccented 'Flabebe')", 'flf-062', 'flf-064'],
    ["Annihilape ex svp-032 evolves from Primeape (was misspelled 'Primape')", 'bst-067', 'svp-032'],
    ['Gengar fo-005 evolves from Haunter (was mis-staged Basic)', 'bs-029', 'fo-005'],
  ];

  CASES.forEach(([name, pre, evo]) => {
    it(name, () => {
      const res = evolve(pre, evo);
      expect(res.status).not.toBe('invalidAction');
      const stack = res.state.players.A.active?.stack ?? [];
      expect(stack[stack.length - 1]?.printing).toBe(evo);   // the evolution is on top
    });
  });

  // The ILLEGAL half: a Stage 2 mis-tagged Basic could be played straight from hand to the bench,
  // skipping its entire evolution line. After the re-stage, that play must be rejected.
  const MIS_STAGED: Array<[string, string]> = [
    ['Gengar fo-005', 'fo-005'],
    ['Feraligatr drm-024', 'drm-024'],
    ['Flygon hp-007', 'hp-007'],
  ];

  MIS_STAGED.forEach(([name, printing]) => {
    it(`${name} is a Stage 2 — it cannot be played from hand onto the bench as a Basic`, () => {
      const A = player({
        active: basic('A-act', RALTS),
        hand: [{ iid: 'A-evo', printing }],
        deck: [{ iid: 'A-d', printing: WATER }],
        prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })),
      });
      // `benchBasic` is gated on `stage === Stage.BASIC` (play-pokemon-effect.ts:39) — NOT on the
      // presence of evolvesFrom. So while these cards were tagged Basic, this play SUCCEEDED: a
      // Stage 2 dropped straight onto the bench, skipping its whole line. That is the cheat.
      const res = step(board(A, opponent()), [{ actor: 'A', type: 'benchBasic', card: 'A-evo' }]);
      expect(res.status).toBe('invalidAction');            // it is NOT a Basic — no free bench drop
      expect(res.state.players.A.bench.length).toBe(0);
    });
  });
});
