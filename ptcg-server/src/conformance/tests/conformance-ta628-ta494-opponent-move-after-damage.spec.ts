import { step } from '../driver';
import {
  NeutralState, NeutralEvent, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.84 (2026-10-05): an attack effect that moves the OPPONENT's cards in play moves them after the damage (#77: "If an
 * attack discards energy from the Defending Pokemon, the damage reduction happens first and then apply any attack
 * effects") and before Knock Outs are checked; a card the effect moved does not react to that attack's damage (#674,
 * Dangerous Energy: "You would not receive the 2 damage counters"; #2012). B.84 (3), WHEN the choice is asked, is not
 * decided: these cells pinned only the move and the reaction. B.85 (3)(a) (2026-10-06, TA-645) since places the choice
 * after the damage too; the two "asked before the damage" cells were rewritten to "asked after the damage".
 *
 * TA-628 Spiky Energy jtg-159 / jtg-190 ("If the Pokémon this card is attached to is in the Active Spot and is damaged by
 * an attack from your opponent's Pokémon (even if it is Knocked Out), put 2 damage counters on the Attacking Pokémon"):
 * it placed its counters at the DealDamageEffect, before Crunch twm-094 ("Discard an Energy from your opponent's Active
 * Pokémon.") discarded it. It now reacts in the damage-response window (B.53: after the attack's effects) and only if
 * it is still attached to the damaged Pokémon.
 *
 * TA-494 svi-015 Trick Cape ("You may put an Energy attached to your opponent's Active Pokémon into their hand.") and
 * svi-026 Eerie Tentacles ("You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon."):
 * the Energy moved before the damage, so Regirock jtg-082 Rock Armor ("If this Pokémon has any Energy attached, it takes
 * 30 less damage from attacks") with 1 Energy took 80 / 60; with the move after the damage it takes 50 / 30.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const PSYCHIC = 'sve-005';
const SPIKY = 'jtg-159';
const SPIKY_RR = 'jtg-190';
const DONDOZO = 'svi-061';   // 160 HP
const REGIROCK = 'jtg-082';  // Rock Armor, Grass weakness

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function slot(iids: string[], printings: string[], energy: CardRef[], damage = 0): PokemonInPlay {
  return {
    stack: printings.map((printing, i) => ({ iid: iids[i], printing })), energy, tools: [], damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string): PrizeRef[] {
  return cards(tag, 6, GRASS).map(c => ({ ...c, faceUp: false }));
}
function player(active: PokemonInPlay, bench: PokemonInPlay[], tag: string): PlayerState {
  return { active, bench, hand: [], deck: cards(`${tag}d`, 6, GRASS), discard: [], lostZone: [], prizes: prizes(`${tag}p`), flags: flags() };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null, players: { A, B } } as NeutralState;
}

/** Scream Tail ex twm-094 (190 HP) with [P][P][P] into Dondozo with Spiky Energy b1e0 + a Psychic b1e1. */
function crunchBoard(spiky = SPIKY, b1Damage = 0): NeutralState {
  const A = player(slot(['a1'], ['twm-094'], cards('ae', 3, PSYCHIC)), [], 'a');
  const B = player(slot(['b1'], [DONDOZO], [{ iid: 'b1e0', printing: spiky }, { iid: 'b1e1', printing: PSYCHIC }], b1Damage),
    [slot(['b2'], [DONDOZO], [])], 'b');
  return board(A, B);
}
/** Meowscarada svi-015 (stack a1 a2 a3) or Toedscruel svi-026 (a1 a2) with one [G], into `defender` with `energy`. */
function riderBoard(meow: boolean, defender: string, energy: CardRef[]): NeutralState {
  const attacker = meow ? slot(['a1', 'a2', 'a3'], ['svi-013', 'svi-014', 'svi-015'], [{ iid: 'ae0', printing: GRASS }])
    : slot(['a1', 'a2'], ['svi-025', 'svi-026'], [{ iid: 'ae0', printing: GRASS }]);
  const A = player(attacker, [], 'a');
  const B = player(slot(['b1'], [defender], energy), [slot(['b2'], [DONDOZO], [])], 'b');
  return board(A, B);
}

const act = (a: object) => a as unknown as NeutralAction;
const attack = (name: string) => act({ actor: 'A', type: 'declareAttack', source: 'a1', name });
const discard = (target: string) => act({ actor: 'A', type: 'discard', owner: 'B', target, op: 'discard', destination: 'discardPile' });
const yes = act({ actor: 'A', type: 'confirm', value: true });
const no = act({ actor: 'A', type: 'confirm', value: false });
const tentacles = act({ actor: 'A', type: 'moveEnergy', card: 'b1e0', source: 'b1', target: 'b2' });

type Damaged = { kind: string; target?: string; hp?: number };
const dealt = (events: NeutralEvent[], iid: string) => (events as Damaged[])
  .filter(e => e.kind === 'damaged' && e.target === iid).reduce((n, e) => n + (e.hp ?? 0), 0);
const rejected = (r: ReturnType<typeof step>) => r.status === 'invalidAction' ? r : undefined;
function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.card, a.target, a.value].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
function energyOf(r: ReturnType<typeof step>, iid: string): string[] {
  const B = r.state.players.B;
  const s = [B.active, ...B.bench].find(x => x && x.stack.some(c => c.iid === iid));
  return s ? s.energy.map(e => e.iid) : [];
}
function inZone(r: ReturnType<typeof step>, zone: 'discard' | 'hand', iid: string): boolean {
  return (r.state.players.B[zone] as CardRef[]).some(c => c.iid === iid);
}

describe('TA-628: Spiky Energy discarded by the attack\'s own effect does not react to its damage (#674, B.84 (2))', () => {
  for (const spiky of [SPIKY, SPIKY_RR]) {
    it(`${spiky}: Crunch discards the Spiky Energy, no counters on Scream Tail [TA-628]`, () => {
      const r = step(crunchBoard(spiky), [attack('Crunch'), discard('b1e0')]);
      expect(rejected(r)).toBeUndefined();
      expect(dealt(r.events, 'b1')).toBe(120);
      expect(inZone(r, 'discard', 'b1e0')).toBe(true);
      expect(dealt(r.events, 'a1')).toBe(0);
      expect(r.state.players.A.active?.damage).toBe(0);
    });
  }

  it('Crunch discards the other Energy: Spiky Energy stays and puts 2 counters on Scream Tail [TA-628]', () => {
    const r = step(crunchBoard(), [attack('Crunch'), discard('b1e1')]);
    expect(rejected(r)).toBeUndefined();
    expect(energyOf(r, 'b1')).toEqual(['b1e0']);
    expect(r.state.players.A.active?.damage).toBe(20);
  });

  it('Knock Out, Crunch discards the other Energy: Spiky Energy still puts 2 counters on Scream Tail [TA-628]', () => {
    const r = step(crunchBoard(SPIKY, 50), [attack('Crunch'), discard('b1e1')]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(120);
    expect(r.state.players.A.active?.damage).toBe(20);
  });

  it('Knock Out, Crunch discards the Spiky Energy: no counters [TA-628]', () => {
    const r = step(crunchBoard(SPIKY, 50), [attack('Crunch'), discard('b1e0')]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(120);
    expect(r.state.players.A.active?.damage).toBe(0);
  });

  it('the Crunch pick is still asked after the damage, with Spiky Energy attached (choice timing unchanged) [TA-628]', () => {
    const r = step(crunchBoard(), [attack('Crunch')]);
    expect(legal(r)).toEqual(['A:discard:b1e0', 'A:discard:b1e1']);
    expect(dealt(r.events, 'b1')).toBe(120);
    expect(energyOf(r, 'b1')).toEqual(['b1e0', 'b1e1']);
  });

  it('Trick Cape declined: Spiky Energy stays attached and puts 2 counters on Meowscarada [TA-628]', () => {
    const r = step(riderBoard(true, DONDOZO, [{ iid: 'b1e0', printing: SPIKY }]), [attack('Trick Cape'), no]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(40);
    expect(r.state.players.A.active?.damage).toBe(20);
  });

  it('Trick Cape puts the Spiky Energy into the hand after the damage: no counters [TA-628]', () => {
    const r = step(riderBoard(true, DONDOZO, [{ iid: 'b1e0', printing: SPIKY }]), [attack('Trick Cape'), yes]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(40);
    expect(inZone(r, 'hand', 'b1e0')).toBe(true);
    expect(r.state.players.A.active?.damage).toBe(0);
  });
});

describe('TA-494: Trick Cape and Eerie Tentacles move the opponent\'s Energy after the damage (#77, B.84 (1))', () => {
  const rock = [{ iid: 'b1e0', printing: WATER }];

  it('svi-015 Trick Cape: the confirm is asked after the damage (B.85 (3)(a), TA-645) [TA-494 svi-015]', () => {
    const r = step(riderBoard(true, REGIROCK, rock), [attack('Trick Cape')]);
    expect(legal(r)).toEqual(['A:confirm:false', 'A:confirm:true']);
    expect(dealt(r.events, 'b1')).toBe(50);
    expect(energyOf(r, 'b1')).toEqual(['b1e0']);
  });

  it('svi-015 Trick Cape: Rock Armor reads the Energy, 50 damage, then the Energy goes to the hand [TA-494 svi-015]', () => {
    const r = step(riderBoard(true, REGIROCK, rock), [attack('Trick Cape'), yes]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(50);
    expect(inZone(r, 'hand', 'b1e0')).toBe(true);
    expect(energyOf(r, 'b1')).toEqual([]);
    const kinds = r.events.filter(e => e.kind === 'damaged' || (e.kind === 'moved' && (e as any).card === 'b1e0')).map(e => e.kind);
    expect(kinds).toEqual(['damaged', 'moved']);
  });

  it('svi-015 Trick Cape declined: 50 damage, the Energy stays [TA-494 svi-015]', () => {
    const r = step(riderBoard(true, REGIROCK, rock), [attack('Trick Cape'), no]);
    expect(dealt(r.events, 'b1')).toBe(50);
    expect(energyOf(r, 'b1')).toEqual(['b1e0']);
  });

  it('svi-026 Eerie Tentacles: the move is offered after the damage (B.85 (3)(a), TA-645) [TA-494 svi-026]', () => {
    const r = step(riderBoard(false, REGIROCK, rock), [attack('Eerie Tentacles')]);
    expect(legal(r)).toEqual(['A:confirm:false', 'A:moveEnergy:b1e0:b2']);
    expect(dealt(r.events, 'b1')).toBe(30);
    expect(energyOf(r, 'b1')).toEqual(['b1e0']);
  });

  it('svi-026 Eerie Tentacles: Rock Armor reads the Energy, 30 damage, then the Energy moves to the Bench [TA-494 svi-026]', () => {
    const r = step(riderBoard(false, REGIROCK, rock), [attack('Eerie Tentacles'), tentacles]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(30);
    expect(energyOf(r, 'b2')).toEqual(['b1e0']);
    expect(energyOf(r, 'b1')).toEqual([]);
    const kinds = r.events.filter(e => e.kind === 'damaged' || (e.kind === 'moved' && (e as any).card === 'b1e0')).map(e => e.kind);
    expect(kinds).toEqual(['damaged', 'moved']);
  });

  it('svi-026 Eerie Tentacles moves the Spiky Energy to the Bench: no counters on Toedscruel [TA-494 svi-026]', () => {
    const r = step(riderBoard(false, DONDOZO, [{ iid: 'b1e0', printing: SPIKY }]), [attack('Eerie Tentacles'), tentacles]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(30);
    expect(energyOf(r, 'b2')).toEqual(['b1e0']);
    expect(r.state.players.A.active?.damage).toBe(0);
  });
});
