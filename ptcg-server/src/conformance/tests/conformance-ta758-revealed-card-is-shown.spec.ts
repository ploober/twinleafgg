import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-758 — two attacks whose text reveals a card never showed it, so no `reveal` reached the wire and the card moved
 * `owner`:
 *  - Colorful Friends mew-133 (Eevee): "Search your deck for up to 3 Pokémon of different types, reveal them, and put
 *    them into your hand. Then, shuffle your deck." (TA-691's Colorful Catch shape: the picks are shown before the move.)
 *  - Paw-cket Pilfer dri-149 / asc-161 / dri-203 (Team Rocket's Meowth): "Choose a random card from your opponent's
 *    hand. Your opponent reveals that card and shuffles it into their deck."
 * Mutation guard: drop the SHOW_CARDS_TO_PLAYER in either script -> its cells see no reveal and an `owner` leg.
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;
type Reveal = { kind: 'reveal'; owner: string; cards: string[]; from: string; to: string };

const METAL = 'sve-008', WATER = 'sve-003';
const BELLSPROUT = 'asc-004', GOTHITA = 'pal-090';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string, from = 1): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i + from}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, METAL).map(c => ({ ...c, faceUp: false }));
}
function game(attacker: PokemonInPlay, deck: CardRef[]): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: attacker, hand: [{ iid: 'ah1', printing: METAL }], deck, prizes: prizes('ap', 6) }),
      B: player({ active: mon('b1', BELLSPROUT), deck: cards('bd', 6, METAL), prizes: prizes('bp', 6) }),
    },
  };
}
const moved = (events: NeutralEvent[]) => events.filter((e): e is Moved => e.kind === 'moved');
const reveals = (events: NeutralEvent[]) => events.filter(e => e.kind === 'reveal') as unknown as Reveal[];
const legs = (events: NeutralEvent[], iid: string) =>
  moved(events).filter(e => e.card === iid).map(e => `${e.origin.zone}>${e.destination.zone}:${e.visibility}`);
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as never);
const stop = { actor: 'A', type: 'confirm', value: false } as never;

describe('TA-758: Colorful Friends (Eevee mew-133) reveals the Pokémon it finds', () => {
  const attack = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Colorful Friends' } as never;
  const eevee = () => mon('a1', 'mew-133', [{ iid: 'ae1', printing: METAL }]);
  const deck = () => [{ iid: 'ad1', printing: BELLSPROUT }, { iid: 'ad2', printing: GOTHITA }, ...cards('ad', 4, WATER, 3)];

  it('one pick then stop: the Pokémon is revealed and goes to the hand public [TA-758 mew-133]', () => {
    const r = step(game(eevee(), deck()), [attack, choose('ad1'), stop]);
    expect(r.status).not.toBe('invalidAction');
    const rv = reveals(r.events);
    expect(rv.length).toBe(1);
    expect(rv[0].owner).toBe('A');
    expect(rv[0].cards).toEqual(['ad1']);
    expect(legs(r.events, 'ad1').pop()).toBe(`${legs(r.events, 'ad1').length > 1 ? 'transit' : 'deck'}>hand:public`);
    expect(r.state.players.A.hand.map(c => c.iid)).toContain('ad1');
  });
  it('two picks: both revealed, both legs into the hand public [TA-758 mew-133 two]', () => {
    const r = step(game(eevee(), deck()), [attack, choose('ad1'), choose('ad2')]);
    expect(r.status).not.toBe('invalidAction');
    expect(reveals(r.events).flatMap(e => e.cards).sort()).toEqual(['ad1', 'ad2']);
    for (const iid of ['ad1', 'ad2']) { expect(legs(r.events, iid).pop()).toMatch(/>hand:public$/); }
  });
  it('control: no pick reveals nothing [TA-758 mew-133 control]', () => {
    const r = step(game(eevee(), deck()), [attack, stop]);
    expect(reveals(r.events)).toEqual([]);
  });
});

describe('TA-758: Paw-cket Pilfer (Team Rocket\'s Meowth) has the opponent reveal the card before it goes into the deck', () => {
  const attack = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Paw-cket Pilfer' } as never;
  for (const printing of ['dri-149', 'asc-161', 'dri-203']) {
    it(`B's one hand card: revealed by B, hand > deck public [TA-758 ${printing}]`, () => {
      const s = game(mon('a1', printing, [{ iid: 'ae1', printing: METAL }]), cards('ad', 6, WATER));
      s.players.B.hand = [{ iid: 'bh1', printing: WATER }];
      const r = step(s, [attack]);
      expect(r.status).not.toBe('invalidAction');
      const rv = reveals(r.events);
      expect(rv.map(e => [e.owner, e.cards])).toEqual([['B', ['bh1']]]);
      expect(legs(r.events, 'bh1')[0]).toMatch(/^hand>.*:public$/);
      expect(r.state.players.B.hand).toEqual([]);
      expect(r.state.players.B.deck.map(c => c.iid)).toContain('bh1');
    });
  }
});
