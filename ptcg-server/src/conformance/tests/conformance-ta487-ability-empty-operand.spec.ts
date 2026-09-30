import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-487 — an activated Ability whose operand set is empty and public cannot be used (B.29 rule 1; #2306 Grand
 * Wing, an Ability ruling: "even though it won't do anything? — No"), so the menu must not offer it.
 *
 *   Snorlax mew-143 Voraciousness — "put up to 2 Leftovers cards from your discard pile into your hand": a Leftovers.
 *   Armarouge paf-015 Fire Off — "move a [R] Energy from 1 of your Benched Pokémon to your Active": a Benched [R].
 *   Gardevoir ex paf-029 Psychic Embrace — "attach a Basic [P] Energy card from your discard pile to 1 of your [P]
 *     Pokémon ... You can't use this Ability on a Pokémon that would be Knocked Out": the Energy AND a recipient.
 *
 * Each handler opened a min-0 prompt instead of throwing, so the adapter's throw-only clone probe accepted the offer.
 *
 * Mutation guards: drop any one CANNOT_USE_POWER gate and its "withheld" cells go red; key a gate on "zone
 * non-empty" and the non-Leftovers / would-be-KO cells go red; the "offered" cells pin that the gate is not a blanket
 * refusal.
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const PSYCHIC = 'sve-005';
const BELLSPROUT = 'asc-004';

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
function offers(s: NeutralState, ability: string): boolean {
  const r = step(s, []);
  return (r.pending?.legalActions || []).some(a => a.type === 'useAbility' && (a as { ability?: string }).ability === ability);
}

const snorlax = (discard: string[]) => board(mon('a1', ['mew-143']), [mon('a2', [BELLSPROUT])], discard);
const armarouge = (benchEnergy: string[]) => board(mon('a1', ['mep-022', 'paf-015'], [FIRE, FIRE]), [mon('a2', [BELLSPROUT], benchEnergy)], []);
const gardevoir = (discard: string[], damage = 0) =>
  board(mon('a1', ['asc-087', 'asc-088', 'paf-029'], [PSYCHIC], damage), [mon('a2', [BELLSPROUT])], discard);

describe('TA-487 an Ability with an empty operand is not offered', () => {
  it('Voraciousness: withheld with an empty discard pile [TA-487 mew-143]', () => {
    expect(offers(snorlax([]), 'Voraciousness')).toBe(false);
  });
  it('Voraciousness: withheld when the discard holds no Leftovers [TA-487 mew-143]', () => {
    expect(offers(snorlax([GRASS]), 'Voraciousness')).toBe(false);
  });
  it('Voraciousness: offered with a Leftovers in the discard [TA-487 mew-143]', () => {
    expect(offers(snorlax(['mew-163']), 'Voraciousness')).toBe(true);
  });

  it('Fire Off: withheld when no Benched Pokemon has a [R] Energy (the Active\'s own does not count) [TA-487 paf-015]', () => {
    expect(offers(armarouge([]), 'Fire Off')).toBe(false);
    expect(offers(armarouge([GRASS]), 'Fire Off')).toBe(false);
  });
  it('Fire Off: offered with a [R] Energy on the Bench [TA-487 paf-015]', () => {
    expect(offers(armarouge([FIRE]), 'Fire Off')).toBe(true);
  });

  it('Psychic Embrace: withheld with no Basic [P] Energy in the discard [TA-487 paf-029]', () => {
    expect(offers(gardevoir([]), 'Psychic Embrace')).toBe(false);
    expect(offers(gardevoir([GRASS]), 'Psychic Embrace')).toBe(false);
  });
  it('Psychic Embrace: withheld when every [P] recipient would be Knocked Out by 2 counters [TA-487 paf-029]', () => {
    expect(offers(gardevoir([PSYCHIC], 290), 'Psychic Embrace')).toBe(false);
  });
  it('Psychic Embrace: offered with the Energy and a surviving [P] recipient [TA-487 paf-029]', () => {
    expect(offers(gardevoir([PSYCHIC]), 'Psychic Embrace')).toBe(true);
    expect(offers(gardevoir([PSYCHIC], 280), 'Psychic Embrace')).toBe(true);
  });
});
