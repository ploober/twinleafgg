import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Compendium #2426 (TPCi Rules Team 2026-07-16): "Hide 'n' Sneak takes precedence over Midnight Fluttering. It doesn't
 * matter which one comes into play first. Hide 'n' Sneak keeps working." Poltchageist pbl-005 Hide 'n' Sneak: "Prevent
 * all effects of your opponent's Pokémon's attacks and Abilities done to this Pokémon." Flutter Mane pre-043 Midnight
 * Fluttering: "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities". The lock
 * is itself an effect of an opponent's Ability done to Poltchageist, so Hide 'n' Sneak prevents it. Probe: Dusclops
 * pre-036 Cursed Blast ("put 5 damage counters on 1 of your opponent's Pokémon") aimed at the Active Poltchageist.
 */

const GRASS = 'sve-001';
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false } };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function side(tag: string, active: PokemonInPlay, bench: PokemonInPlay[]): PlayerState {
  return { active, bench, hand: [], deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS })),
    discard: [], lostZone: [], prizes: prizes(tag), flags: flags() };
}
function board(aActive: string, bActive: string): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main',
    outcome: 'ongoing', stadium: null,
    players: { A: side('a', mon('a1', aActive), [mon('a2', 'pre-036')]), B: side('b', mon('b1', bActive), [mon('b2', 'asc-004')]) } };
}
const act = (a: object) => a as unknown as NeutralAction;
const blast = act({ actor: 'A', type: 'useAbility', source: 'a2', ability: 'Cursed Blast' });
function blastAt(b: NeutralState, target: string) {
  const r0 = step(b, [blast]);
  const pick = (r0.pending?.legalActions ?? []).find(a => (a as { target?: string }).target === target);
  expect(pick).toBeDefined();
  return step(b, [blast, pick as NeutralAction]);
}

describe('Hide \'n\' Sneak takes precedence over Midnight Fluttering (#2426)', () => {
  it('Flutter Mane Active: Cursed Blast on the Active Poltchageist places no counters [TA-795 pbl-005 fluttering]', () => {
    const r = blastAt(board('pre-043', 'pbl-005'), 'b1');
    expect(r.state.players.B.active?.stack[0].iid).toBe('b1');
    expect(r.state.players.B.active?.damage).toBe(0);
  });
  it('control: no Flutter Mane, the same Cursed Blast places nothing either [TA-795 pbl-005 plain]', () => {
    const r = blastAt(board('asc-004', 'pbl-005'), 'b1');
    expect(r.state.players.B.active?.damage).toBe(0);
  });
  it('control: Flutter Mane Active, Cursed Blast on a Pokémon without Hide \'n\' Sneak places 5 counters [TA-795 pbl-005 unprotected]', () => {
    const r = blastAt(board('pre-043', 'asc-148'), 'b1');
    expect(r.state.players.B.active?.damage).toBe(50);
  });
});
