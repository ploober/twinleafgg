import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.102 (owner 2026-10-08, amends the CF-93 `chosen` law; applies B.89 (1)): an attack that attaches Energy from its
 * own discard pile chooses the cards (and their Benched Pokemon) at Step D, before the damage; each card the player
 * chose records a `chosen` (origin `discardPile`) and stays in the discard pile until it moves, after the damage.
 *
 * B.103 (applies B.93): a pick with one possible card records no `chosen`, even when its destination is chosen.
 *
 * B.104: a copied attack makes its own Step-D choices before its damage (Metronome copying Iron Roar).
 *
 * B.105 (extends B.98 to Energy): an attack that moves Energy "in any way you like" chooses the whole spread at Step D;
 * nothing moves between picks; the Energy moves after the damage. Genome Spiral's Energy is forced ("Move all"), so
 * its picks are destinations only and record no `chosen`.
 */

const E: Record<string, string> = {
  G: 'sve-001', R: 'sve-002', W: 'sve-003', L: 'sve-004', P: 'sve-005', F: 'sve-006', D: 'sve-007', M: 'sve-008',
};

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

function board(attacker: string, energy: string, discard: string, defender = 'mew-003', defenderEnergy = 'RL'): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
    stadium: null,
    players: {
      A: player({
        active: mon('a1', attacker, energy), bench: [mon('ab1', 'asc-004'), mon('ab2', 'asc-004')],
        hand: cards('ah', [E.G]), deck: cards('ad', [E.R, E.R, E.G, E.W, E.P, E.L, E.F, E.D, E.M, E.M]),
        discard: cards('adc', discard.split('').filter(t => t !== '').map(t => E[t])), prizes: prizes('ap', 3),
      }),
      B: player({
        active: mon('b1', defender, defenderEnergy), bench: [mon('bb1', 'asc-004'), mon('bb2', 'asc-004')],
        hand: cards('bh', [E.G]), deck: cards('bd', Array(10).fill(E.G)), prizes: prizes('bp', 3),
      }),
    },
  } as NeutralState;
}

const A = (o: Record<string, unknown>) => ({ actor: 'A', ...o } as never);
const declare = (name: string) => A({ type: 'declareAttack', source: 'a1', name });
const attach = (card: string, target: string) => A({ type: 'attachEnergy', card, target });
const move = (card: string, target: string) => A({ type: 'moveEnergy', card, source: 'a1', target });

/** The attack's own events: from `attackUsed` up to the end of the turn. */
function attackEvents(events: NeutralEvent[]): NeutralEvent[] {
  const i = events.findIndex(e => e.kind === 'attackUsed');
  const j = events.findIndex(e => e.kind === 'turnEnded');
  return events.slice(i + 1, j < 0 ? undefined : j);
}
const kinds = (events: NeutralEvent[]) => events.map(e => e.kind);
const chosenCards = (events: NeutralEvent[]) =>
  events.filter(e => e.kind === 'chosen').map(e => (e as { card?: string }).card);
const idx = (events: NeutralEvent[], kind: string) => events.findIndex(e => e.kind === kind);

describe('B.102 / B.103: an attack\'s discard-pile attach is chosen at Step D and moves after the damage', () => {
  it('par-136 Iron Roar, two [M] in the discard: the card stays in the discard pile at the pick [TA-674]', () => {
    const r = step(board('par-136', 'M', 'MM'), [declare('Iron Roar')]);
    expect(r.pending?.legalActions.every(a => a.type === 'attachEnergy')).toBe(true);
    expect(kinds(attackEvents(r.events))).toEqual([]);
  });

  it('par-136 Iron Roar, two [M]: chosen at the pick, then the 30, then the attach [TA-674]', () => {
    const r = step(board('par-136', 'M', 'MM'), [declare('Iron Roar'), attach('adc1', 'ab2')]);
    const ev = attackEvents(r.events);
    expect(chosenCards(ev)).toEqual(['adc1']);
    expect((ev.find(e => e.kind === 'chosen') as { origin?: { zone?: string } }).origin?.zone).toBe('discardPile');
    expect(idx(ev, 'chosen')).toBeLessThan(idx(ev, 'damaged'));
    expect(idx(ev, 'damaged')).toBeLessThan(idx(ev, 'moved'));
    expect(r.state.players.A.bench[1].energy.map(c => c.iid)).toEqual(['adc1']);
  });

  it('par-136 Iron Roar, one [M] and two Benched Pokemon: the forced card records no chosen [TA-674]', () => {
    const r = step(board('par-136', 'M', 'M'), [declare('Iron Roar'), attach('adc0', 'ab2')]);
    const ev = attackEvents(r.events);
    expect(chosenCards(ev)).toEqual([]);
    expect(idx(ev, 'damaged')).toBeLessThan(idx(ev, 'moved'));
  });

  it('paf-075 Motivate, two Basic Energy: nothing moves at the first pick [TA-674]', () => {
    const r = step(board('paf-075', 'G', 'RW'), [declare('Motivate'), attach('adc0', 'ab2')]);
    expect(r.events.filter(e => e.kind === 'moved')).toEqual([]);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['adc0', 'adc1']);
  });

  it('paf-075 Motivate, both cards: chosen x2, the 20, then both attach [TA-674]', () => {
    const r = step(board('paf-075', 'G', 'RW'), [declare('Motivate'), attach('adc0', 'ab2'), attach('adc1', 'ab2')]);
    const ev = attackEvents(r.events);
    expect(chosenCards(ev)).toEqual(['adc0', 'adc1']);
    const firstMove = idx(ev, 'moved');
    expect(idx(ev, 'damaged')).toBeLessThan(firstMove);
    expect(r.state.players.A.bench[1].energy.map(c => c.iid).sort()).toEqual(['adc0', 'adc1']);
  });
});

describe('B.104: a copied attack\'s discard-pile attach is chosen before the copied damage', () => {
  it('asc-075 Metronome copying Iron Roar: chosen, then the 30, then the attach [TA-674]', () => {
    const r = step(board('asc-075', 'PP', 'MM', 'par-136', 'M'),
      [declare('Metronome'), A({ type: 'choose', target: 'b1', name: 'Iron Roar' }), attach('adc1', 'ab2')]);
    const ev = attackEvents(r.events);
    expect(chosenCards(ev)).toEqual(['adc1']);
    expect(idx(ev, 'damaged')).toBeLessThan(idx(ev, 'moved'));
  });
});

describe('B.105: Genome Spiral chooses every destination at Step D and moves the Energy after the damage', () => {
  it('par-074 Genome Spiral: nothing moves at the first pick [TA-675]', () => {
    const r = step(board('par-074', 'PPP', ''), [declare('Genome Spiral'), move('a1e0', 'ab1')]);
    expect(r.events.filter(e => e.kind === 'moved')).toEqual([]);
    expect(r.state.players.A.active?.energy.length).toBe(3);
  });

  it('par-074 Genome Spiral: the 120, then the three moves; no chosen (forced Energy) [TA-675]', () => {
    const r = step(board('par-074', 'PPP', ''),
      [declare('Genome Spiral'), move('a1e0', 'ab1'), move('a1e1', 'ab2'), move('a1e2', 'ab2')]);
    const ev = attackEvents(r.events);
    expect(chosenCards(ev)).toEqual([]);
    expect(ev[0]?.kind).toBe('damaged');
    expect(ev.filter(e => e.kind === 'moved').length).toBe(3);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['a1e0']);
    expect(r.state.players.A.bench[1].energy.map(c => c.iid).sort()).toEqual(['a1e1', 'a1e2']);
  });
});

describe('TA-676: Transfer Charge attaches to any of your Pokemon, chosen at Step D (B.89 (5), B.102)', () => {
  it('par-058 Transfer Charge offers the [P] Energy for every one of your Pokemon [TA-676]', () => {
    const r = step(board('par-058', 'P', 'PP'), [declare('Transfer Charge')]);
    const targets = new Set((r.pending?.legalActions ?? []).filter(a => a.type === 'attachEnergy').map(a => (a as { target?: string }).target));
    expect([...targets].sort()).toEqual(['a1', 'ab1', 'ab2']);
  });

  it('par-058 Transfer Charge: nothing moves between picks; chosen x2, then both attach [TA-676]', () => {
    const mid = step(board('par-058', 'P', 'PP'), [declare('Transfer Charge'), attach('adc0', 'ab1')]);
    expect(mid.events.filter(e => e.kind === 'moved')).toEqual([]);
    const r = step(board('par-058', 'P', 'PP'), [declare('Transfer Charge'), attach('adc0', 'ab1'), attach('adc1', 'a1')]);
    const ev = attackEvents(r.events);
    expect(chosenCards(ev)).toEqual(['adc0', 'adc1']);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['adc0']);
    expect(r.state.players.A.active?.energy.map(c => c.iid)).toEqual(['a1e0', 'adc1']);
  });
});

describe('TA-677: Tropic Breeze chooses its Benched Pokemon before the damage, moves after it (B.89 (1))', () => {
  it('pal-007 Tropic Breeze: the destination pick is pended with the Defending Pokemon undamaged [TA-677]', () => {
    const r = step(board('pal-007', 'GGG', ''), [declare('Tropic Breeze')]);
    expect(r.pending?.legalActions.every(a => a.type === 'moveEnergy')).toBe(true);
    expect(attackEvents(r.events).filter(e => e.kind === 'damaged')).toEqual([]);
  });

  it('pal-007 Tropic Breeze: the damage, then every Energy moves to the chosen Pokemon; no chosen [TA-677]', () => {
    const r = step(board('pal-007', 'GGG', ''), [declare('Tropic Breeze'), move('a1e0', 'ab2')]);
    const ev = attackEvents(r.events);
    expect(chosenCards(ev)).toEqual([]);
    expect(ev[0]?.kind).toBe('damaged');
    expect(r.state.players.A.bench[1].energy.map(c => c.iid).sort()).toEqual(['a1e0', 'a1e1', 'a1e2']);
  });
});

describe('TA-678 / TA-679: the stop of a discard-pile attach follows the printed text', () => {
  it('pal-065 Magnetic Charge ("up to 2") offers the stop [TA-678]', () => {
    const r = step(board('pal-065', 'L', 'L'), [declare('Magnetic Charge')]);
    expect(r.pending?.legalActions.some(a => a.type === 'confirm' && (a as { value?: boolean }).value === false)).toBe(true);
  });

  it('obf-079 Techno Turbo ("Attach a ...") offers no stop [TA-679]', () => {
    const r = step(board('obf-079', 'LLL', 'LL'), [declare('Techno Turbo')]);
    expect(r.pending?.legalActions.length).toBe(4);
    expect(r.pending?.legalActions.every(a => a.type === 'attachEnergy')).toBe(true);
  });

  it('obf-079 Techno Turbo with no Benched Pokemon asks nothing and does its 150 [TA-679]', () => {
    const b = board('obf-079', 'LLL', 'LL');
    b.players.A.bench = [];
    const r = step(b, [declare('Techno Turbo')]);
    expect(r.pending?.actor).not.toBe('A' as never);
    expect(r.events.some(e => e.kind === 'damaged')).toBe(true);
  });
});

describe('TA-680 / B.82: Spiral Shot chooses its 2 Energy before the 230 and returns them after it', () => {
  const pick = (target: string) => A({ type: 'choose', target });

  it('pal-052 Spiral Shot: the first pick leaves the Energy attached and records chosen [TA-680]', () => {
    const r = step(board('pal-052', 'WWW', ''), [declare('Spiral Shot'), pick('a1e0')]);
    expect(r.events.filter(e => e.kind === 'moved')).toEqual([]);
    expect(r.state.players.A.active?.energy.length).toBe(3);
    expect(chosenCards(attackEvents(r.events))).toEqual(['a1e0']);
  });

  it('pal-052 Spiral Shot: chosen x2, the 230, then both Energy to the hand [TA-680]', () => {
    const r = step(board('pal-052', 'WWW', ''), [declare('Spiral Shot'), pick('a1e0'), pick('a1e1')]);
    const ev = attackEvents(r.events);
    expect(chosenCards(ev)).toEqual(['a1e0', 'a1e1']);
    expect(idx(ev, 'damaged')).toBeLessThan(idx(ev, 'moved'));
    expect(r.state.players.A.hand.map(c => c.iid)).toContain('a1e0');
  });
});
