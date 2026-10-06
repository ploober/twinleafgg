import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-616: an attack's Bench damage is placed as a PutDamageEffect, so an attacker-side reduction read on DealDamageEffect
 * never reached it. In rotomancer's pool two reductions print no target limit: Garbodor cri-057 Gloomy Garbage
 * ("Attacks used by your opponent's Active Pokémon that has a Pokémon Tool attached do 20 less damage") and Antique Jaw
 * Fossil por-068 Intimidating Jaw ("attacks used by your opponent's Active Pokémon do 30 less damage"). Each now reduces
 * every placement once: a DealDamageEffect, or a PutDamageEffect the attack placed directly (weaknessApplied false).
 * TA-623: Gloomy Garbage reduced its owner's own attacks too. TA-624: Intimidating Jaw reduced only damage to the Fossil.
 *
 * Mega Eelektross ex asc-061 Split Bomb: "This attack does 60 damage to each of 2 of your opponent's Pokémon."
 */

const L = 'sve-004';
const EELEKTROSS = 'asc-061';
const GARBODOR = 'cri-057';
const FOSSIL = 'por-068';
const TOOL = 'pfl-093';   // Sacred Charm: only changes damage its holder TAKES

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: CardRef[] = [], tools: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools, damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, L).map(c => ({ ...c, faceUp: false }));
}
function board(o: { bActive: string, bBench: Array<[string, string]>, aBench?: Array<[string, string]>, tool: boolean }): NeutralState {
  const energy = [{ iid: 'ae0', printing: L }, { iid: 'ae1', printing: L }];
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a0', EELEKTROSS, energy, o.tool ? [{ iid: 'at0', printing: TOOL }] : []),
        bench: (o.aBench ?? []).map(([iid, p]) => mon(iid, p)),
        deck: cards('ad', 6, L), prizes: prizes('ap', 6),
      }),
      B: player({
        active: mon('b1', o.bActive), bench: o.bBench.map(([iid, p]) => mon(iid, p)),
        deck: cards('bd', 6, L), prizes: prizes('bp', 6),
      }),
    },
  };
}

const attack = { actor: 'A', type: 'declareAttack', source: 'a0', name: 'Split Bomb' } as never;
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as never);
const dealt = (events: NeutralEvent[], iid: string) => (events as Array<{ kind: string; target?: string; hp?: number }>)
  .filter(e => e.kind === 'damaged' && e.target === iid).reduce((n, e) => n + (e.hp ?? 0), 0);

describe('TA-616: an attacker-side reduction with no target limit reaches the Bench damage', () => {
  it('Gloomy Garbage (B has Garbodor, A\'s attacker holds a Tool): Active 40 and Bench 40 [TA-616]', () => {
    const b = board({ bActive: EELEKTROSS, bBench: [['bb1', GARBODOR], ['bb2', EELEKTROSS]], tool: true });
    const r = step(b, [attack, choose('b1'), choose('bb2')]);
    expect(dealt(r.events, 'b1')).toBe(40);
    expect(dealt(r.events, 'bb2')).toBe(40);
  });

  it('control: no Tool on the attacker, no reduction: 60 and 60 [TA-616]', () => {
    const b = board({ bActive: EELEKTROSS, bBench: [['bb1', GARBODOR], ['bb2', EELEKTROSS]], tool: false });
    const r = step(b, [attack, choose('b1'), choose('bb2')]);
    expect(dealt(r.events, 'b1')).toBe(60);
    expect(dealt(r.events, 'bb2')).toBe(60);
  });

  it('Gloomy Garbage on the ATTACKER\'s side does not reduce its owner\'s attack: 60 and 60 [TA-623]', () => {
    const b = board({ bActive: EELEKTROSS, bBench: [['bb2', EELEKTROSS]], aBench: [['ab1', GARBODOR]], tool: true });
    const r = step(b, [attack]);   // two targets in total: the pick is forced
    expect(dealt(r.events, 'b1')).toBe(60);
    expect(dealt(r.events, 'bb2')).toBe(60);
  });

  it('Intimidating Jaw (B\'s Active Fossil) reduces the Fossil and the Bench: 30 and 30 [TA-624]', () => {
    const b = board({ bActive: FOSSIL, bBench: [['bb2', EELEKTROSS]], tool: false });
    const r = step(b, [attack]);
    expect(dealt(r.events, 'b1')).toBe(30);
    expect(dealt(r.events, 'bb2')).toBe(30);
  });
});
