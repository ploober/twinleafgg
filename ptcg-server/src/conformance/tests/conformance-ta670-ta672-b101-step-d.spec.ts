import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.101 (owner 2026-10-07, N-0312 §4) with B.89 (1): every choice the attacking player makes over public information
 * is made at Step D, before the damage; the cards move after it (#649, #352, #1846).
 *
 * TA-672 (B.101 (3)): "Switch this Pokemon with 1 of your Benched Pokemon." The new Active (and a "you may switch"
 * gate) is chosen before the damage; the switch happens after it. Twinleaf asked after the damage (AFTER_ATTACK /
 * AfterDamageEffect / EndTurnEffect), or asked first but switched at once, before the damage (Spin Turn, Swing and
 * Skedaddle, Victini ex's Strafe).
 *
 * TA-670 (B.101 (4)): a "you may" gate CF-32 externalizes is asked before the damage; its option applies after it.
 * Twinleaf asked these after the damage (TA-128 had moved Corkscrew Dive's confirm to AFTER_ATTACK).
 *
 * TA-671 (B.89 (1), B.101 (2)): Flame Surge's printed "Choose up to 3 of your Benched Pokemon" is a Step-D choice; the
 * searches and attaches stay after the damage.
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
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((p, i) => ({ iid: `${iid}e${i}`, printing: p })), tools: [], damage: 0,
    conditions: [], markers: markers(),
  };
}
function cards(tag: string, ps: string[]): CardRef[] {
  return ps.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, Array(n).fill(E.M)).map(c => ({ ...c, faceUp: false }));
}

interface Row { printing: string; attack: string; energy: string; bench?: string; may?: boolean; discardFirst?: boolean }

function board(row: Row): NeutralState {
  const bench = row.bench ?? 'asc-004';
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
    stadium: null,
    players: {
      A: player({
        active: mon('a1', row.printing, row.energy.split('').map(t => E[t])),
        bench: [mon('ab1', bench), mon('ab2', bench)],
        hand: cards('ah', [E.G, E.W]),
        deck: cards('ad', [E.R, E.R, E.R, E.G, E.W, E.P, E.L, E.F, E.D, E.M]), prizes: prizes('ap', 3),
      }),
      B: player({
        active: mon('b1', 'mew-003', [E.R, E.L]),
        bench: [mon('bb1', 'asc-004'), mon('bb2', 'asc-004')],
        hand: cards('bh', [E.G, E.P]), deck: cards('bd', Array(10).fill(E.G)), prizes: prizes('bp', 3),
      }),
    },
  } as NeutralState;
}

const declare = (row: Row) => ({ actor: 'A', type: 'declareAttack', source: 'a1', name: row.attack } as never);
const yes = { actor: 'A', type: 'confirm', value: true } as never;
const promote = (target: string) => ({ actor: 'A', type: 'promoteBench', target } as never);
const discard = (target: string) => ({ actor: 'A', type: 'discard', target } as never);

/** The events after `attackUsed`, without `chosen` (a Step-D pick may record one, B.89 (1)). */
function afterAttack(events: NeutralEvent[]): NeutralEvent[] {
  const i = events.findIndex(e => e.kind === 'attackUsed');
  return events.slice(i + 1).filter(e => e.kind !== 'chosen');
}
const damaged = (events: NeutralEvent[]) => events.filter(e => e.kind === 'damaged');
const movedIndex = (events: NeutralEvent[], card: string) =>
  events.findIndex(e => e.kind === 'moved' && (e as { card?: string }).card === card);

const SWITCHES: Row[] = [
  { printing: 'asc-066', attack: 'Volt Switch', energy: 'LLL', bench: 'asc-066' },
  { printing: 'cri-054', attack: 'Smash Turn', energy: 'DDDD' },
  { printing: 'jtg-013', attack: 'Poisonous Ploy', energy: 'GGG' },
  { printing: 'meg-017', attack: 'U-turn', energy: 'GGG' },
  { printing: 'meg-054', attack: 'Teleportation Attack', energy: 'PP' },
  { printing: 'meg-100', attack: 'Strafe', energy: 'PP', may: true },
  { printing: 'obf-033', attack: 'Strafe', energy: 'RR', may: true },
  { printing: 'pal-052', attack: 'Exciting Dance', energy: 'WW' },
  { printing: 'pbl-027', attack: 'Zepto Turn', energy: 'LLLL' },
  { printing: 'por-016', attack: 'Dire Nails', energy: 'RRR' },
  { printing: 'por-022', attack: 'Hydro Turn', energy: 'WW' },
  { printing: 'por-054', attack: 'Strafe', energy: 'DD', may: true },
  { printing: 'ssp-106', attack: 'Reversing Storm', energy: 'FF', may: true },
  { printing: 'tef-040', attack: 'Reverse Thrust', energy: 'WW' },
  { printing: 'paf-181', attack: 'Spin Turn', energy: 'DD' },
  { printing: 'par-050', attack: 'Swing and Skedaddle', energy: 'WWWW', discardFirst: true },
];

describe('TA-672 / B.101 (3): switching the attacker out chooses the new Active before the damage, switches after it', () => {
  for (const row of SWITCHES) {
    const lead = (): never[] => row.may ? [yes] : row.discardFirst ? [discard('a1e0')] : [];

    it(`${row.printing} ${row.attack}: every pick is made with the Defending Pokemon undamaged [TA-672]`, () => {
      const first = step(board(row), [declare(row)]);
      const want = row.may ? 'confirm' : row.discardFirst ? 'discard' : 'promoteBench';
      expect(first.pending?.legalActions.every(a => a.type === want)).toBe(true);
      expect(damaged(first.events)).toEqual([]);
      if (row.may || row.discardFirst) {
        const second = step(board(row), [declare(row), ...lead()]);
        expect(second.pending?.legalActions.every(a => a.type === 'promoteBench')).toBe(true);
        expect(damaged(second.events)).toEqual([]);
      }
    });

    it(`${row.printing} ${row.attack}: the damage first, then the switch [TA-672]`, () => {
      const r = step(board(row), [declare(row), ...lead(), promote('ab2')]);
      const ev = afterAttack(r.events);
      expect(ev[0]?.kind).toBe('damaged');
      expect((ev[0] as { target?: string }).target).toBe('b1');
      expect(movedIndex(ev, 'ab2')).toBeGreaterThan(0);
      expect(r.state.players.A.active?.stack[0].iid).toBe('ab2');
    });
  }
});

describe('TA-672 / #649: a switch-out attack\'s Special Conditions are applied after the damage, not at the Step-D pick', () => {
  const rows: Array<[Row, string[]]> = [
    [{ printing: 'por-016', attack: 'Dire Nails', energy: 'RRR' }, ['burned', 'poisoned']],
    [{ printing: 'jtg-013', attack: 'Poisonous Ploy', energy: 'GGG' }, ['confused', 'poisoned']],
  ];
  for (const [row, want] of rows) {
    it(`${row.printing} ${row.attack}: no condition at the pick; both after the damage [TA-672]`, () => {
      const pick = step(board(row), [declare(row)]);
      expect(pick.state.players.B.active?.conditions).toEqual([]);
      const done = step(board(row), [declare(row), promote('ab2')]);
      expect([...(done.state.players.B.active?.conditions ?? [])].map(String).sort()).toEqual(want);
    });
  }
});

const GATES: Row[] = [
  { printing: 'asc-111', attack: 'Corkscrew Dive', energy: 'FF' },
  { printing: 'cri-034', attack: 'Psyspeed', energy: 'PP' },
  { printing: 'dri-122', attack: 'Assassin\'s Return', energy: 'DDD' },
  { printing: 'ssp-131', attack: 'Surf Back', energy: 'MMM' },
  { printing: 'ssp-159', attack: 'Zircon Road', energy: 'GRP' },
  { printing: 'twm-134', attack: 'Return', energy: 'GGG' },
];

describe('TA-670 / B.101 (4): a "you may" gate is asked before the damage, its option applied after it', () => {
  for (const row of GATES) {
    it(`${row.printing} ${row.attack}: the confirm is pended with the Defending Pokemon undamaged [TA-670]`, () => {
      const r = step(board(row), [declare(row)]);
      expect(r.pending?.legalActions.map(a => a.type)).toEqual(['confirm', 'confirm']);
      expect(damaged(r.events)).toEqual([]);
    });

    it(`${row.printing} ${row.attack}: after yes, the damage comes first [TA-670]`, () => {
      const r = step(board(row), [declare(row), yes]);
      const ev = afterAttack(r.events);
      expect(ev[0]?.kind).toBe('damaged');
      expect((ev[0] as { target?: string }).target).toBe('b1');
    });
  }
});

describe('TA-671 / B.89 (1): Flame Surge chooses its Benched Pokemon before the 100', () => {
  const row: Row = { printing: 'paf-241', attack: 'Flame Surge', energy: 'RRR' };

  it('declareAttack pends the Benched-Pokemon choice with the Defending Pokemon undamaged [TA-671]', () => {
    const r = step(board(row), [declare(row)]);
    expect(r.pending?.legalActions.some(a => a.type === 'choose' && (a as { target?: string }).target === 'ab1')).toBe(true);
    expect(damaged(r.events)).toEqual([]);
  });
});

describe('TA-673 / B.89 (5), B.98: Phantasmal Barrage (no damage) picks its counter target before it discards its Energy', () => {
  const row: Row = { printing: 'asc-098', attack: 'Phantasmal Barrage', energy: 'PPP' };
  const place = (target: string) => ({ actor: 'A', type: 'placeCounter', target } as never);

  it('the placeCounter pick is asked with every Energy still attached [TA-673]', () => {
    const r = step(board(row), [declare(row)]);
    expect(r.pending?.legalActions.every(a => a.type === 'placeCounter')).toBe(true);
    expect(r.state.players.A.active?.energy.length).toBe(3);
    expect(r.events.filter(e => e.kind === 'moved')).toEqual([]);
  });

  it('after the pick: the Energy is discarded, then the 12 counters land [TA-673]', () => {
    const r = step(board(row), [declare(row), place('b1')]);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['a1e0', 'a1e1', 'a1e2']);
    expect(r.state.players.B.active?.damage).toBe(120);
  });
});
