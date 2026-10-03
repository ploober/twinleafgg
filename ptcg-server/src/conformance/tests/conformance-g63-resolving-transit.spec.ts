import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * G-63 / B.68(4) (contract 0.11.0): every `resolving` entry carries `origin`, `destination` and `face`.
 *
 * Tyme `ssp-190` is the in-pool card that puts a card outside the standard zones and then waits for a
 * decision while it is there: "Tell your opponent the name of a Pokémon in your hand and put that Pokémon
 * face down in front of you. Your opponent guesses that Pokémon's HP, and then you reveal it. ... Then,
 * return the Pokémon to your hand." At the guess, `resolving` holds two cards:
 *   - Tyme itself, played from the hand, going to the discard, face up (#916/#919);
 *   - the named Pokémon, out of the hand, going back to the hand, face DOWN until the reveal.
 *
 * Mutation guard: drop the `CardList.transit.set(...)` line in tyme.ts and the Pokémon's entry loses its
 * three fields (the second cell reds); drop PLAYED_TRAINER_TRANSIT in state-adapter.ts and the first does.
 */

const TYME = 'ssp-190';
const BELLSPROUT = 'asc-004'; // printed HP 60
const GRASS = 'sve-001';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function basic(iid: string): PokemonInPlay {
  return { stack: [{ iid, printing: BELLSPROUT }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: GRASS }));
}

function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: basic('a1'),
        hand: [{ iid: 'tyme', printing: TYME }, { iid: 'ah-poke', printing: BELLSPROUT }],
        deck: cards('ad', 6), prizes: cards('ap', 3),
      }),
      B: player({ active: basic('b1'), deck: cards('bd', 6), prizes: cards('bp', 3) }),
    },
  };
}

const PLAY = { actor: 'A', type: 'playSupporter', card: 'tyme' } as never;

describe('G-63 resolving transit fields (Tyme ssp-190)', () => {
  it('the played Tyme is hand -> discardPile, face up', () => {
    const res = step(board(), [PLAY]);
    expect(res.pending?.actor).toBe('B');
    expect(res.state.players.A.resolving).toContain(
      { iid: 'tyme', printing: TYME, origin: 'hand', destination: 'discardPile', face: 'up' });
  });

  it('the named Pokémon is hand -> hand, face down, while the opponent guesses', () => {
    const res = step(board(), [PLAY]);
    expect(res.state.players.A.resolving).toContain(
      { iid: 'ah-poke', printing: BELLSPROUT, origin: 'hand', destination: 'hand', face: 'down' });
    expect(res.state.players.A.hand.map(c => c.iid)).not.toContain('ah-poke');
  });

  it('after the guess nothing is in transit and the Pokémon is back in the hand', () => {
    const res = step(board(), [PLAY, { actor: 'B', type: 'selectOption', label: '60' } as never]);
    expect(res.state.players.A.resolving).toEqual([]);
    expect(res.state.players.A.hand.map(c => c.iid)).toContain('ah-poke');
    expect(res.state.players.B.hand.length).toBe(4); // the right guess: the opponent draws 4
  });
});
