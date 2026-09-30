import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-488 — once an activated Ability is used, its printed count applies: the decline was NOT using it. "move a [R]
 * Energy" is exactly 1; an Ability's "up to 2" is 1..2 (#2301); so a single candidate collapses (CF-14) and no
 * confirm:false is offered. Psychic Embrace's recipient is "1 of your [P] Pokémon" that 2 counters would not Knock Out.
 *
 * Voraciousness, Fire Off and Psychic Embrace resolved through min-0 prompts (a free decline after use), and Psychic
 * Embrace offered non-[P] recipients that its own callback then refused.
 *
 * Mutation guards: min back to 0 on any of the three and its collapse cell goes red; drop Psychic Embrace's blockedTo
 * and the non-[P] cells go red.
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const PSYCHIC = 'sve-005';
const BELLSPROUT = 'asc-004';
const RALTS = 'asc-087';
const LEFTOVERS = 'mew-163';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = [], damage = 0): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: `${iid}s${i}`, printing })), energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: [], damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function deck(tag: string): CardRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
function board(active: PokemonInPlay, bench: PokemonInPlay[], discard: string[]): NeutralState {
  const A: PlayerState = { active, bench, hand: [], deck: deck('a'), discard: discard.map((printing, i) => ({ iid: `ax${i}`, printing })),
    lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', [BELLSPROUT]), bench: [], hand: [], deck: deck('b'),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const use = (ability: string) => ({ actor: 'A', type: 'useAbility', source: 'a1s0', ability } as unknown as NeutralAction);
function legal(r: ReturnType<typeof step>): string[] {
  return (r.pending?.legalActions || []).map(a => {
    const x = a as { type: string, card?: string, target?: string, value?: boolean };
    return [x.type, x.card, x.target, x.value].filter(v => v !== undefined && v !== null).join(':');
  }).sort();
}
const inMain = (r: ReturnType<typeof step>) => legal(r).includes('endTurn');

describe('TA-488 a used Ability resolves its printed count', () => {
  it('Voraciousness: one Leftovers collapses into the hand [TA-488 mew-143]', () => {
    const r = step(board(mon('a1', ['mew-143']), [mon('a2', [BELLSPROUT])], [LEFTOVERS]), [use('Voraciousness')]);
    expect(inMain(r)).toBe(true);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ax0']);
  });
  it('Voraciousness: two Leftovers is a choice with no decline at the first pick [TA-488 mew-143]', () => {
    const r = step(board(mon('a1', ['mew-143']), [mon('a2', [BELLSPROUT])], [LEFTOVERS, LEFTOVERS]), [use('Voraciousness')]);
    expect(inMain(r)).toBe(false);
    expect(legal(r)).not.toContain('confirm:false');
  });

  it('Fire Off: one Benched [R] collapses onto the Active [TA-488 paf-015]', () => {
    const r = step(board(mon('a1', ['mep-022', 'paf-015'], [FIRE]), [mon('a2', [BELLSPROUT], [FIRE])], []), [use('Fire Off')]);
    expect(inMain(r)).toBe(true);
    expect(r.state.players.A.active!.energy.map(e => e.iid)).toEqual(['a1e0', 'a2e0']);
  });
  it('Fire Off: moves exactly one [R] per use, with no decline [TA-488 paf-015]', () => {
    const r = step(board(mon('a1', ['mep-022', 'paf-015']), [mon('a2', [BELLSPROUT], [FIRE, FIRE])], []), [use('Fire Off')]);
    expect(legal(r)).not.toContain('confirm:false');
    expect(legal(r).length).toBe(2);
  });

  it('Psychic Embrace: the one [P] recipient collapses; the [G] Bench is not offered [TA-488 paf-029]', () => {
    const r = step(board(mon('a1', [RALTS, 'asc-088', 'paf-029']), [mon('a2', [BELLSPROUT])], [PSYCHIC]), [use('Psychic Embrace')]);
    expect(inMain(r)).toBe(true);
    expect(r.state.players.A.active!.energy.map(e => e.iid)).toEqual(['ax0']);
    expect(r.state.players.A.active!.damage).toBe(20);
  });
  it('Psychic Embrace: two [P] recipients are a choice with no decline and no [G] target [TA-488 paf-029]', () => {
    const r = step(board(mon('a1', [RALTS, 'asc-088', 'paf-029']), [mon('a2', [RALTS]), mon('a3', [BELLSPROUT])], [PSYCHIC]),
      [use('Psychic Embrace')]);
    expect(inMain(r)).toBe(false);
    expect(legal(r)).not.toContain('confirm:false');
    expect(legal(r).some(a => a.endsWith('a3s0'))).toBe(false);
  });
  it('Psychic Embrace: a [P] Pokemon that 2 counters would Knock Out is not a recipient [TA-488 paf-029]', () => {
    const r = step(board(mon('a1', [RALTS, 'asc-088', 'paf-029']), [mon('a2', [RALTS], [], 50)], [PSYCHIC]), [use('Psychic Embrace')]);
    expect(inMain(r)).toBe(true);
    expect(r.state.players.A.active!.energy.map(e => e.iid)).toEqual(['ax0']);
  });
});
