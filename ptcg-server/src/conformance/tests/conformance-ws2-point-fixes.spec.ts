import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// WS2 point-fix repros (fix-backlog-plan.md). Each `it` is RED before its card/harness fix and GREEN
// after — the per-card protocol's step (1). They double as merge-revert canaries alongside
// conformance-ta-regressions.spec.ts.
//
//   TA-136  optional effect offered with no way to decline  ("any amount" / "up to N" ⊇ zero)
//   TA-137  conditional rider applied when its condition is FALSE (self-consistency vs the +140)
//   TA-139  wrong perspective — own side read where the card says the opponent's
//   TA-140  a self-discard reported as a `ko` (event-only; state already agrees)

const FIRE = 'Fire Energy SVE';
const METAL = 'Metal Energy SVE';
const WATER = 'Water Energy SVE';
const GRASS = 'Grass Energy SVE';
const PSY = 'Psychic Energy SVE';
const DARK = 'Darkness Energy SVE';

const RALTS = 'Ralts SIT';                              // a Basic (Psychic; no Fire/Water weakness)
const HEARTHFLAME = 'Hearthflame Mask Ogerpon ex TWM';  // twm-040, "Dynamic Blaze" [R,R,R]; also a 210-HP BASIC defender
const DELCATTY = 'Delcatty ASC';                        // asc-166, "Energy Crush" [C,C]
const ESPEON = 'Espeon ex PRE';                         // pre-034, "Amazez" [G,P,D]
const CHARIZARD = 'pfl-013';                            // Mega Charizard X ex, "Inferno X" [R,R] (cid: fullName suffix "M2" is not a set code)
const NIDORINA = "Team Rocket's Nidorina DRI";          // dri-115, "Dark Awakening" [D]
const REVAVROOM = 'Revavroom ex SFA';                   // sfa-015, "Shattering Speed" [M,M,M], 280 HP

function markers(played = 1): PokemonMarkers {
  return { playedOnTurn: played, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(over: Partial<PlayerFlags> = {}): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0,
    vstarUsed: false, ...over,
  };
}
function pip(iid: string, printing: string, energy: CardRef[] = [], played = 1, conditions: ConditionToken[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions, markers: markers(played) };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState, turn = 3): NeutralState {
  const withDefaults = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }],
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withDefaults(A, 'A'), B: withDefaults(B, 'B') },
  };
}
function energies(printing: string, n: number, prefix: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${prefix}${i}`, printing }));
}

describe('WS2 point-fix repros', () => {

  // ── TA-137 ────────────────────────────────────────────────────────────────────────────────────
  describe('TA-137 — Dynamic Blaze discard is gated on the +140 predicate [twm-040 hearthflame]', () => {
    // "If your opponent's Active is an Evolution Pokémon, this attack does 140 more damage, AND
    // discard all Energy from this Pokémon." Both clauses share ONE condition.
    function db(defender: string): NeutralState {
      return board(
        player({ active: pip('A-act', HEARTHFLAME, energies(FIRE, 3, 'e')) }),
        player({ active: pip('B-act', defender) }),
      );
    }

    it('vs a BASIC defender: NO +140 and NO discard (attacker keeps its Energy)', () => {
      // Defender is a 210-HP Basic (survives the base 140, and being Basic makes the condition false).
      const res = step(db(HEARTHFLAME), [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Dynamic Blaze' }]);
      expect(res.state.players.B.active!.damage).toBe(140);          // base only, condition false
      // Pre-fix: the discard ran unconditionally -> attacker's 3 Energy vanished.
      const attacker = res.state.players.A.active ?? res.state.players.A.bench.find(b => b.stack[0].iid === 'A-act')!;
      expect(attacker.energy.length).toBe(3);
    });

    it('vs an EVOLUTION defender: +140 AND the discard both fire', () => {
      // Defender is a 360-HP Stage-2 (Evolution, so the condition is true; survives 280 so damage is readable).
      const res = step(db(CHARIZARD), [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Dynamic Blaze' }]);
      expect(res.state.players.B.active!.damage).toBe(280);          // 140 + 140
      const attacker = res.state.players.A.active ?? res.state.players.A.bench.find(b => b.stack[0].iid === 'A-act')!;
      expect(attacker.energy.length).toBe(0);                        // all Energy discarded
    });
  });

  // ── TA-139 ────────────────────────────────────────────────────────────────────────────────────
  describe('TA-139 — wrong perspective', () => {
    it('Energy Crush counts the OPPONENT\'s Energy, not the attacker\'s [asc-166 delcatty]', () => {
      // B has ZERO Energy anywhere; the attacker carries its own [C,C] cost. Correct = 0; the bug
      // counted the attacker's 2 -> 80.
      const res = step(
        board(
          player({ active: pip('A-act', DELCATTY, energies(WATER, 2, 'e')) }),
          player({ active: pip('B-act', REVAVROOM) }),        // 280 HP: survives the buggy 80 so damage is readable
        ),
        [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Energy Crush' }],
      );
      expect(res.state.players.B.active!.damage).toBe(0);
    });

    it('Energy Crush scales with the opponent\'s Energy count [asc-166 delcatty]', () => {
      const res = step(
        board(
          player({ active: pip('A-act', DELCATTY, energies(WATER, 2, 'e')) }),
          player({ active: pip('B-act', REVAVROOM, [{ iid: 'be0', printing: WATER }]) }),   // B: one Energy (280 HP survivor)
        ),
        [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Energy Crush' }],
      );
      expect(res.state.players.B.active!.damage).toBe(40);           // 40 x 1 (B's single Energy)
    });

    it('Amazez shuffles the OPPONENT\'s deck, not the attacker\'s [pre-034 espeon-ex]', () => {
      // Devolved cards go into the opponent's deck; the shuffle must be of THAT deck. Pre-fix the
      // driver emitted `shuffled{player:'A'}` (the attacker's own deck).
      const res = step(
        board(
          player({ active: pip('A-act', ESPEON, [{ iid: 'g', printing: GRASS }, { iid: 'p', printing: PSY }, { iid: 'd', printing: DARK }]) }),
          player({ active: pip('B-act', RALTS) }),
        ),
        [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Amazez' }],
      );
      const shuffles = res.events.filter(e => e.kind === 'shuffled');
      expect(shuffles.length).toBeGreaterThan(0);
      expect(shuffles.every(e => (e as { player: string }).player === 'B')).toBe(true);
    });
  });

  // ── TA-136 ────────────────────────────────────────────────────────────────────────────────────
  describe('TA-136 — an optional effect must offer the zero branch', () => {
    it('Inferno X offers a decline at 0 discards ("any amount" ⊇ zero) [pfl-013 mega-charizard]', () => {
      const res = step(
        board(
          player({ active: pip('A-act', CHARIZARD, energies(FIRE, 2, 'e')) }),
          player({ active: pip('B-act', RALTS) }),
        ),
        [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Inferno X' }],
      );
      expect(res.status).toBe('awaitingAction');
      // The internal endChoice terminator surfaces on the wire as the CF-4 explicit stop.
      expect(res.pending!.legalActions.some(a => a.type === 'confirm' && (a as { value?: boolean }).value === false)).toBe(true);
    });

    it('Inferno X declined = 0 damage [pfl-013 mega-charizard]', () => {
      const res = step(
        board(
          player({ active: pip('A-act', CHARIZARD, energies(FIRE, 2, 'e')) }),
          player({ active: pip('B-act', RALTS) }),
        ),
        [
          { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Inferno X' },
          { actor: 'A', type: 'confirm', value: false },   // decline the discard (the CF-4 stop)
        ],
      );
      expect(res.state.players.B.active!.damage).toBe(0);
    });

    it('Dark Awakening offers a decline at 0 chosen ("up to 2" ⊇ zero) [dri-115 nidorina]', () => {
      // The attacker Nidorina is itself a choosable [D] target (its [D] evolution Nidoqueen exists),
      // so the ChoosePokemon prompt is a real choice; with min:0 it must also offer endChoice.
      const res = step(
        board(
          player({ active: pip('A-act', NIDORINA, [{ iid: 'd0', printing: DARK }]) }),
          player({ active: pip('B-act', RALTS) }),
        ),
        [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Dark Awakening' }],
      );
      expect(res.status).toBe('awaitingAction');
      expect(res.pending!.legalActions.some(a => a.type === 'confirm' && (a as { value?: boolean }).value === false)).toBe(true);
    });
  });

  // ── TA-140 ────────────────────────────────────────────────────────────────────────────────────
  it('TA-140 — an effect self-discard is NOT a `ko` [sfa-015 revavroom]', () => {
    // "Discard this Pokémon and all attached cards." B's Revavroom (280 HP) survives the 250, so the
    // only Pokémon leaving play is the attacker — by effect, not a Knock Out. Pre-fix the projection
    // inferred a `ko{player:'A'}` from "in play before, gone after"; roto (and the state) emit none.
    const res = step(
      board(
        player({ active: pip('A-act', REVAVROOM, energies(METAL, 3, 'e')), bench: [pip('A-b', RALTS)] }),
        player({ active: pip('B-act', REVAVROOM) }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Shattering Speed' }],
    );
    expect(res.state.players.A.discard.some(c => c.iid === 'A-act')).toBe(true);   // self-discard happened
    expect(res.state.players.B.active!.damage).toBe(250);                          // 250 landed on B
    expect(res.events.filter(e => e.kind === 'ko' && (e as { player: string }).player === 'A')).toEqual([]);
  });
});
