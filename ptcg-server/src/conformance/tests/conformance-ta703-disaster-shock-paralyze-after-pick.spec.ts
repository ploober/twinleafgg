import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-703 — B.82: Disaster Shock asc-061 Paralyzes the opponent's Active BEFORE the Energy pick.
 *
 * Mega Eelektross ex (card-data/final/asc.json) Disaster Shock [L][L][L] 190: "You may discard 2 [Lightning] Energy
 * from this Pokémon and make your opponent's Active Pokémon Paralyzed."
 *
 * B.82 / B.89 (1) (#1834, #2002): every choice the attacker makes is made before the attack's effects apply. With
 * three [L] attached the "which 2" pick is a Step-D choice: it is asked before the damage (the prompt is deferredMove,
 * the picks are recorded as `chosen`), the 190 lands, then the chosen Energy are discarded and the Paralysis is applied
 * with them, after the damage. Twinleaf asked the pick and applied the Paralysis at once, so B's Active was already
 * Paralyzed while the pick was open (rotomancer: not until the pick closes). The Paralysis belongs with the discard:
 * applied in the same after-damage step, and only when Energy was discarded.
 */

const E: Record<string, string> = {
  G: 'sve-001', R: 'sve-002', W: 'sve-003', L: 'sve-004', P: 'sve-005', F: 'sve-006', D: 'sve-007', M: 'sve-008',
};
const EELEKTROSS = 'asc-061';
const DEFENDER = 'twm-106';   // Greninja ex, 310 HP: survives the 190

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: string = ''): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.split('').filter(t => t !== '').map((t, i) => ({ iid: `${iid}e${i}`, printing: E[t] })),
    tools: [], damage: 0, conditions: [], markers: markers(),
  };
}
function cards(tag: string, ps: string[]): CardRef[] {
  return ps.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, Array(n).fill(E.M)).map(c => ({ ...c, faceUp: false }));
}

function board(energy: string): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
    stadium: null,
    players: {
      A: player({
        active: mon('a1', EELEKTROSS, energy), bench: [mon('ab1', 'asc-004')],
        hand: cards('ah', [E.G]), deck: cards('ad', Array(10).fill(E.G)), prizes: prizes('ap', 3),
      }),
      B: player({
        active: mon('b1', DEFENDER, 'WW'), bench: [mon('bb1', 'asc-004')],
        hand: cards('bh', [E.G]), deck: cards('bd', Array(10).fill(E.G)), prizes: prizes('bp', 3),
      }),
    },
  } as NeutralState;
}

const A = (o: Record<string, unknown>) => ({ actor: 'A', ...o } as never);
const declare = A({ type: 'declareAttack', source: 'a1', name: 'Disaster Shock' });
const disc = (target: string) => A({ type: 'discard', owner: 'A', target });
const yes = A({ type: 'confirm', value: true });
const no = A({ type: 'confirm', value: false });

function attackEvents(events: NeutralEvent[]): NeutralEvent[] {
  const i = events.findIndex(e => e.kind === 'attackUsed');
  const j = events.findIndex(e => e.kind === 'turnEnded');
  return events.slice(i + 1, j < 0 ? undefined : j);
}
const idx = (events: NeutralEvent[], kind: string) => events.findIndex(e => e.kind === kind);
const lastIdx = (events: NeutralEvent[], kind: string) => events.map(e => e.kind as string).lastIndexOf(kind);
const chosenCards = (events: NeutralEvent[]) => events.filter(e => e.kind === 'chosen').map(e => (e as { card?: string }).card);
const energyOn = (s: NeutralState) => (s.players.A.active?.energy ?? []).map(c => c.iid);
const bConditions = (s: NeutralState) => s.players.B.active?.conditions ?? [];

describe('TA-703 Disaster Shock asc-061: the Energy pick first; the discard and the Paralysis together after the damage', () => {
  it('three [L] attached, accepted: at the 2-of-3 pick B\'s Active is NOT yet Paralyzed and nothing has moved [TA-703]', () => {
    const r = step(board('LLL'), [declare, yes]);
    const la = r.pending?.legalActions ?? [];
    expect(la.length).toBeGreaterThan(0);
    expect(la.every(a => a.type === 'discard')).toBe(true);
    expect(bConditions(r.state)).toEqual([]);
    expect(r.state.players.B.active?.damage).toBe(0);
    expect(energyOn(r.state)).toEqual(['a1e0', 'a1e1', 'a1e2']);
  });

  it('after the first pick B\'s Active is still not Paralyzed; the pick is recorded as chosen [TA-703]', () => {
    const r = step(board('LLL'), [declare, yes, disc('a1e0')]);
    expect(bConditions(r.state)).toEqual([]);
    expect(chosenCards(r.events)).toEqual(['a1e0']);
    expect(energyOn(r.state)).toEqual(['a1e0', 'a1e1', 'a1e2']);
  });

  it('after both picks: chosen x2, the 190, then both to the discard pile and B\'s Active Paralyzed [TA-703]', () => {
    const r = step(board('LLL'), [declare, yes, disc('a1e0'), disc('a1e1')]);
    const ev = attackEvents(r.events);
    expect(chosenCards(ev)).toEqual(['a1e0', 'a1e1']);
    expect(r.state.players.B.active?.damage).toBe(190);
    expect(lastIdx(ev, 'chosen')).toBeLessThan(idx(ev, 'damaged'));
    expect(idx(ev, 'damaged')).toBeLessThan(idx(ev, 'moved'));
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['a1e0', 'a1e1']);
    expect(energyOn(r.state)).toEqual(['a1e2']);
    expect(bConditions(r.state)).toEqual(['paralyzed']);
  });

  it('CONTROL: declined, the 190 lands, nothing is discarded and B\'s Active is not Paralyzed', () => {
    const r = step(board('LLL'), [declare, no]);
    expect(r.state.players.B.active?.damage).toBe(190);
    expect(energyOn(r.state)).toEqual(['a1e0', 'a1e1', 'a1e2']);
    expect(bConditions(r.state)).toEqual([]);
  });
});
