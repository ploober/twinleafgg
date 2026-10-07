import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * The damage trace matches the board (B.80: the board is true at every pick; B.81: the wire events are the full replay
 * trace of that board; CF-6: one `damaged` per placement, CF-51: compared summed per (player, target)).
 *
 *  - TA-626: a placement and a heal on one Pokémon inside one dispatch. events.ts derived `damaged` from the net board
 *    diff, so Gnawing Curse tef-104 (+20) then Auto Heal jtg-107 (-20) emitted nothing. The placement is logged
 *    (LOG_PLAYER_PLACES_DAMAGE_COUNTERS): a survivor whose logged placements exceed its net rise emits the logged sum
 *    and `healed` carries the difference.
 *  - TA-622: Sinistcha twm-022 Cursed Drop ("Put 4 damage counters on your opponent's Pokémon in any way you like."):
 *    the counter a `placeCounter` pick puts on the board at a pause is projected (B.80) but emitted no `damaged`.
 *  - TA-618: Munkidori twm-095 Adrena-Brain under Battle Cage pfl-085 ("Prevent all damage counters from being placed on
 *    Benched Pokémon ... by effects of attacks and Abilities from the opponent's Pokémon."): the pause projected the
 *    moved counter ON the protected Benched Pokémon; #2257: "since they cannot be placed onto Benched Pokemon they just
 *    vanish from play".
 */

const METAL = 'sve-008';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, over: Partial<PokemonInPlay> = {}): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers(), ...over };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, METAL).map(c => ({ ...c, faceUp: false }));
}
function base(a: Partial<PlayerState>, b: Partial<PlayerState>, stadium: NeutralState['stadium'] = null): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium,
    players: {
      A: player({ deck: cards('ad', 6, METAL), prizes: prizes('ap', 6), ...a }),
      B: player({ deck: cards('bd', 6, METAL), prizes: prizes('bp', 6), ...b }),
    },
  };
}

/** Summed `hp` of one event kind per target (the CF-51 comparison). */
function sums(events: NeutralEvent[], kind: 'damaged' | 'healed'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    if (e.kind === kind) {
      const t = (e as { target: string }).target;
      out[t] = (out[t] ?? 0) + (e as { hp: number }).hp;
    }
  }
  return out;
}

// ── TA-626 ────────────────────────────────────────────────────────────────

const attach = { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a1' } as never;
const next = (source: string, ability: string) =>
  ({ actor: 'A', type: 'resolveNext', source, subject: 'a1', ability, kind: 'abilityEffect' } as never);
function magearnaBoard(bBench: string[] = []): NeutralState {
  return base(
    { active: mon('a1', 'jtg-107'), hand: [{ iid: 'ah0', printing: METAL }] },
    { active: mon('b1', 'tef-104'), bench: bBench.map((p, i) => mon(`bb${i + 1}`, p)) });
}

describe('TA-626: damage placed and healed inside one step is still a damaged event', () => {
  it('Curse first, then Auto Heal: damaged 20 and healed 20 on Magearna, which ends at 0 [TA-626]', () => {
    const r = step(magearnaBoard(), [attach, next('b1', 'Gnawing Curse')]);
    expect(r.pending?.actor).toBe('A');                    // the top-level menu: both triggers resolved
    expect(r.state.players.A.active?.damage).toBe(0);
    expect(sums(r.events, 'damaged')).toEqual({ a1: 20 });
    expect(sums(r.events, 'healed')).toEqual({ a1: 20 });
  });

  it('Curse, Heal, Curse (two Gengar ex): damaged 40, healed 20, Magearna ends at 20 [TA-626]', () => {
    const r = step(magearnaBoard(['tef-104']), [attach, next('b1', 'Gnawing Curse'), next('a1', 'Auto Heal')]);
    expect(r.state.players.A.active?.damage).toBe(20);
    expect(sums(r.events, 'damaged')).toEqual({ a1: 40 });
    expect(sums(r.events, 'healed')).toEqual({ a1: 20 });
  });

  it('control: Heal first (nothing to heal), then Curse: damaged 20, no healed [TA-626]', () => {
    const r = step(magearnaBoard(), [attach, next('a1', 'Auto Heal')]);
    expect(r.state.players.A.active?.damage).toBe(20);
    expect(sums(r.events, 'damaged')).toEqual({ a1: 20 });
    expect(sums(r.events, 'healed')).toEqual({});
  });
});

// ── TA-622 / TA-668 ────────────────────────────────────────────────────────────────

function sinistchaBoard(): NeutralState {
  return base(
    { active: mon('a1', 'twm-022', { energy: [{ iid: 'ae0', printing: 'sve-001' }] }) },
    { active: mon('b1', 'meg-100'), bench: [mon('bb1', 'meg-100')] });
}
const cursedDrop = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Cursed Drop' } as never;
const place = (target: string) => ({ actor: 'A', type: 'placeCounter', target } as never);

describe('TA-668 / B.98 (supersedes TA-622 for attacks): an attack\'s counter picks place nothing until its effects apply', () => {
  it('Cursed Drop, first pick: nothing is placed and no damaged is emitted at the pause [TA-668]', () => {
    const r = step(sinistchaBoard(), [cursedDrop, place('b1')]);
    expect(r.pending?.legalActions.some(a => a.type === 'placeCounter')).toBe(true);
    expect(r.state.players.B.active?.damage).toBe(0);
    expect(sums(r.events, 'damaged')).toEqual({});
  });

  it('Cursed Drop, three picks over two Pokémon: still nothing placed [TA-668]', () => {
    const r = step(sinistchaBoard(), [cursedDrop, place('b1'), place('bb1'), place('b1')]);
    expect(r.state.players.B.active?.damage).toBe(0);
    expect(r.state.players.B.bench[0].damage).toBe(0);
    expect(r.events.filter(e => e.kind === 'damaged').length).toBe(0);
  });

  it('Cursed Drop, all four picks: the counters land together, one damaged per Pokémon placement [TA-668]', () => {
    const r = step(sinistchaBoard(), [cursedDrop, place('b1'), place('bb1'), place('b1'), place('b1')]);
    expect(r.state.players.B.active?.damage).toBe(30);
    expect(r.state.players.B.bench[0].damage).toBe(10);
    expect(sums(r.events, 'damaged')).toEqual({ b1: 30, bb1: 10 });
  });
});

// ── TA-618 ────────────────────────────────────────────────────────────────

function munkidoriBoard(): NeutralState {
  return base(
    { active: mon('a1', 'twm-095', { energy: [{ iid: 'a1e0', printing: 'sve-007' }], damage: 30 }) },
    { active: mon('b1', 'meg-100'), bench: [mon('bb1', 'meg-100')] },
    { iid: 'stad0', printing: 'pfl-085', owner: 'B' } as never);
}
const adrena = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Adrena-Brain' } as never;

describe('TA-618: a moved counter Battle Cage keeps off the Bench is never projected there', () => {
  it('pick to the protected Benched Pokémon: A loses the counter, the Bench stays at 0 (#2257) [TA-618]', () => {
    const r = step(munkidoriBoard(), [adrena, place('bb1')]);
    expect(r.pending?.actor).toBe('A');
    expect(r.state.players.A.active?.damage).toBe(20);
    expect(r.state.players.B.bench[0].damage).toBe(0);
    expect(sums(r.events, 'damaged')).toEqual({});
  });

  it('control: pick to the Active (not protected) moves the counter there [TA-618]', () => {
    const r = step(munkidoriBoard(), [adrena, place('b1')]);
    expect(r.state.players.A.active?.damage).toBe(20);
    expect(r.state.players.B.active?.damage).toBe(10);
  });

  it('close agrees with the pause: Bench 0, A 20 [TA-618]', () => {
    const r = step(munkidoriBoard(), [adrena, place('bb1'), { actor: 'A', type: 'confirm', value: false } as never]);
    expect(r.state.players.A.active?.damage).toBe(20);
    expect(r.state.players.B.bench[0].damage).toBe(0);
  });

  it('a moved counter is not healed, at the pause or at the close, even when it vanishes (#1995, #2257) [TA-664]', () => {
    expect(sums(step(munkidoriBoard(), [adrena, place('bb1')]).events, 'healed')).toEqual({});
    const r = step(munkidoriBoard(), [adrena, place('bb1'), { actor: 'A', type: 'confirm', value: false } as never]);
    expect(sums(r.events, 'healed')).toEqual({});
    expect(sums(step(munkidoriBoard(), [adrena, place('b1')]).events, 'healed')).toEqual({});
  });
});
