import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-741: Legacy Energy twm-167: "If the Pokémon this card is attached to is Knocked Out by damage from an attack from
 * your opponent's Pokémon, that player takes 1 fewer Prize card." twinleaf applied it to ANY Knock Out during the
 * opponent's attack, so Yveltal shf-046 Amazing Destruction ("Your opponent's Active Pokémon is Knocked Out.", no
 * damage) gave 0 Prizes. Found by bug report 1555309651447250944. The control is a Knock Out by attack damage (Ice Wing
 * for 20 on a 110-HP Articuno with 100 damage): Legacy applies there, 0 Prizes.
 */

const LEGACY = 'twm-167';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function mon(iid: string, printing: string, energy: string[], damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: energy.map((p, i) => ({ iid: `${iid}e${i}`, printing: p })), tools: [], damage, conditions: [], markers: markers() };
}
function player(tag: string, active: PokemonInPlay, bench: PokemonInPlay[]): PlayerState {
  const deck: CardRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: 'sve-003' }));
  const prizes: PrizeRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: 'sve-003', faceUp: false }));
  return { active, bench, hand: [], deck, discard: [], lostZone: [], prizes, flags: flags() };
}
function board(attacker: PokemonInPlay, bDamage: number): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player('A', attacker, []),
      B: player('B', mon('b0', 'sit-036', [LEGACY], bDamage), [mon('b1', 'pal-090', [])]),
    },
  } as NeutralState;
}

describe('TA-741 Legacy Energy applies only to a Knock Out by attack damage', () => {
  it('[TA-741 twm-167] Amazing Destruction (a Knock Out with no damage): A takes 1 Prize', () => {
    const yveltal = mon('a0', 'shf-046', ['sve-002', 'sve-005', 'sve-007', 'sve-003', 'sve-003']);
    const r = step(board(yveltal, 0), [{ actor: 'A', type: 'declareAttack', source: 'a0', name: 'Amazing Destruction' } as never]);
    expect(r.state.players.B.discard.map(c => c.iid)).toContain('b0');
    expect(r.pending?.actor).toBe('A');
    expect(r.pending?.descriptor).toMatch(/prize/i);
  });
  it('[TA-741 twm-167 control] Ice Wing Knocks Out by damage: Legacy applies, A takes no Prize', () => {
    const articuno = mon('a0', 'sit-036', ['sve-003']);
    const r = step(board(articuno, 100), [{ actor: 'A', type: 'declareAttack', source: 'a0', name: 'Ice Wing' } as never]);
    expect(r.state.players.B.discard.map(c => c.iid)).toContain('b0');
    expect(r.pending?.descriptor ?? '').not.toMatch(/prize/i);
    expect(r.state.players.A.prizes.length).toBe(6);
  });
});
