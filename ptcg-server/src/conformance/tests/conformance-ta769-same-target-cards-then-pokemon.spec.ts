import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, NeutralAction, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-769 / B.120 (amended, owner 2026-10-25; supersedes the 2026-10-23 first-card-then-its-Pokémon order). When several
 * cards go to ONE Pokémon, every card is picked first (with the confirm {value: false} stop in the same pending where the
 * count is "up to"), then the one Pokémon they all go to: choose {target: pokemon}. Every card forced ("Move all
 * Energy"): only the Pokémon is asked. One legal Pokémon (B.116): it is not asked and each card offer carries op: attach
 * and recipient. Twinleaf offered attachEnergy / moveEnergy {card, target} pairs. Keyed in attach-energy.ts on the
 * prompt's shape (sameTarget, max > 1), so every card raising it gets this (Motivate, Tropic Breeze, Empower, Jet
 * Cyclone, Fillet Memento, Energizer Wheel, Golden Flame ...). Not "in any way you like" (no sameTarget): pairs stay.
 * Mutation guard: drop the isSameTarget branch in planStep -> the pairs come back and these cells red.
 */

const GRASS = 'sve-001', FIRE = 'sve-002', PSYCHIC = 'sve-005', FILLER = 'asc-004';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [], deck: cards(`${tag}d`, 6, GRASS),
    prizes: cards(`${tag}p`, 6, GRASS).map(c => ({ ...c, faceUp: false })) as PrizeRef[], flags: flags(), ...over,
  };
}
function board(A: Partial<PlayerState>): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main',
    outcome: 'ongoing', stadium: null, players: { A: player('a', A), B: player('b', { active: mon('b1', FILLER) }) },
  } as NeutralState;
}
type La = { type: string; target?: string; card?: string; op?: string; recipient?: string; value?: boolean };
const offers = (r: ReturnType<typeof step>): string[] => ((r.pending?.legalActions ?? []) as unknown as La[])
  .map(a => (a.type === 'confirm' ? `confirm:${a.value}` : `${a.type}:${a.card ? a.card + '>' : ''}${a.target}${a.op ? ':' + a.op : ''}${a.recipient ? '>' + a.recipient : ''}`))
  .sort();
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as unknown as NeutralAction);
const stop = { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction;
const declare = (name: string) => ({ actor: 'A', type: 'declareAttack', source: 'a1', name } as unknown as NeutralAction);
const bench = (n: number) => Array.from({ length: n }, (_, i) => mon(`ab${i + 1}`, FILLER));
const on = (r: ReturnType<typeof step>, i: number) => r.state.players.A.bench[i].energy.map(e => e.iid).sort();
const chosen = (r: ReturnType<typeof step>) => r.events.filter(e => e.kind === 'chosen').map(e => (e as { card: string }).card);

// Motivate paf-075 (Squawkabilly ex): "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon."
describe('TA-769 — Motivate paf-075: the cards (and the stop), then the one Benched Pokémon', () => {
  const b = (n = 2) => board({ active: mon('a1', 'paf-075', cards('ae', 1, GRASS)), bench: bench(n), discard: cards('adc', 2, GRASS) });
  it('first pending: the two cards and the stop, no pairs [TA-769 paf-075]', () => {
    expect(offers(step(b(), [declare('Motivate')]))).toEqual(['choose:adc0:attach', 'choose:adc1:attach', 'confirm:false']);
  });
  it('after one card: the other card and the stop; the card is chosen (Step D, B.89) [TA-769 paf-075 second]', () => {
    const r = step(b(), [declare('Motivate'), choose('adc0')]);
    expect(offers(r)).toEqual(['choose:adc1:attach', 'confirm:false']);
    expect(chosen(r)).toEqual(['adc0']);
  });
  it('after both cards: only the Pokémon, no stop [TA-769 paf-075 pokemon]', () => {
    expect(offers(step(b(), [declare('Motivate'), choose('adc0'), choose('adc1')]))).toEqual(['choose:ab1:attach', 'choose:ab2:attach']);
  });
  it('both to ab2 [TA-769 paf-075 attached]', () => {
    const r = step(b(), [declare('Motivate'), choose('adc0'), choose('adc1'), choose('ab2')]);
    expect(r.status).not.toBe('invalidAction');
    expect(on(r, 1)).toEqual(['adc0', 'adc1']);
    expect(on(r, 0)).toEqual([]);
  });
  it('one card, the stop, then the Pokémon: one attached [TA-769 paf-075 stop]', () => {
    expect(offers(step(b(), [declare('Motivate'), choose('adc1'), stop]))).toEqual(['choose:ab1:attach', 'choose:ab2:attach']);
    const r = step(b(), [declare('Motivate'), choose('adc1'), stop, choose('ab1')]);
    expect(on(r, 0)).toEqual(['adc1']);
  });
  it('a pair is not offered and is refused [TA-769 paf-075 pair refused]', () => {
    const pair = { actor: 'A', type: 'attachEnergy', card: 'adc0', target: 'ab1' } as unknown as NeutralAction;
    expect(step(b(), [declare('Motivate'), pair]).status).toBe('invalidAction');
  });
  it('one Benched Pokémon: not asked; each card offer names it (recipient, B.116) [TA-769 paf-075 one bench]', () => {
    expect(offers(step(b(1), [declare('Motivate')]))).toEqual(['choose:adc0:attach>ab1', 'choose:adc1:attach>ab1', 'confirm:false']);
    const r = step(b(1), [declare('Motivate'), choose('adc0'), choose('adc1')]);
    expect(on(r, 0)).toEqual(['adc0', 'adc1']);
  });
});

// Tropic Breeze pal-007 (Tropius): "Move all Energy from this Pokémon to 1 of your Benched Pokémon."
describe('TA-769 — Tropic Breeze pal-007: every Energy forced, so only the Pokémon is asked', () => {
  const b = (n = 2) => board({ active: mon('a1', 'pal-007', cards('a1e', 3, GRASS)), bench: bench(n) });
  it('first pending: choose {target: pokemon} only [TA-769 pal-007]', () => {
    expect(offers(step(b(), [declare('Tropic Breeze')]))).toEqual(['choose:ab1:moveTo', 'choose:ab2:moveTo']);
  });
  it('ab2: all three Energy move there [TA-769 pal-007 moved]', () => {
    const r = step(b(), [declare('Tropic Breeze'), choose('ab2')]);
    expect(on(r, 1)).toEqual(['a1e0', 'a1e1', 'a1e2']);
  });
});

// Empower mep-104 / 30c-064 (Mewtwo): "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Pokémon."
describe('TA-769 — Empower (Mewtwo 30c-064, mep-104\'s text): cards, then the Pokémon (Active included)', () => {
  const b = () => board({ active: mon('a1', '30c-064', cards('ae', 1, PSYCHIC)), bench: bench(2), discard: cards('adc', 2, GRASS) });
  it('the cards and the stop, then the three Pokémon [TA-769 30c-064]', () => {
    expect(offers(step(b(), [declare('Empower')]))).toEqual(['choose:adc0:attach', 'choose:adc1:attach', 'confirm:false']);
    expect(offers(step(b(), [declare('Empower'), choose('adc0'), choose('adc1')])))
      .toEqual(['choose:a1:attach', 'choose:ab1:attach', 'choose:ab2:attach']);
    const r = step(b(), [declare('Empower'), choose('adc0'), choose('adc1'), choose('a1')]);
    expect(r.state.players.A.active!.energy.map(e => e.iid).sort()).toEqual(['adc0', 'adc1', 'ae0']);
  });
});

// Golden Flame asc-026 (Ethan's Ho-Oh ex), an Ability from the hand: "attach up to 2 Basic [R] Energy cards from your hand
// to 1 of your Benched Ethan's Pokémon." Not a Step-D choice: the picked card is held (in transit, B.80) until the Pokémon.
describe('TA-769 — Golden Flame asc-026 (an Ability, from the hand)', () => {
  const b = () => board({ active: mon('a1', FILLER), bench: [mon('ab1', 'asc-026'), mon('ab2', 'asc-026')], hand: cards('ah', 2, FIRE) });
  const use = { actor: 'A', type: 'useAbility', source: 'ab1', ability: 'Golden Flame' } as unknown as NeutralAction;
  it('cards first, then the Pokémon; the picked card waits in transit, seen by its owner [TA-769 asc-026]', () => {
    const r1 = step(b(), [use, choose('ah0')]);
    expect(offers(r1)).toEqual(['choose:ah1:attach', 'confirm:false']);
    expect((r1.state.players.A.transit ?? []).map(t => `${t.iid}:${t.visibility}`)).toEqual(['ah0:owner']);
    expect(offers(step(b(), [use, choose('ah0'), choose('ah1')]))).toEqual(['choose:ab1:attach', 'choose:ab2:attach']);
    const r = step(b(), [use, choose('ah0'), choose('ah1'), choose('ab2')]);
    expect(on(r, 1)).toEqual(['ah0', 'ah1']);
    expect(r.state.players.A.transit ?? []).toEqual([]);
  });
});
