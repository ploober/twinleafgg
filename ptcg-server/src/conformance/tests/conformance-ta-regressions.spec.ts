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
//   TA-55  Reshiram ex "Blazing Burst" (wht-020) — main damage placed BEFORE the discard prompt
//   TA-55  Wellspring Ogerpon "Torrential Pump" (twm-064) — 100 placed BEFORE the shuffle rider

const WATER = 'Water Energy SVE';
const FIRE = 'Fire Energy SVE';
const RALTS = 'Ralts SIT';                            // neutral defender (Psychic; no Fire/Water weakness)
const MARILL = 'Marill MC';                           // asc-083, "Hide" [C]
const RESHIRAM = 'wht-020';                           // Reshiram ex, "Blazing Burst" [R,R,C]
                                                      // (canonical printing: its fullName suffix "SV11W" ≠ set code "WHT")
const OGERPON = 'Wellspring Mask Ogerpon ex TWM';     // twm-064, "Torrential Pump" [W,C,C]
const MISTYS_STARYU = 'Misty\'s Staryu DRI';          // dri-046, "Bubble Beam" [W]
const CROCONAW = 'Croconaw MC';                       // asc-042, "Crunch" [W,W] — heads: discard 1 Energy from Defender

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

describe('Conformance — driver: an after-attack coin flip is externalized, not a fault', () => {
  // A coin flip raised in the AFTER_ATTACK window (Misty's Staryu "Bubble Beam", Marill "Hide")
  // resolves AFTER the attack's animation WaitPrompt, so it lands in Store.reducePrompt — which has
  // no clone/rollback — rather than the top-level attack dispatch. The driver must still pause with a
  // system `flip` pending and drive it from the log, not 500. The cards stay pristine (AFTER_ATTACK
  // is a legitimate effect-timing choice); this guards the DRIVER, not the cards. Reverts the earlier
  // TA-56/TA-108 card workarounds that moved these flips to WAS_ATTACK_USED purely to please the harness.

  it('Misty\'s Staryu "Bubble Beam" (dri-046) pauses damage-first, then resolves on the flip', () => {
    const setup = (): NeutralState => board(
      player({ active: pip('A-act', MISTYS_STARYU, [{ iid: 'e0', printing: WATER }]) }),
      player({ active: pip('B-act', RALTS) }));

    // Bare attack: pause on a system flip, with the base 20 ALREADY on the defender (damage-first —
    // the after-attack window fires after DealDamageEffect, which the card workaround got backwards).
    const paused = step(setup(), [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Bubble Beam' }]);
    expect(paused.status).toBe('awaitingAction');
    expect(paused.pending!.actor).toBe('system');
    expect(paused.pending!.legalActions.some(a => a.type === 'flip')).toBe(true);
    expect(paused.state.players.B.active!.damage).toBe(20);

    // heads → Paralyzed, tails → not; 20 damage either way.
    const heads = step(setup(), [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Bubble Beam' },
      { actor: 'system', type: 'flip', face: 'heads' },
    ]);
    expect(heads.state.players.B.active!.damage).toBe(20);
    expect(heads.state.players.B.active!.conditions).toContain('paralyzed');
    const tails = step(setup(), [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Bubble Beam' },
      { actor: 'system', type: 'flip', face: 'tails' },
    ]);
    expect(tails.state.players.B.active!.damage).toBe(20);
    expect(tails.state.players.B.active!.conditions).not.toContain('paralyzed');
  });

  it('Marill "Hide" (asc-083) — a 0-damage after-attack flip also pauses, not faults', () => {
    const res = step(
      board(player({ active: pip('A-act', MARILL, [{ iid: 'e0', printing: WATER }]) }),
            player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Hide' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.legalActions.some(a => a.type === 'flip')).toBe(true);
  });
});

describe('Conformance — src/sets card-bug regression guards', () => {
  // TA-109  Croconaw "Crunch" (asc-042) — heads discards 1 Energy from the Defending Pokémon. The card
  // must GUARD that prompt: if the Defender has no Energy, raising a min-1 DiscardEnergyPrompt is a card
  // bug (the prompt is unanswerable — validate() rejects both an empty result and a cancel), which the
  // conformance driver surfaces as a 500. Every sibling opponent-discard card (blaziken-gx, umbreon-gx)
  // already guards `if energy===0 return`. Surfaced by the fuzz once the CF-24 driver fix let the flip be
  // driven past. This guards the CARD, not the harness.

  it('Croconaw "Crunch" heads vs an energyless Defender resolves without faulting [TA-109 asc-042]', () => {
    const run = () => step(
      board(player({ active: pip('A-act', CROCONAW, [{ iid: 'e0', printing: WATER }, { iid: 'e1', printing: WATER }]) }),
            player({ active: pip('B-act', RALTS) })),   // RALTS holds zero Energy
      [
        { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Crunch' },
        { actor: 'system', type: 'flip', face: 'heads' },
      ],
    );
    expect(run).not.toThrow();                            // pre-fix: throws the 'Discard energy' validate fault
    const res = run();
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.B.active!.damage).toBe(50);  // base 50 still applied
    expect(res.state.players.B.active!.energy.length).toBe(0);
  });

  it('Croconaw "Crunch" heads still offers the discard when the Defender HAS Energy [TA-109 asc-042]', () => {
    // Positive control: the guard must not suppress the real discard — the prompt is still raised.
    const res = step(
      board(player({ active: pip('A-act', CROCONAW, [{ iid: 'e0', printing: WATER }, { iid: 'e1', printing: WATER }]) }),
            player({ active: pip('B-act', RALTS, [{ iid: 'be0', printing: WATER }]) })),
      [
        { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Crunch' },
        { actor: 'system', type: 'flip', face: 'heads' },
      ],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.legalActions.some(a => a.type === 'discard')).toBe(true);
  });
});
