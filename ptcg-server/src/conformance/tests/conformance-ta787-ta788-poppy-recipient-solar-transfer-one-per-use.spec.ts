import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-787 (SR-6: B.116, B.122): Poppy obf-193 "Move up to 2 Energy from 1 of your Pokémon to another of your Pokémon."
 * With only one other Pokémon in play the destination is not a choice: each Energy offer names it (recipient), as for
 * every other one-destination Energy move (TA-786). Two or more other Pokémon keep TA-778's source, Energy, destination.
 * TA-788: Mega Venusaur ex meg-003 Solar Transfer "As often as you like during your turn, you may use this Ability. Move
 * a Basic [Grass] Energy from 1 of your Pokémon to another of your Pokémon." One use moves one Energy; the next is
 * another use. Printed text from card-data/final/<set>.json.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const LIGHTNING = 'sve-004';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = []): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function deck(tag: string) {
  return Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
function board(active: PokemonInPlay, bench: PokemonInPlay[], hand: string[] = []): NeutralState {
  const A: PlayerState = { active, bench, hand: hand.map((p, i) => ({ iid: `ah${i}`, printing: p })), deck: deck('a'),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b0', ['twm-118']), bench: [], hand: [], deck: deck('b'),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const choose = (target: string) => act({ actor: 'A', type: 'choose', target });
type Offer = { type: string; target?: string; card?: string; recipient?: string; value?: unknown; ability?: string };
const offers = (r: ReturnType<typeof step>) => ((r.pending?.legalActions ?? []) as unknown as Offer[]);
const shape = (r: ReturnType<typeof step>) => offers(r)
  .map(a => a.type === 'choose' ? `choose:${a.target}>${a.recipient ?? '-'}` : a.type === 'confirm' ? `confirm:${a.value}` : a.type).sort();
function energyOn(r: ReturnType<typeof step>, iid: string): string[] {
  const A = r.state.players.A;
  const slot = [A.active, ...A.bench].find(s => s && s.stack.some(c => c.iid === iid));
  return slot ? slot.energy.map(e => e.iid).sort() : [];
}

// ------------------------------------------------------------------ TA-787 Poppy
const poppy = act({ actor: 'A', type: 'playSupporter', card: 'ah0' });
/** a0 with [W][L], one other Pokémon a1 (no Energy): the source is forced, the destination is a1. */
const onePoppy = () => board(mon('a0', ['twm-118'], [WATER, LIGHTNING]), [mon('a1', ['twm-118'])], ['obf-193']);

describe('TA-787 Poppy with one other Pokémon: each Energy offer names the destination', () => {
  it('the Energy are offered with recipient a1 [TA-787 obf-193]', () => {
    expect(shape(step(onePoppy(), [poppy]))).toEqual(['choose:a0e0>a1', 'choose:a0e1>a1']);
  });
  it('after one: the other (recipient a1) and the stop; both land on a1 [TA-787 obf-193 second]', () => {
    expect(shape(step(onePoppy(), [poppy, choose('a0e1')]))).toEqual(['choose:a0e0>a1', 'confirm:false']);
    const r = step(onePoppy(), [poppy, choose('a0e1'), choose('a0e0')]);
    expect(r.status).not.toBe('invalidAction');
    expect(energyOn(r, 'a1')).toEqual(['a0e0', 'a0e1']);
    expect(energyOn(r, 'a0')).toEqual([]);
  });
  it('the stop after one: only it moves [TA-787 obf-193 stop]', () => {
    const r = step(onePoppy(), [poppy, choose('a0e1'), act({ actor: 'A', type: 'confirm', value: false })]);
    expect(energyOn(r, 'a1')).toEqual(['a0e1']);
    expect(energyOn(r, 'a0')).toEqual(['a0e0']);
  });
  it('control: two other Pokémon keep the source, Energy, destination order [TA-787 obf-193 two destinations]', () => {
    const b = board(mon('a0', ['twm-118'], [WATER, LIGHTNING]), [mon('a1', ['twm-118']), mon('a2', ['twm-118'])], ['obf-193']);
    expect(shape(step(b, [poppy]))).toEqual(['choose:a0e0>-', 'choose:a0e1>-']);
    expect(shape(step(b, [poppy, choose('a0e0'), choose('a0e1')]))).toEqual(['choose:a1>-', 'choose:a2>-']);
  });
});

// ------------------------------------------------------------------ TA-788 Solar Transfer
const VENUSAUR = ['meg-001', 'meg-002', 'meg-003'];
const solar = act({ actor: 'A', type: 'useAbility', source: 'a1', ability: 'Solar Transfer' });
const venusaur = (benched: number) => board(mon('a1', VENUSAUR, [GRASS, GRASS, GRASS]),
  Array.from({ length: benched }, (_, i) => mon(`a${i + 2}`, ['twm-118'])));

describe('TA-788 Solar Transfer moves one Basic [Grass] Energy per use', () => {
  it('one Benched Pokémon: after one pick the use is over; the next is another use [TA-788 meg-003]', () => {
    const r = step(venusaur(1), [solar, choose('a1e0')]);
    expect(r.status).not.toBe('invalidAction');
    expect(energyOn(r, 'a2')).toEqual(['a1e0']);
    expect(energyOn(r, 'a1')).toEqual(['a1e1', 'a1e2']);
    expect(offers(r).some(a => a.type === 'choose' || a.type === 'confirm')).toBe(false);
    expect(offers(r).some(a => a.type === 'useAbility')).toBe(true);
  });
  // After the first use a2 holds a [G] that could go back to a1: two destinations, so the second use asks the pair.
  it('a second use moves a second Energy [TA-788 meg-003 again]', () => {
    const r = step(venusaur(1), [solar, choose('a1e0'), solar, act({ actor: 'A', type: 'moveEnergy', card: 'a1e1', source: 'a1', target: 'a2' })]);
    expect(energyOn(r, 'a2')).toEqual(['a1e0', 'a1e1']);
  });
  it('two Benched Pokémon: one move, then the use is over [TA-788 meg-003 two destinations]', () => {
    const r = step(venusaur(2), [solar, act({ actor: 'A', type: 'moveEnergy', card: 'a1e0', source: 'a1', target: 'a3' })]);
    expect(r.status).not.toBe('invalidAction');
    expect(energyOn(r, 'a3')).toEqual(['a1e0']);
    expect(offers(r).some(a => a.type === 'moveEnergy' || a.type === 'confirm')).toBe(false);
  });
});
