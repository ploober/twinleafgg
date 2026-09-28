import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-462 / B.66 — the `shuffled` event is ZONE-qualified: `{ kind: 'shuffled', player, zone }`.
 *
 * B.66 (2026-09-27, settles CF-72): `zone: 'deck'` means the player's DECK resting order was randomised —
 * the only value the `shuffled ≺ draw` ordering property applies to. `zone: 'hand'` means the HAND pile was
 * shuffled: "shuffles their hand and puts it on the bottom of their deck" (Grand Wing `por-009`, Special
 * Red Card `cri-082`) bottoms a randomised block and leaves the deck's existing order untouched, so it
 * licenses no randomised draw. Both are performed shuffles and both emit, at every pile size (CF-11's count
 * law applies per zone — a 1-card hand still emits).
 *
 * Why the driver cannot infer it: TA-379/TA-458 externalize the hand shuffle by moving the real deck aside,
 * moving the hand INTO the emptied deck, and raising a plain `ShuffleDeckPrompt` on it — so at the driver's
 * two emit sites the prompt is indistinguishable from a real deck shuffle (both engines even label the
 * pending "Shuffle deck"). The CARD must declare the pile: `new ShuffleDeckPrompt(id, { zone: 'hand' })`.
 * A heuristic off actionStartZones was rejected — an empty-deck Judge (hand shuffled INTO an empty deck,
 * which IS a deck shuffle) would be mislabelled.
 *
 * Every hand here holds ≤ 1 card, so CF-11 auto-resolves the shuffle and the whole effect lands in ONE step —
 * no shuffle answer to construct, and the `shuffled` event is in the step's own trace.
 *
 * Mutation guard: drop `zone` from either driver emit site and the hand cells fail; hardcode `'hand'` and the
 * Judge control fails.
 */

const SCATTERBUG = 'por-007';
const SPEWPA = 'por-008';
const VIVILLON = 'por-009';           // Stage 2 — Grand Wing lives on the top card, targeted by the basic's iid
const SPECIAL_RED_CARD = 'cri-082';
const JUDGE = 'por-076';
const BELLSPROUT = 'asc-004';
const FIRE = 'sve-002';
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
function basic(iid: string, printing = BELLSPROUT): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function vivillonStack(): PokemonInPlay {
  return {
    stack: [{ iid: 'a1s0', printing: SCATTERBUG }, { iid: 'a1s1', printing: SPEWPA }, { iid: 'a1s2', printing: VIVILLON }],
    energy: [], tools: [], damage: 0, conditions: [], markers: markers(),
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 3 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, n: number, printing = FIRE): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function turn3(a: Partial<PlayerState>, b: Partial<PlayerState>): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: player({ prizes: prizes('a'), ...a }), B: player({ prizes: prizes('b'), ...b }) },
  };
}

type Shuffled = { kind: string; player?: string; zone?: string };
function shuffled(res: { events: unknown[] }): Shuffled[] {
  return (res.events as Shuffled[]).filter(e => e.kind === 'shuffled');
}

describe('TA-462 / B.66 — shuffled is zone-qualified: hand-to-bottom emits zone:hand, a deck shuffle zone:deck', () => {
  it('Grand Wing por-009 on a 1-card opponent hand: shuffled{player:B, zone:hand} — the deck was not randomised', () => {
    const board = turn3(
      { active: vivillonStack(), deck: cards('ad', 5) },
      { active: basic('b1'), hand: cards('bh', 1), deck: cards('bd', 12) },
    );
    const res = step(board, [{ actor: 'A', type: 'useAbility', source: 'a1s0', ability: 'Grand Wing' } as never]);
    expect(res.applied).toBe(1);
    const sh = shuffled(res);
    expect(sh.length).toBe(1);
    expect(sh[0].player).toBe('B');
    expect(sh[0].zone).toBe('hand');
  });

  it('Special Red Card cri-082 on a 1-card opponent hand: shuffled{player:B, zone:hand}', () => {
    const board = turn3(
      { active: basic('a1'), hand: [{ iid: 'src', printing: SPECIAL_RED_CARD }], deck: cards('ad', 5) },
      { active: basic('b1'), hand: cards('bh', 1), deck: cards('bd', 12) },
    );
    const res = step(board, [{ actor: 'A', type: 'playItem', card: 'src' } as never]);
    expect(res.applied).toBe(1);
    const sh = shuffled(res);
    expect(sh.length).toBe(1);
    expect(sh[0].player).toBe('B');
    expect(sh[0].zone).toBe('hand');
  });

  it('control — Judge por-076 shuffles each hand INTO its deck: every shuffled carries zone:deck (the deck IS randomised)', () => {
    // Both decks ≤ 1 after the shuffle-in, so both shuffles auto-resolve inside the one step (CF-11).
    const board = turn3(
      { active: basic('a1'), hand: [{ iid: 'judge', printing: JUDGE }], deck: cards('ad', 1) },
      { active: basic('b1'), hand: [], deck: cards('bd', 1) },
    );
    const res = step(board, [{ actor: 'A', type: 'playSupporter', card: 'judge' } as never]);
    expect(res.applied).toBe(1);
    const sh = shuffled(res);
    expect(sh.length).toBeGreaterThan(0);
    expect(sh.every(e => e.zone === 'deck')).toBe(true);
  });
});
