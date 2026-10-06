import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-634 Orthworm ex scr-110 / scr-162 Pummeling Payback (orthworm-ex.ts): "If this Pokémon is damaged by an attack
 * from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon
 * for each [M] Energy attached to this Pokémon."
 *
 * It fired on every Put/DealDamageEffect to EITHER Active while Orthworm was anywhere in its owner's play area, counted
 * the [M] on the damaged Active (not on Orthworm) and added 10 per [M] per effect (so 2 effects = "20 per [M]" by
 * accident on an Active Orthworm), and never fired for a Benched Orthworm. It now reacts once per attack, in the
 * damage-response window (B.53, AfterDamageEffect, as Spiky Energy jtg-159 does), only when Orthworm itself was
 * damaged by the opponent's attack (Bench included), counting the [M] Energy attached to it then (#2012), 2 counters
 * each on the Attacking Pokémon.
 *
 * Attacker: Larry's Staraptor asc-170 Feathery Strike (150 to the Active; "Discard 2 Energy from this Pokémon, and
 * this attack also does 50 damage to 1 of your opponent's Benched Pokémon").
 */

const GRASS = 'sve-001';
const PSYCHIC = 'sve-005';
const METAL = 'sve-008';
const ORTH = 'scr-162';
const ORTH_BASE = 'scr-110';
const LATIAS = 'meg-181';
const DONDOZO = 'svi-061';

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
function board(B: PlayerState): NeutralState {
  const A = player(slot(['a1', 'a2', 'a3'], ['asc-168', 'asc-169', 'asc-170'], cards('ae', 3, GRASS)), [], 'a');
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null, players: { A, B } } as NeutralState;
}
const metal = (tag: string, n: number) => cards(tag, n, METAL);

const act = (a: object) => a as unknown as NeutralAction;
const strike: NeutralAction[] = [
  act({ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Feathery Strike' }),
  act({ actor: 'A', type: 'discard', owner: 'A', target: 'ae0', op: 'discard', destination: 'discardPile' }),
  act({ actor: 'A', type: 'discard', owner: 'A', target: 'ae1', op: 'discard', destination: 'discardPile' }),
];
/** With more than one Benched Pokémon twinleaf asks the bench pick first, then the discards. */
const sniping = (target: string): NeutralAction[] =>
  [strike[0], act({ actor: 'A', type: 'choose', target }), strike[1], strike[2]];
const rejected = (r: ReturnType<typeof step>) => r.status === 'invalidAction' ? r : undefined;
const attackerDamage = (r: ReturnType<typeof step>) => r.state.players.A.active?.damage;

describe('TA-634: Orthworm ex Pummeling Payback reacts only to damage to itself, 2 counters per [M] on it', () => {
  it('Benched Orthworm (no Energy) not hit, Active with a Metal hit: no counters [TA-634]', () => {
    const B = player(slot(['b1'], [LATIAS], metal('b1e', 1)),
      [slot(['bb1'], [ORTH], []), slot(['bb2'], [DONDOZO], [])], 'b');
    const r = step(board(B), sniping('bb2'));
    expect(rejected(r)).toBeUndefined();
    expect(r.state.players.B.bench.map(s => s.damage)).toEqual([0, 50]);
    expect(attackerDamage(r)).toBe(0);
  });

  it('Benched Orthworm with 2 Metal hit by the bench damage: 4 counters on the attacker [TA-634]', () => {
    const B = player(slot(['b1'], [DONDOZO], []), [slot(['bb1'], [ORTH], metal('bb1e', 2))], 'b');
    const r = step(board(B), strike);
    expect(rejected(r)).toBeUndefined();
    expect(r.state.players.B.bench[0].damage).toBe(50);
    expect(attackerDamage(r)).toBe(40);
  });

  it('Benched Orthworm with 2 Metal not hit, Active with a Metal hit: no counters [TA-634]', () => {
    const B = player(slot(['b1'], [LATIAS], metal('b1e', 1)),
      [slot(['bb1'], [ORTH], metal('bb1e', 2)), slot(['bb2'], [DONDOZO], [])], 'b');
    const r = step(board(B), sniping('bb2'));
    expect(rejected(r)).toBeUndefined();
    expect(r.state.players.B.bench.map(s => s.damage)).toEqual([0, 50]);
    expect(attackerDamage(r)).toBe(0);
  });

  it('Active Orthworm with 1 Metal: 2 counters [TA-634]', () => {
    const B = player(slot(['b1'], [ORTH], metal('b1e', 1)), [slot(['bb1'], [DONDOZO], [])], 'b');
    const r = step(board(B), strike);
    expect(rejected(r)).toBeUndefined();
    expect(r.state.players.B.active?.damage).toBe(150);
    expect(attackerDamage(r)).toBe(20);
  });

  it('Active Orthworm with 2 Metal and a Psychic: 4 counters [TA-634]', () => {
    const B = player(slot(['b1'], [ORTH], [...metal('b1e', 2), { iid: 'b1p', printing: PSYCHIC }]), [slot(['bb1'], [DONDOZO], [])], 'b');
    const r = step(board(B), strike);
    expect(rejected(r)).toBeUndefined();
    expect(attackerDamage(r)).toBe(40);
  });

  it('Active Orthworm with no Metal: no counters [TA-634]', () => {
    const B = player(slot(['b1'], [ORTH], [{ iid: 'b1p', printing: PSYCHIC }]), [slot(['bb1'], [DONDOZO], [])], 'b');
    const r = step(board(B), strike);
    expect(rejected(r)).toBeUndefined();
    expect(attackerDamage(r)).toBe(0);
  });

  it('Active Orthworm Knocked Out by the attack, 1 Metal: still 2 counters [TA-634]', () => {
    const B = player(slot(['b1'], [ORTH], metal('b1e', 1), 100), [slot(['bb1'], [DONDOZO], [])], 'b');
    const r = step(board(B), strike);
    expect(rejected(r)).toBeUndefined();
    expect(attackerDamage(r)).toBe(20);
  });

  it('Active and Benched Orthworm both hit (1 and 2 Metal): 2 + 4 counters [TA-634]', () => {
    const B = player(slot(['b1'], [ORTH], metal('b1e', 1)), [slot(['bb1'], [ORTH], metal('bb1e', 2))], 'b');
    const r = step(board(B), strike);
    expect(rejected(r)).toBeUndefined();
    expect(attackerDamage(r)).toBe(60);
  });

  it('scr-110 (the base printing) is served and reacts the same: 2 counters [TA-634]', () => {
    const B = player(slot(['b1'], [ORTH_BASE], metal('b1e', 1)), [slot(['bb1'], [DONDOZO], [])], 'b');
    const r = step(board(B), strike);
    expect(rejected(r)).toBeUndefined();
    expect(attackerDamage(r)).toBe(20);
  });
});
