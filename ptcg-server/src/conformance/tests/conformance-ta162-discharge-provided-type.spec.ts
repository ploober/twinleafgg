import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-162: Galvantula wht-034 / wht-117 Discharge ("Discard all [L] Energy from this Pokémon. This attack does 50 damage
 * for each card you discarded in this way.") read "[L] Energy" as `provides.includes(LIGHTNING)` on the energy map, so
 * an Energy that provides every type while attached (Legacy Energy twm-167: CheckProvidedEnergyEffect maps it to
 * [ANY]) paid the [L] cost but was neither discarded nor counted: 0 damage. #687 ("You could discard the Rainbow
 * Energy, as they do count as all basic energy types"): an Energy providing every type is a [L] Energy for the
 * effect too. StateUtils.providesMatchesType (the cost path's reading) replaces the bare includes.
 *
 * Controls: a Basic [L] alone is discarded for 50; a Basic [L] beside a Basic [W] leaves the [W] attached.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const LIGHTNING = 'sve-004';
const LEGACY = 'twm-167';
const DEFENDER = 'twm-106';   // 310 HP: no KO on any cell

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
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, GRASS).map(c => ({ ...c, faceUp: false }));
}
function board(attacker: string, energy: string[], hand: string[] = []): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', attacker, energy.map((p, i) => ({ iid: `ae${i}`, printing: p }))),
        hand: hand.map((p, i) => ({ iid: `ah${i}`, printing: p })),
        deck: cards('ad', 6, GRASS), prizes: prizes('ap', 6),
      }),
      B: player({ active: mon('b1', DEFENDER), deck: cards('bd', 6, GRASS), prizes: prizes('bp', 6) }),
    },
  };
}

const attack = (name: string) => ({ actor: 'A', type: 'declareAttack', source: 'a1', name } as never);

const dealtToB1 = (events: NeutralEvent[]) => (events as Array<{ kind: string; target?: string; hp?: number }>)
  .filter(e => e.kind === 'damaged' && e.target === 'b1').reduce((n, e) => n + (e.hp ?? 0), 0);

describe('TA-162: Galvantula Discharge discards every attached Energy that provides [L]', () => {
  it('wht-117 with Legacy Energy alone: discarded, 50 damage [TA-162]', () => {
    const done = step(board('wht-117', [LEGACY]), [attack('Discharge')]);
    expect(dealtToB1(done.events)).toBe(50);
    expect(done.state.players.A.discard.map(c => c.printing)).toEqual([LEGACY]);
    expect(done.state.players.A.active?.energy.map(c => c.iid)).toEqual([]);
  });

  it('wht-117 with a Basic Lightning and Legacy Energy: both discarded, 100 damage [TA-162]', () => {
    const done = step(board('wht-117', [LIGHTNING, LEGACY]), [attack('Discharge')]);
    expect(dealtToB1(done.events)).toBe(100);
    expect(done.state.players.A.discard.map(c => c.printing).sort()).toEqual([LIGHTNING, LEGACY].sort());
  });

  it('control: a Basic Lightning alone is discarded for 50 [TA-162]', () => {
    const done = step(board('wht-117', [LIGHTNING]), [attack('Discharge')]);
    expect(dealtToB1(done.events)).toBe(50);
    expect(done.state.players.A.discard.map(c => c.printing)).toEqual([LIGHTNING]);
  });

  it('control: a Basic Water beside the Basic Lightning stays attached, 50 damage [TA-162]', () => {
    const done = step(board('wht-117', [LIGHTNING, WATER]), [attack('Discharge')]);
    expect(dealtToB1(done.events)).toBe(50);
    expect(done.state.players.A.active?.energy.map(c => c.printing)).toEqual([WATER]);
  });
});
