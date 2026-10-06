import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-640 (TA-626 residual): a damaged survivor whose Curse-then-Heal net DROP equals its logged placement was read as a
 * TA-603 counter relocation (placed 20 = dropped 20), so events.ts set relocationOnly and skipped the TA-626 branch:
 * Magearna jtg-107 at 20, Gnawing Curse tef-104 places 20, Auto Heal (heal 90) removes 40, ends at 0; twinleaf emitted only
 * `healed 20` (the net). A relocation moves counters OFF another Pokémon: the drop that balances a placement must fall
 * on a Pokémon other than the placement's target.
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
const attach = { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a1' } as never;
const next = (source: string, ability: string) =>
  ({ actor: 'A', type: 'resolveNext', source, subject: 'a1', ability, kind: 'abilityEffect' } as never);
function magearnaBoard(damage: number): NeutralState {
  return base(
    { active: mon('a1', 'jtg-107', { damage }), hand: [{ iid: 'ah0', printing: METAL }] },
    { active: mon('b1', 'tef-104') });
}

describe('TA-640: a placement healed off the same Pokémon is not a relocation', () => {
  it('Magearna at 20, Curse first then Auto Heal: damaged 20 and healed 40, ends at 0 [TA-640]', () => {
    const r = step(magearnaBoard(20), [attach, next('b1', 'Gnawing Curse')]);
    expect(r.state.players.A.active?.damage).toBe(0);
    expect(sums(r.events, 'damaged')).toEqual({ a1: 20 });
    expect(sums(r.events, 'healed')).toEqual({ a1: 40 });
  });
  it('Magearna at 40, Curse first then Auto Heal (heal 90): damaged 20 and healed 60, ends at 0 [TA-640]', () => {
    const r = step(magearnaBoard(40), [attach, next('b1', 'Gnawing Curse')]);
    expect(r.state.players.A.active?.damage).toBe(0);
    expect(sums(r.events, 'damaged')).toEqual({ a1: 20 });
    expect(sums(r.events, 'healed')).toEqual({ a1: 60 });
  });
  it('control: Magearna at 20, Auto Heal first then Curse: healed 20 and damaged 20, ends at 20 [TA-640]', () => {
    const r = step(magearnaBoard(20), [attach, next('a1', 'Auto Heal')]);
    expect(r.state.players.A.active?.damage).toBe(20);
    expect(sums(r.events, 'damaged')).toEqual({ a1: 20 });
    expect(sums(r.events, 'healed')).toEqual({ a1: 20 });
  });
});
