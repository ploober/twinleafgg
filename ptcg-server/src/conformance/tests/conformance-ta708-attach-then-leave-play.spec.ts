import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-708 — an Energy attached by an effect to a Pokémon that leaves play in the same step has no `energyAttached` and
 * no `moved` legs.
 *
 * Magneton ssp-059 Overvolt Discharge (card-data/final/ssp.json): "Once during your turn, you may attach up to 3 Basic
 * Energy cards from your discard pile to your [L] Pokémon in any way you like. If you use this Ability, this Pokémon
 * is Knocked Out."
 *
 * The card attaches with MOVE_CARDS, which logs nothing; the adapter synthesizes such a silent attach from the
 * before/after board (TA-412) and derives the legs from the same diff (B.81). Both read the board at the END of the
 * dispatch, where the Energy is back in the discard pile with the Knocked Out Magneton: no `energyAttached`, and the
 * discard -> Magneton -> discard round trip reads as no move at all. B.81 (1): one `moved` per physical pluck-and-place.
 * Rotomancer a312d1fe3 emits the `energyAttached` (driven 2026-10-12).
 */

const MAGNEMITE = 'meg-045';
const MAGNETON = 'ssp-059';
const BELLSPROUT = 'asc-004';
const L = 'sve-004';
const E = ['sve-001', 'sve-002', 'sve-003', 'sve-004', 'sve-005'];

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: E[2], faceUp: false }));
}
function deck(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: E[i % 5] }));
}

/** A's turn: Bellsprout Active, Magneton (Magnemite under it, one Energy) on the Bench; `pile` Lightning Energy in the discard. */
function board(pile: number): NeutralState {
  const magneton: PokemonInPlay = {
    stack: [{ iid: 'a1s0', printing: MAGNEMITE }, { iid: 'a1s1', printing: MAGNETON }],
    energy: [{ iid: 'a1e1', printing: E[2] }], tools: [], damage: 0, conditions: [], markers: markers(),
  };
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: { stack: [{ iid: 'ab1s0', printing: BELLSPROUT }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() },
        bench: [magneton], hand: [{ iid: 'ah1', printing: E[1] }], deck: deck('ad', 10), prizes: prizes('ap', 6),
        discard: Array.from({ length: pile }, (_, i) => ({ iid: `adc${i + 1}`, printing: L })),
      }),
      B: player({
        active: { stack: [{ iid: 'b1', printing: BELLSPROUT }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() },
        hand: [{ iid: 'bh1', printing: E[0] }], deck: deck('bd', 10), prizes: prizes('bp', 6),
      }),
    },
  } as NeutralState;
}

const use: NeutralAction = { actor: 'A', type: 'useAbility', source: 'a1s0', ability: 'Overvolt Discharge' } as NeutralAction;
// TA-772 / B.116: Magneton is the only [L] Pokémon, so the card is asked alone (choose {target: card}).
const attach = (card: string): NeutralAction => ({ actor: 'A', type: 'choose', target: card } as unknown as NeutralAction);

type Ev = { kind: string; card?: string; pokemon?: string; player?: string; origin?: { zone: string; pokemon?: string; role?: string }; destination?: { zone: string; pokemon?: string; role?: string } };
const attaches = (r: { events: Ev[] }) => r.events.filter(e => e.kind === 'energyAttached');
const legsOf = (r: { events: Ev[] }, iid: string) => r.events.filter(e => e.kind === 'moved' && e.card === iid)
  .map(e => `${e.origin!.zone}${e.origin!.pokemon ? ':' + e.origin!.pokemon : ''}>${e.destination!.zone}${e.destination!.pokemon ? ':' + e.destination!.pokemon : ''}`);

describe('TA-708 an Energy attached to a Pokémon that leaves play in the same step keeps its energyAttached and its legs', () => {
  it('one Energy (the attach is forced and collapses): one energyAttached on Magneton, discard > Magneton > discard [TA-708 ssp-059]', () => {
    const r = step(board(1), [use]) as unknown as { status: string; events: Ev[] };
    expect(r.status).toBe('awaitingAction');
    expect(r.events.some(e => e.kind === 'ko')).toBe(true);
    const at = attaches(r);
    expect(at.length).toBe(1);
    expect(at[0].player).toBe('A');
    expect(at[0].pokemon).toBe('a1s0');
    expect(legsOf(r, 'adc1')).toEqual(['discardPile>bench:a1s0', 'bench:a1s0>discardPile']);
  });

  it('two Energy, picked one at a time: two energyAttached and two legs each over the whole action [TA-708 ssp-059]', () => {
    const r = step(board(2), [use, attach('adc1'), attach('adc2')]) as unknown as { status: string; events: Ev[] };
    expect(attaches(r).map(e => e.pokemon)).toEqual(['a1s0', 'a1s0']);
    for (const iid of ['adc1', 'adc2']) {
      expect(legsOf(r, iid)).toEqual(['discardPile>bench:a1s0', 'bench:a1s0>discardPile']);
    }
  });

  it('CONTROL: the pause after the first pick already shows that attach, and the longer trace keeps it [TA-708 ssp-059]', () => {
    const paused = step(board(2), [use, attach('adc1')]) as unknown as { events: Ev[] };
    expect(attaches(paused).length).toBe(1);
    const full = step(board(2), [use, attach('adc1'), attach('adc2')]) as unknown as { events: Ev[] };
    expect(attaches(full).length).toBeGreaterThanOrEqual(attaches(paused).length);
  });
});
