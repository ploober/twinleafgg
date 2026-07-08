import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// Cross-engine "problem child" MECHANIC guards (2026-07-07 backfill). These assert twinleaf's
// canonical behaviour for a set of fundamental engine rules that are subtle enough that the
// rotomancer team's own engine got EACH of them wrong at some point (mined from their git log +
// the RE findings). They are not tied to one card fix — they lock the shared rules a NEW engine
// added to the differential harness is most likely to diverge on, and double as a twinleaf
// regression net. Each scenario is directly reusable as a cross-engine differential seed.
//
//   confusion attack-flip   — a Confused attacker's attack surfaces a coin flip   (rotomancer 949b8212; base rule)
//   asleep / paralyzed gate — an Asleep/Paralyzed Active can't attack OR retreat  (rotomancer 47308e7a; §1.28)
//   condition recovery      — conditions clear when a Pokémon leaves the Active    (rotomancer 017bf0f0)
//   exact-lethal KO         — damage == HP is a KO (>=, not >)                      (RE-13; rotomancer 8d9b65b6)
//   attack ends the turn    — no second attack after declaring one                 (rotomancer 07db0be3; F-010)

const WATER = 'sve-003';
const RALTS = 'Ralts SIT';
const TANKY = 'Wellspring Mask Ogerpon ex TWM';   // 210 HP — survives a small hit so the turn pauses
const DUN = 'tef-128';   // Dunsparce: "Gnaw" [C] 10 (index 0), "Dig" [C,C] flip (index 1), retreat []

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function en(printing: string, n: number, tag: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}e${i}`, printing }));
}
function inPlay(iid: string, printings: string[], energy: CardRef[] = [], damage = 0, conditions: ConditionToken[] = []): PokemonInPlay {
  return { stack: printings.map((p, i) => ({ iid: i === printings.length - 1 ? iid : `${iid}-s${i}`, printing: p })), energy, tools: [], damage, conditions, markers: markers() };
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
  return { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A: wd(A, 'A'), B: wd(B, 'B') } };
}
const gnaw = { actor: 'A' as const, type: 'declareAttack' as const, source: 'A-act', name: 'Gnaw' };
const types = (r: ReturnType<typeof step>): string[] => (r.pending?.legalActions ?? []).map(a => (a as { type: string }).type);
const reason = (r: ReturnType<typeof step>): string | undefined => (r as { reasonCode?: string }).reasonCode;

describe('Conformance — cross-engine mechanic regression guards', () => {

  it('a Confused attacker\'s attack surfaces a confusion coin flip', () => {
    // Confusion is a coin flip AT ATTACK TIME (tails → the attack fails + self-damage). The attack is
    // still offered; declaring it pauses on a `system` flip. (Rotomancer had confusion recovery but no
    // attack-time flip until 949b8212 — every Confused attacker was mis-simulated.)
    const start = board(player({ active: inPlay('A-act', [DUN], en(WATER, 2, 'a'), 0, ['confused']) }),
                        player({ active: inPlay('B-act', [TANKY]) }));
    expect(types(step(start, []))).toContain('declareAttack');   // still declarable while Confused
    const r = step(start, [gnaw]);
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('flip');
  });

  it('an Asleep Active cannot attack (not offered, and rejected if forced)', () => {
    const start = board(player({ active: inPlay('A-act', [DUN], en(WATER, 2, 'a'), 0, ['asleep']) }),
                        player({ active: inPlay('B-act', [TANKY]) }));
    expect(types(step(start, []))).not.toContain('declareAttack');
    const r = step(start, [gnaw]);
    expect(r.status).toBe('invalidAction');
    expect(reason(r)).toBe('CONDITION_BLOCKED');
  });

  it('a Paralyzed Active cannot attack OR retreat', () => {
    // A bench is present, so retreat would be structurally possible — Paralysis is what blocks it.
    const start = board(player({ active: inPlay('A-act', [DUN], en(WATER, 2, 'a'), 0, ['paralyzed']), bench: [inPlay('A-b', [RALTS])] }),
                        player({ active: inPlay('B-act', [TANKY]) }));
    const menu = types(step(start, []));
    expect(menu).not.toContain('declareAttack');
    expect(menu).not.toContain('retreat');
    const r = step(start, [gnaw]);
    expect(r.status).toBe('invalidAction');
    expect(reason(r)).toBe('CONDITION_BLOCKED');
  });

  it('a Special Condition clears when the Pokémon leaves the Active spot (retreat)', () => {
    // Dunsparce has free retreat ([]). Poisoned, it retreats to the Bench; the poison must clear on the
    // move off Active (it carries neither to the Bench nor onto the promoted Pokémon).
    const r = step(
      board(player({ active: inPlay('A-act', [DUN], [], 0, ['poisoned']), bench: [inPlay('A-b', [RALTS])] }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [{ actor: 'A', type: 'retreat', to: 0 }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.active!.conditions).not.toContain('poisoned');
    expect(r.state.players.A.bench.every(b => !b.conditions.includes('poisoned'))).toBe(true);
  });

  it('a Pokémon whose damage equals its HP is Knocked Out (exact-lethal, >= not >)', () => {
    // Ralts (70 HP) at 60 damage; Gnaw's 10 brings it to exactly 70 → KO (takePrize surfaces, the
    // Active Spot empties). Pre-fix engines that used strict `>` left the defender alive at full-equal.
    const r = step(
      board(player({ active: inPlay('A-act', [DUN], en(WATER, 1, 'a')) }),
            player({ active: inPlay('B-act', [RALTS], [], 60) })),
      [gnaw],
    );
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).toContain('takePrize');
    expect(r.state.players.B.active).toBeNull();
  });

  it('declaring an attack ends the turn — no second attack for the attacker', () => {
    const r = step(
      board(player({ active: inPlay('A-act', [DUN], en(WATER, 2, 'a')) }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [gnaw],
    );
    expect(r.status).toBe('awaitingAction');
    // The pending has passed to B (A's turn is over); A is not re-offered a declareAttack.
    expect(r.pending!.actor).toBe('B');
    expect(types(r)).not.toContain('declareAttack');
  });
});
