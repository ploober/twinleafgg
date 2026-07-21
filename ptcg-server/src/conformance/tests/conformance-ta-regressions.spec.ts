import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// Regression guards for card fixes that live in src/sets and were once silently reverted by an
// origin/main merge (the "set reorg + cards" merge clobbered the card files while the framework-level
// conformance suite stayed green because nothing here exercised these specific cards). Each `it`
// locks the exact behaviour a fix restored, so the next merge that reverts one fails loudly.
//
//   TA-56  Marill "Hide" (asc-083)            — flip externalized, not a 500 fault
//   TA-55  Reshiram ex "Blazing Burst" (wht-020) — main damage placed BEFORE the discard prompt
//   TA-55  Wellspring Ogerpon "Torrential Pump" (twm-064) — 100 placed BEFORE the shuffle rider
//   TA-108 Misty's Staryu "Bubble Beam" (dri-046) — AFTER_ATTACK flip → WAS_ATTACK_USED (crash fix)

const WATER = 'Water Energy SVE';
const FIRE = 'Fire Energy SVE';
const RALTS = 'Ralts SIT';                            // neutral defender (Psychic; no Fire/Water weakness)
const MARILL = 'Marill MC';                           // asc-083, "Hide" [C]
const RESHIRAM = 'wht-020';                           // Reshiram ex, "Blazing Burst" [R,R,C]
                                                      // (canonical printing: its fullName suffix "SV11W" ≠ set code "WHT")
const OGERPON = 'Wellspring Mask Ogerpon ex TWM';     // twm-064, "Torrential Pump" [W,C,C]
const MISTYS_STARYU = 'Misty\'s Staryu DRI';          // dri-046, "Bubble Beam" [W]

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

describe('Conformance — src/sets fix regression guards (merge-revert canaries)', () => {

  it('Marill "Hide" externalizes its coin flip instead of faulting [TA-56 asc-083]', () => {
    // Pre-fix the flip fired in AFTER_ATTACK and 500'd ("coin flip needed but the next action is not
    // a flip"). WAS_ATTACK_USED externalizes it as a system flip pending — so the step must SUCCEED
    // and pause awaiting a flip, not throw.
    const res = step(
      board(player({ active: pip('A-act', MARILL, [{ iid: 'e0', printing: WATER }]) }),
            player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Hide' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.legalActions.some(a => a.type === 'flip')).toBe(true);
  });

  it('Misty\'s Staryu "Bubble Beam" externalizes its coin flip instead of faulting [TA-108 dri-046]', () => {
    // Pre-fix the flip fired in AFTER_ATTACK — outside the driver's catchable window — and 500'd
    // ("coin flip needed but the next action is not a flip"), same class as TA-56 Marill "Hide".
    // WAS_ATTACK_USED externalizes it as a system flip pending, so the step must SUCCEED and pause
    // awaiting a flip. Found by the 2026-07-21 differential fuzz (909-occ ADAPTER_ERROR at depth 1).
    const res = step(
      board(player({ active: pip('A-act', MISTYS_STARYU, [{ iid: 'e0', printing: WATER }]) }),
            player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Bubble Beam' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.legalActions.some(a => a.type === 'flip')).toBe(true);
  });

  it('Reshiram ex "Blazing Burst" places damage BEFORE the discard prompt [TA-55 wht-020]', () => {
    // The self energy-discard pauses the game; the main damage must already be on the defender.
    // Pre-fix (damage deferred to attack-end) the defender showed 0 at the pause.
    const res = step(
      board(player({ active: pip('A-act', RESHIRAM, [
              { iid: 'e0', printing: FIRE }, { iid: 'e1', printing: FIRE }, { iid: 'e2', printing: WATER }]) }),
            player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Blazing Burst' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.B.active!.damage).toBeGreaterThan(0);
  });

  it('Wellspring Ogerpon "Torrential Pump" places 100 BEFORE the shuffle rider [TA-55 twm-064]', () => {
    // The "you may shuffle 3 Energy → +120 to a Bench" rider pauses at a confirm; the base 100 must
    // already be on the Active. Pre-fix the confirm surfaced with the Active still at 0.
    const res = step(
      board(player({ active: pip('A-act', OGERPON, [
              { iid: 'e0', printing: WATER }, { iid: 'e1', printing: WATER }, { iid: 'e2', printing: WATER }]) }),
            player({ active: pip('B-act', RALTS), bench: [pip('B-bench', RALTS)] })),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Torrential Pump' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.B.active!.damage).toBeGreaterThan(0);
  });
});
