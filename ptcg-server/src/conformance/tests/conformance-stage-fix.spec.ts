import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * Wrong `stage` on 5 cards — a field the validator NEVER COMPARED until now, so these were invisible.
 *
 * Every one is image-verified against the printed card; canonical is right and twinleaf is wrong on
 * all five. Two of them are not cosmetic:
 *
 *   - `cre-044` Rapid Strike Urshifu — printed STAGE 1 / "Evolves from Kubfu", modelled as `BASIC`
 *     with NO evolvesFrom. `benchBasic` gates on `stage === Stage.BASIC`, so a Stage 1 could be
 *     dropped straight from hand onto the bench, SKIPPING its evolution. A cheat, not a mislabel.
 *     It also evaded the intra-engine invariant, which only flags a mis-staged Basic that still
 *     CARRIES an evolvesFrom — strip that too and it looks like a perfectly legal Basic.
 *
 *   - `fo-040` Omastar — printed STAGE 2 / "Evolves from Omanyte", modelled as `STAGE_1`. Evolution
 *     requires `base.stage < evo.stage`; twinleaf's Omanyte printings are themselves Stage 1, so
 *     `Stage1 < Stage1` is false and the evolution is BLOCKED — Omastar was UNPLAYABLE.
 *
 * The other three are wrong labels with real mechanical consequences: `crz-014` Leafeon VSTAR was a
 * plain Stage 1 (losing the VSTAR rule), `sv-147` Staraptor FB LV.X was a Stage 1 (LV.X may only be
 * put on the ACTIVE), and `plb-004` Cradily was a Stage 2 (printed Stage 1 — affects Rare Candy).
 */

const WATER = 'sve-003';
const RALTS = 'Ralts SIT';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function inPlay(iid: string, printing: string): PokemonInPlay {
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
    active: inPlay('B-b', RALTS),
    deck: [{ iid: 'B-d', printing: WATER }],
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `B-pz${i}`, printing: WATER, faceUp: false })),
  });
}

describe('Conformance — wrong-stage fixes (a field the validator never compared)', () => {
  it('cre-044 Rapid Strike Urshifu is a Stage 1 — it cannot be benched from hand as a Basic', () => {
    const A = player({
      active: inPlay('A-act', RALTS),
      hand: [{ iid: 'A-urs', printing: 'cre-044' }],
      deck: [{ iid: 'A-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })),
    });
    const res = step(board(A, opponent()), [{ actor: 'A', type: 'benchBasic', card: 'A-urs' }]);
    expect(res.status).toBe('invalidAction');       // NOT a Basic — no free bench drop
    expect(res.state.players.A.bench.length).toBe(0);
  });

  it('cre-044 Rapid Strike Urshifu evolves from Kubfu', () => {
    const A = player({
      active: inPlay('A-kubfu', 'cre-093'),          // Kubfu (Chilling Reign)
      hand: [{ iid: 'A-urs', printing: 'cre-044' }],
      deck: [{ iid: 'A-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })),
    });
    const res = step(board(A, opponent()), [{ actor: 'A', type: 'evolve', card: 'A-urs', target: 'A-kubfu' }]);
    expect(res.status).not.toBe('invalidAction');
    const stack = res.state.players.A.active?.stack ?? [];
    expect(stack[stack.length - 1]?.printing).toBe('cre-044');
  });

  it('fo-040 Omastar is a Stage 2 — it can evolve onto a Stage-1 Omanyte (was BLOCKED as a Stage 1)', () => {
    const A = player({
      active: inPlay('A-oman', 'ss-070'),            // Omanyte, itself a Stage 1
      hand: [{ iid: 'A-omas', printing: 'fo-040' }],
      deck: [{ iid: 'A-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })),
    });
    // As a Stage 1, `base.stage < evo.stage` was Stage1 < Stage1 = false → evolution blocked.
    const res = step(board(A, opponent()), [{ actor: 'A', type: 'evolve', card: 'A-omas', target: 'A-oman' }]);
    expect(res.status).not.toBe('invalidAction');
    const stack = res.state.players.A.active?.stack ?? [];
    expect(stack[stack.length - 1]?.printing).toBe('fo-040');
  });
});
