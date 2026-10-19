import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-715 / B.110 (owner 2026-10-19, adopting rotomancer N-0330 / N-0438): Onyx (Umbreon ex pre-060: "Discard all Energy
 * from this Pokémon, and take a Prize card.", no damage) names its Prize at Step D, before the Energy is discarded. A
 * face-down Prize so named records `chosen {origin: prizes, visibility: hidden}` (a face-up one `public`); a one-Prize
 * menu is no decision and records none (B.93), though the pick is still asked (B.25). Twinleaf discarded the Energy, then
 * asked the Prize, with no chosen. Rotomancer (a6027c35d): the pick first, with the Energy attached.
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;

const UMBREON = 'pre-060';
const BASIC = 'asc-004';
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
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
const energy: CardRef[] = [{ iid: 'ae0', printing: 'sve-004' }, { iid: 'ae1', printing: 'sve-005' }, { iid: 'ae2', printing: 'sve-007' }];
const board = (prizes: PrizeRef[], printing = UMBREON): NeutralState => ({
  schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
  players: {
    A: player({ active: mon('a1', printing, energy), deck: cards('ad', 6, GRASS), prizes }),
    B: player({ active: mon('b1', BASIC), deck: cards('bd', 6, GRASS), prizes: cards('bp', 6, GRASS).map(c => ({ ...c, faceUp: false })) }),
  },
} as NeutralState);
const faceDown = (n: number): PrizeRef[] => cards('ap', n, GRASS).map(c => ({ ...c, faceUp: false }));
const onyx = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Onyx' } as never;
const take = (index: number) => ({ actor: 'A', type: 'takePrize', index } as never);
const chosen = (events: NeutralEvent[]) => events.filter(e => e.kind === 'chosen')
  .map(e => `${(e as { card: string }).card}:${(e as { origin: { zone: string } }).origin.zone}:${(e as { visibility: string }).visibility}`);
const legs = (events: NeutralEvent[], iid: string) =>
  events.filter((e): e is Moved => e.kind === 'moved' && e.card === iid).map(e => `${e.origin.zone}>${e.destination.zone}`);

describe('TA-715 / B.110: Onyx (Umbreon ex pre-060) names its Prize at Step D', () => {
  it('three face-down Prizes: the pick is asked with the Energy still attached [TA-715 pre-060]', () => {
    const r = step(board(faceDown(3)), [onyx]);
    expect(r.pending?.actor).toBe('A');
    expect((r.pending?.legalActions ?? []).map(a => a.type)).toEqual(['takePrize', 'takePrize', 'takePrize']);
    expect(r.state.players.A.active?.energy.map(c => c.iid)).toEqual(['ae0', 'ae1', 'ae2']);
    expect(r.state.players.A.discard).toEqual([]);
  });

  it('the answer: chosen {prizes, hidden}, then the Energy is discarded and the Prize taken [TA-715 pre-060 answer]', () => {
    const r = step(board(faceDown(3)), [onyx, take(1)]);
    expect(chosen(r.events)).toEqual(['ap1:prizes:hidden']);
    expect(legs(r.events, 'ap1')).toEqual(['prizes>hand']);
    for (const e of ['ae0', 'ae1', 'ae2']) { expect(legs(r.events, e)).toEqual(['active>discardPile']); }
    expect(r.state.players.A.prizes.map(p => p.iid)).toEqual(['ap0', 'ap2']);
  });

  it('a face-up Prize named is chosen public [TA-715 pre-060 face-up]', () => {
    const prizes = faceDown(3); prizes[1] = { ...prizes[1], faceUp: true };
    const r = step(board(prizes), [onyx, take(1)]);
    expect(chosen(r.events)).toEqual(['ap1:prizes:public']);
  });

  it('control: one Prize left: the pick is still asked, and records no chosen (B.93) [TA-715 pre-060 one]', () => {
    const r1 = step(board(faceDown(1)), [onyx]);
    expect(r1.pending?.actor).toBe('A');
    expect(r1.state.players.A.active?.energy.map(c => c.iid)).toEqual(['ae0', 'ae1', 'ae2']);
    const r = step(board(faceDown(1)), [onyx, take(0)]);
    expect(chosen(r.events)).toEqual([]);
    expect(legs(r.events, 'ap0')).toEqual(['prizes>hand']);
  });

  for (const [printing, label] of [['pre-161', '[TA-715 pre-161]'], ['svp-176', '[TA-715 svp-176]']] as const) {
    it(`the reprint ${printing} names its Prize first too ${label}`, () => {
      const r1 = step(board(faceDown(3), printing), [onyx]);
      expect(r1.state.players.A.active?.energy.map(c => c.iid)).toEqual(['ae0', 'ae1', 'ae2']);
      expect(chosen(step(board(faceDown(3), printing), [onyx, take(2)]).events)).toEqual(['ap2:prizes:hidden']);
    });
  }
});
