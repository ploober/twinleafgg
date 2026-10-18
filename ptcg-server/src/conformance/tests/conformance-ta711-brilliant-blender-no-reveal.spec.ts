import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-711 / B.97: Brilliant Blender ssp-164 ("Search your deck for up to 5 cards and discard them. Then, shuffle your
 * deck.") reveals nothing. A card that becomes public by moving is recorded by its `moved` leg only; the card file showed
 * the searched cards to the opponent before discarding them, so the adapter emitted a `reveal` from the deck.
 * Rotomancer (34f26e6fb): no reveal.
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;

const BLENDER = 'ssp-164';
const GRASS = 'sve-001';
const FIRE = 'sve-002';
const BASIC = 'asc-004';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, GRASS).map(c => ({ ...c, faceUp: false }));
}

describe('TA-711 / B.97: Brilliant Blender (ssp-164) discards the searched cards with no reveal', () => {
  const board = (): NeutralState => ({
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: mon('a1', BASIC), hand: [{ iid: 'ah0', printing: BLENDER }],
        deck: [...cards('ag', 3, GRASS), ...cards('af', 3, FIRE)], prizes: prizes('ap', 6) }),
      B: player({ active: mon('b1', BASIC), deck: cards('bd', 6, GRASS), prizes: prizes('bp', 6) }),
    },
  });
  const play = { actor: 'A', type: 'playItem', card: 'ah0' } as never;
  const pick = (iid: string) => ({ actor: 'A', type: 'discard', target: iid, owner: 'A', op: 'discard', destination: 'discardPile' } as never);
  const stop = { actor: 'A', type: 'confirm', value: false } as never;

  it('one card: discarded, its leg public, and no reveal [TA-711 ssp-164]', () => {
    const r = step(board(), [play, pick('ag0'), stop]);
    expect(r.events.filter(e => e.kind === 'reveal')).toEqual([]);
    expect(r.state.players.A.discard.map(c => c.iid)).toContain('ag0');
    const leg = r.events.filter((e): e is Moved => e.kind === 'moved' && e.card === 'ag0');
    expect(leg.map(e => `${e.destination.zone}:${e.visibility}`)).toEqual(['discardPile:public']);
  });

  it('two cards: both discarded, no reveal [TA-711 ssp-164]', () => {
    const r = step(board(), [play, pick('ag0'), pick('af0'), stop]);
    expect(r.events.filter(e => e.kind === 'reveal')).toEqual([]);
    expect(r.state.players.A.discard.map(c => c.iid)).toEqual(jasmine.arrayContaining(['ag0', 'af0']));
  });
});
