import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-786 (SR-6: B.116, B.122, B.132): an Energy move whose every candidate Energy has the same single legal destination
 * does not ask the destination. Each Energy is offered alone, `choose {target: Energy, op, recipient: the destination}`,
 * and the (card, source, target) triples are not offered. Triples stay while two or more destinations are legal. SR-5's
 * exception says the same for moves: "A fixed source ("this Pokémon") or a single legal destination is not asked".
 * Both prompt shapes that carry an in-play Energy move are covered: an AttachEnergyPrompt over this Pokémon (Power
 * Cyclone) and a MoveEnergyPrompt (N's Plan, Energy Switch).
 * Printed text from card-data/final/<set>.json:
 *
 *   obf-085 Togekiss Power Cyclone (110): "Move an Energy from this Pokémon to 1 of your Benched Pokémon."
 *   blk-083 N's Plan: "Move up to 2 Energy from your Benched Pokémon to your Active Pokémon."
 *   svi-173 Energy Switch: "Move a Basic Energy from 1 of your Pokémon to another of your Pokémon."
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const WATER = 'sve-003';
const DONDOZO = 'svi-061';   // 160 HP
const BIG = 'mew-003';       // Venusaur ex, 340 HP
const TOGEKISS = 'obf-085';
const NS_PLAN = 'blk-083';
const ENERGY_SWITCH = 'svi-173';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = []): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string): PrizeRef[] {
  return cards(tag, 6, GRASS).map(c => ({ ...c, faceUp: false }));
}
function player(active: PokemonInPlay, bench: PokemonInPlay[], tag: string, hand: CardRef[] = []): PlayerState {
  return { active, bench, hand, deck: cards(`${tag}d`, 6, GRASS), discard: [], lostZone: [], prizes: prizes(`${tag}p`), flags: flags() };
}
function board(active: PokemonInPlay, bench: PokemonInPlay[], hand: CardRef[] = []): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null,
    players: { A: player(active, bench, 'a', hand), B: player(mon('b1', [BIG]), [], 'b') } } as NeutralState;
}
/** Togekiss a1 with [W][W] (a1e0, a1e1) and `benched` Dondozo (a2, a3, ...). */
const cyclone = (benched: number) => board(mon('a1', [TOGEKISS], [WATER, WATER]),
  Array.from({ length: benched }, (_, i) => mon(`a${i + 2}`, [DONDOZO])));
/** Dondozo a1; a2 holds [G] (a2e0), a3 holds [R] (a3e0); N's Plan in hand. */
const plan = () => board(mon('a1', [DONDOZO]), [mon('a2', [DONDOZO], [GRASS]), mon('a3', [DONDOZO], [FIRE])],
  [{ iid: 'np', printing: NS_PLAN }]);
/** Dondozo a1 with [W][W] (a1e0, a1e1); `benched` Dondozo; Energy Switch in hand. */
const switchBoard = (benched: number) => board(mon('a1', [DONDOZO], [WATER, WATER]),
  Array.from({ length: benched }, (_, i) => mon(`a${i + 2}`, [DONDOZO])), [{ iid: 'es', printing: ENERGY_SWITCH }]);

const act = (a: object) => a as unknown as NeutralAction;
const attack = (name: string) => act({ actor: 'A', type: 'declareAttack', source: 'a1', name });
const choose = (target: string) => act({ actor: 'A', type: 'choose', target });
const move = (card: string, source: string, target: string) => act({ actor: 'A', type: 'moveEnergy', card, source, target });
type Offer = { type: string; target?: string; card?: string; source?: string; op?: string; recipient?: string };
const offers = (r: ReturnType<typeof step>) => ((r.pending?.legalActions ?? []) as unknown as Offer[]);
/** choose offers as `target>recipient`, sorted. */
const chooseOffers = (r: ReturnType<typeof step>) => offers(r).filter(a => a.type === 'choose')
  .map(a => `${a.target}>${a.recipient ?? '?'}`).sort();
const moveOffers = (r: ReturnType<typeof step>) => offers(r).filter(a => a.type === 'moveEnergy')
  .map(a => `${a.card}:${a.source}>${a.target}`).sort();
const energyOn = (r: ReturnType<typeof step>, iid: string) => {
  const A = r.state.players.A;
  const p = [A.active, ...A.bench].find(x => x?.stack[0].iid === iid);
  return (p?.energy ?? []).map(e => e.iid).sort();
};

describe('TA-786 an Energy move with one legal destination asks only the Energy (SR-6)', () => {
  it('Power Cyclone, one Benched Pokémon: each Energy is offered alone with recipient a2, no triple [TA-786 obf-085]', () => {
    const r = step(cyclone(1), [attack('Power Cyclone')]);
    expect(r.status).toBe('awaitingAction');
    expect(chooseOffers(r)).toEqual(['a1e0>a2', 'a1e1>a2']);
    expect(moveOffers(r)).toEqual([]);
  });
  it('Power Cyclone, one Benched Pokémon: the chosen Energy moves to a2 after the 110 [TA-786 obf-085 resolves]', () => {
    const r = step(cyclone(1), [attack('Power Cyclone'), choose('a1e1')]);
    expect(r.status).not.toBe('invalidAction');
    expect(energyOn(r, 'a2')).toEqual(['a1e1']);
    expect(energyOn(r, 'a1')).toEqual(['a1e0']);
  });
  it('Power Cyclone, one Benched Pokémon: the triple is refused [TA-786 obf-085 triple refused]', () => {
    const r = step(cyclone(1), [attack('Power Cyclone'), move('a1e0', 'a1', 'a2')]);
    expect(r.status).toBe('invalidAction');
  });
  it('Power Cyclone, two Benched Pokémon: the triples stay [TA-786 obf-085 two destinations]', () => {
    const r = step(cyclone(2), [attack('Power Cyclone')]);
    expect(chooseOffers(r)).toEqual([]);
    expect(moveOffers(r)).toEqual(['a1e0:a1>a2', 'a1e0:a1>a3', 'a1e1:a1>a2', 'a1e1:a1>a3']);
  });
  it("N's Plan: each Benched Energy is offered alone with recipient a1 [TA-786 blk-083]", () => {
    const r = step(plan(), [act({ actor: 'A', type: 'playSupporter', card: 'np' })]);
    expect(r.status).toBe('awaitingAction');
    expect(chooseOffers(r)).toEqual(['a2e0>a1', 'a3e0>a1']);
    expect(moveOffers(r)).toEqual([]);
  });
  it("N's Plan: after one, the other Energy (recipient a1) and the stop; both reach a1 [TA-786 blk-083 second]", () => {
    const one = step(plan(), [act({ actor: 'A', type: 'playSupporter', card: 'np' }), choose('a3e0')]);
    expect(chooseOffers(one)).toEqual(['a2e0>a1']);
    expect(offers(one).some(a => a.type === 'endChoice' || a.type === 'confirm')).toBe(true);
    const two = step(plan(), [act({ actor: 'A', type: 'playSupporter', card: 'np' }), choose('a3e0'), choose('a2e0')]);
    expect(two.status).not.toBe('invalidAction');
    expect(energyOn(two, 'a1')).toEqual(['a2e0', 'a3e0']);
  });
  it("N's Plan: the triple is refused [TA-786 blk-083 triple refused]", () => {
    const r = step(plan(), [act({ actor: 'A', type: 'playSupporter', card: 'np' }), move('a2e0', 'a2', 'a1')]);
    expect(r.status).toBe('invalidAction');
  });
  it('Energy Switch, one Benched Pokémon: each Energy is offered alone with recipient a2 [TA-786 svi-173]', () => {
    const r = step(switchBoard(1), [act({ actor: 'A', type: 'playItem', card: 'es' })]);
    expect(chooseOffers(r)).toEqual(['a1e0>a2', 'a1e1>a2']);
    expect(moveOffers(r)).toEqual([]);
    const done = step(switchBoard(1), [act({ actor: 'A', type: 'playItem', card: 'es' }), choose('a1e0')]);
    expect(energyOn(done, 'a2')).toEqual(['a1e0']);
  });
  it('Energy Switch, two Benched Pokémon: the triples stay (the Active and the other bencher are destinations) [TA-786 svi-173 two destinations]', () => {
    const r = step(switchBoard(2), [act({ actor: 'A', type: 'playItem', card: 'es' })]);
    expect(chooseOffers(r)).toEqual([]);
    expect(moveOffers(r)).toEqual(['a1e0:a1>a2', 'a1e0:a1>a3', 'a1e1:a1>a2', 'a1e1:a1>a3']);
  });
});
