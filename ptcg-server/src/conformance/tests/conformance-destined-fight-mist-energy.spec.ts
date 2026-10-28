import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Compendium #2427 (TPCi Rules Team 2026-07-16): "What happens if I use Annihilape's 'Destined Fight' to attack a Pokemon
 * with Mist Energy attached? — Annihilape is KO'd and the opponent takes a prize, but Mist Energy prevents the Defending
 * Pokemon from being KO'd." Annihilape ssp-100 Destined Fight: "Both Active Pokémon are Knocked Out." Mist Energy tef-161:
 * "Prevent all effects of attacks from your opponent's Pokémon done to the Pokémon this card is attached to."
 */

const GRASS = 'sve-001', FIGHTING = 'sve-006', COLORLESS_ANY = 'sve-002';
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage: 0,
    conditions: [], markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false } };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function side(tag: string, active: PokemonInPlay, bench: PokemonInPlay[]): PlayerState {
  return { active, bench, hand: [], deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS })),
    discard: [], lostZone: [], prizes: prizes(tag), flags: flags() };
}
function board(bEnergy: string[]): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main',
    outcome: 'ongoing', stadium: null,
    players: { A: side('a', mon('a1', 'ssp-100', [FIGHTING, COLORLESS_ANY]), [mon('a2', 'asc-004')]),
      B: side('b', mon('b1', 'asc-148', bEnergy), [mon('b2', 'asc-004')]) } };
}
const destined = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Destined Fight' } as unknown as NeutralAction;

describe('Destined Fight against Mist Energy (#2427)', () => {
  it('Annihilape is Knocked Out, the Mist Energy defender stays [TA-796 ssp-100 mist]', () => {
    const r = step(board(['tef-161']), [destined]);
    expect(r.state.players.B.active?.stack[0].iid).toBe('b1');
    expect(r.state.players.A.active).toBeNull();
    expect(r.pending?.actor).toBe('B');
  });
  it('control: without Mist Energy both Actives are Knocked Out [TA-796 ssp-100 plain]', () => {
    const r = step(board([GRASS]), [destined]);
    expect(r.state.players.B.active).toBeNull();
    expect(r.state.players.A.active).toBeNull();
  });
});
