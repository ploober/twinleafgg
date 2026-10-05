import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.80 / CF-91 (contract 0.12.0): a card a player has lifted out of a zone is in `transit`, with `origin`,
 * `visibility` and (when known) `destination`; `resolving` is the played Trainer alone.
 *
 * Tyme `ssp-190` is the in-pool card that puts a card outside the standard zones and then waits for a
 * decision while it is there: "Tell your opponent the name of a Pokémon in your hand and put that Pokémon
 * face down in front of you. Your opponent guesses that Pokémon's HP, and then you reveal it. ... Then,
 * return the Pokémon to your hand." At the guess:
 *   - `resolving` holds Tyme itself (played from the hand, going to the discard, #916);
 *   - `transit` holds the named Pokémon: lifted from the hand, going back to the hand, known to its owner
 *     and not to the opponent until the reveal (`visibility: owner`).
 * The reveal during the opponent's guess reports `from: transit` (B.34 amended): that is where the card was.
 *
 * Mutation guard: drop the `CardList.transit.set(...)` line in tyme.ts and the Pokémon's transit entry loses
 * its origin/visibility/destination (the second cell reds).
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
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n).map(c => ({ ...c, faceUp: false }));
}

function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: basic('a1'),
        hand: [{ iid: 'tyme', printing: TYME }, { iid: 'ah-poke', printing: BELLSPROUT }],
        deck: cards('ad', 6), prizes: prizes('ap', 3),
      }),
      B: player({ active: basic('b1'), deck: cards('bd', 6), prizes: prizes('bp', 3) }),
    },
  };
}

const PLAY = { actor: 'A', type: 'playSupporter', card: 'tyme' } as never;

describe('B.80 transit zone (Tyme ssp-190)', () => {
  it('the played Tyme is in resolving, and only Tyme', () => {
    const res = step(board(), [PLAY]);
    expect(res.pending?.actor).toBe('B');
    expect(res.state.players.A.resolving).toEqual([{ iid: 'tyme', printing: TYME }]);
  });

  it('the named Pokémon is in transit: hand -> hand, visible to its owner only, while the opponent guesses', () => {
    const res = step(board(), [PLAY]);
    expect(res.state.players.A.transit).toEqual(
      [{ iid: 'ah-poke', printing: BELLSPROUT, origin: 'hand', destination: 'hand', visibility: 'owner' }]);
    expect(res.state.players.A.hand.map(c => c.iid)).not.toContain('ah-poke');
  });

  it('the reveal during the guess is from transit; afterwards nothing is in transit and the Pokémon is back in the hand', () => {
    const res = step(board(), [PLAY, { actor: 'B', type: 'selectOption', label: '60' } as never]);
    const reveal = res.events.find(e => e.kind === 'reveal') as { from?: string; cards?: string[] } | undefined;
    expect(reveal?.from).toBe('transit');
    expect(reveal?.cards).toEqual(['ah-poke']);
    expect(res.state.players.A.transit).toEqual([]);
    expect(res.state.players.A.resolving).toEqual([]);
    expect(res.state.players.A.hand.map(c => c.iid)).toContain('ah-poke');
    expect(res.state.players.B.hand.length).toBe(4); // the right guess: the opponent draws 4
  });

  it('a quiescent board projects an empty transit for both players', () => {
    const res = step(board(), []);
    expect(res.state.players.A.transit).toEqual([]);
    expect(res.state.players.B.transit).toEqual([]);
  });
});

/**
 * B.80 on the two pick shapes the fix-ups project (mutation guards for choose-cards.fixupProjection):
 *   - a SEARCH pick (Burning Charge pre-014, "search your deck for up to 2 Basic Energy cards and attach them
 *     to 1 of your Pokémon") lifts the card out of the deck into transit (`origin: deck`, `visibility: owner`,
 *     no destination: the recipient is still to be chosen) — drop `liftToTransit` and the first cell reds;
 *   - a COST DISCARD pick (Ultra Ball meg-131, "you can use this card only if you discard 2 other cards") is
 *     in the discard pile at once (#916) — drop `placeInDiscard` and the second cell reds.
 */
describe('B.80 transit: search picks lift, discard picks place', () => {
  const FIRE = 'sve-002';
  const CARNELIAN = 'pre-074';   // the Basic under pre-014
  const BURNING = 'pre-014';
  const ULTRA_BALL = 'meg-131';

  function attackerBoard(): NeutralState {
    return {
      schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B',
      phase: 'main', outcome: 'ongoing', stadium: null,
      players: {
        A: player({
          active: { stack: [{ iid: 'a1s0', printing: CARNELIAN }, { iid: 'a1s1', printing: BURNING }],
            energy: [{ iid: 'ae0', printing: FIRE }, { iid: 'ae1', printing: GRASS }], tools: [], damage: 0, conditions: [], markers: markers() },
          bench: [basic('ab1')],
          deck: Array.from({ length: 6 }, (_, i) => ({ iid: `ad${i}`, printing: FIRE })), prizes: prizes('ap', 3),
        }),
        B: player({ active: basic('b1'), deck: cards('bd', 6), prizes: prizes('bp', 3) }),
      },
    };
  }
  const ATTACK = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Burning Charge' } as never;

  it('after the first search pick the Energy is in transit (deck -> ?, owner), out of the deck', () => {
    const res = step(attackerBoard(), [ATTACK, { actor: 'A', type: 'choose', target: 'ad1' } as never]);
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.A.transit).toEqual([{ iid: 'ad1', printing: FIRE, origin: 'deck', visibility: 'owner' }]);
    expect(res.state.players.A.deck.map(c => c.iid)).not.toContain('ad1');
    expect(res.state.players.A.deck.length).toBe(5);
    // control: before the pick nothing is in transit
    expect(step(attackerBoard(), [ATTACK]).state.players.A.transit).toEqual([]);
  });

  it('after both picks and the recipient pick the Energy is attached and transit is empty', () => {
    const res = step(attackerBoard(), [ATTACK,
      { actor: 'A', type: 'choose', target: 'ad1' } as never, { actor: 'A', type: 'choose', target: 'ad2' } as never,
      { actor: 'A', type: 'choose', target: 'a1s0' } as never]);
    expect(res.state.players.A.transit).toEqual([]);
    expect(res.state.players.A.active!.energy.map(c => c.iid)).toContain('ad1');
    expect(res.state.players.A.active!.energy.map(c => c.iid)).toContain('ad2');
  });

  function ultraBallBoard(): NeutralState {
    return {
      schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B',
      phase: 'main', outcome: 'ongoing', stadium: null,
      players: {
        A: player({
          active: basic('a1'),
          hand: [{ iid: 'ub', printing: ULTRA_BALL }, { iid: 'h1', printing: GRASS }, { iid: 'h2', printing: GRASS }, { iid: 'h3', printing: GRASS }],
          deck: [{ iid: 'dp', printing: BELLSPROUT }, ...cards('ad', 5)], prizes: prizes('ap', 3),
        }),
        B: player({ active: basic('b1'), deck: cards('bd', 6), prizes: prizes('bp', 3) }),
      },
    };
  }

  it('after the first cost discard pick the card is in the discard pile at once (#916), not in the hand or transit', () => {
    const res = step(ultraBallBoard(), [{ actor: 'A', type: 'playItem', card: 'ub' } as never,
      { actor: 'A', type: 'discard', owner: 'A', target: 'h1' } as never]);
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.A.discard.map(c => c.iid)).toContain('h1');
    expect(res.state.players.A.hand.map(c => c.iid)).not.toContain('h1');
    expect(res.state.players.A.transit).toEqual([]);
    expect(res.state.players.A.resolving).toEqual([{ iid: 'ub', printing: ULTRA_BALL }]);
  });
});
