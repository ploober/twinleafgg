import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-712 / #916 / B.80: a played Supporter stays on the playing field (`resolving`) until it has resolved, through its
 * own "Then, shuffle your deck." (TA-378's shape, for the Items). Cyrano ssp-170 and Clavell pal-177 discarded themselves
 * before the shuffle, so the pause at the shuffle showed the card in the discard pile. Rotomancer (34f26e6fb): resolving.
 *
 * TA-714: Clavell ("Search your deck for up to 3 Basic Pokémon with 120 HP or less") built the HP filter and never
 * passed it to the pick, so a Basic Pokémon with more HP could be taken.
 */

const CYRANO = 'ssp-170';
const CLAVELL = 'pal-177';
const GRASS = 'sve-001';
const SMALL = 'asc-004';   // a Basic Pokémon with 120 HP or less
const LATIAS = 'meg-181';  // Mega Latias ex: a Basic Pokémon ex with 280 HP

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
const board = (supporter: string, deck: CardRef[]): NeutralState => ({
  schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
  players: {
    A: player({ active: mon('a1', SMALL), hand: [{ iid: 'ah0', printing: supporter }], deck, prizes: prizes('ap', 6) }),
    B: player({ active: mon('b1', SMALL), deck: cards('bd', 6, GRASS), prizes: prizes('bp', 6) }),
  },
});
const play = { actor: 'A', type: 'playSupporter', card: 'ah0' } as never;
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as never);
const stop = { actor: 'A', type: 'confirm', value: false } as never;
const resolving = (s: NeutralState) => (s.players.A.resolving ?? []).map(c => c.iid);
const discard = (s: NeutralState) => s.players.A.discard.map(c => c.iid);

for (const [name, printing] of [['Cyrano', CYRANO], ['Clavell', CLAVELL]] as const) {
  describe(`TA-712 / #916: ${name} (${printing}) stays on the field through its own shuffle`, () => {
    const deck = [{ iid: 'ax0', printing: LATIAS }, { iid: 'as0', printing: SMALL }, ...cards('ag', 4, GRASS)];

    it(`nothing taken: at the shuffle pause ${name} is resolving, not in the discard pile [TA-712 ${printing}]`, () => {
      const r = step(board(printing, deck), [play, stop]);
      expect(r.pending?.actor).toBe('system');
      expect(resolving(r.state)).toEqual(['ah0']);
      expect(discard(r.state)).not.toContain('ah0');
    });

    it(`one card taken: ${name} is still resolving at the shuffle pause [TA-712 ${printing}]`, () => {
      const target = printing === CYRANO ? 'ax0' : 'as0';
      // The only eligible card: taking it ends the pick (nothing is left to choose), so there is no stop.
      const r = step(board(printing, deck), [play, choose(target)]);
      expect(r.state.players.A.hand.map(c => c.iid)).toContain(target);
      expect(r.pending?.actor).toBe('system');
      expect(resolving(r.state)).toEqual(['ah0']);
      expect(discard(r.state)).not.toContain('ah0');
    });

    it(`after the shuffle ${name} is in the discard pile [TA-712 ${printing}]`, () => {
      const shuffle = { actor: 'system', type: 'shuffle', order: deck.map(c => c.iid) } as never;
      const r = step(board(printing, deck), [play, stop, shuffle]);
      expect(r.applied).toBe(3);
      expect(resolving(r.state)).toEqual([]);
      expect(discard(r.state)).toEqual(['ah0']);
    });
  });
}

describe('TA-714: Clavell (pal-177) offers only Basic Pokémon with 120 HP or less', () => {
  it('a 280 HP Basic Pokémon ex is not offered; a 120-HP-or-less Basic is [TA-714 pal-177]', () => {
    const r = step(board(CLAVELL, [{ iid: 'ax0', printing: LATIAS }, { iid: 'as0', printing: SMALL }, ...cards('ag', 4, GRASS)]), [play]);
    const offered = (r.pending?.legalActions ?? []).filter(a => a.type === 'choose').map(a => (a as { target: string }).target);
    expect(offered).toEqual(['as0']);
  });
});
