import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-691 / B.97: "Search your deck for ..., reveal them, and put them into your hand" emits a `reveal` of the picked
 * cards (the Gimmighoul ssp-097 shape, TA-542 / TA-582 / TA-590). The card files moved the picks with no ShowCardsPrompt,
 * so no reveal reached the wire and the deck > hand legs read `owner`.
 *
 *  - Eevee sfa-050 Colorful Catch: "Search your deck for up to 3 Basic Energy cards of different types, reveal them, and
 *    put them into your hand. Then, shuffle your deck."
 *  - Charcadet pfl-019 / mep-022 Gather Strength: "Search your deck for up to 2 Basic Energy cards, reveal them, and put
 *    them into your hand. Then, shuffle your deck."
 *  - Larry's Starly asc-168 Minor Errand-Running: "Search your deck for up to 2 Basic Energy cards, reveal them, and put
 *    them into your hand. Then, shuffle your deck."
 *
 * Rotomancer (:8099 17fa5070a, 2026-10-11): a search completed by its only pick reveals `from: deck` and moves
 * `deck > hand` `public`; a search completed at a later pick reveals the pile `from: transit` and the legs are
 * `public` (TA-590's shape).
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;
type Reveal = { kind: 'reveal'; owner: string; cards: string[]; from: string; to: string };

const FIRE = 'sve-002';
const WATER = 'sve-003';
const METAL = 'sve-008';
const EEVEE = 'sfa-050';
const CHARCADET = 'pfl-019';
const CHARCADET_MEP = 'mep-022';
const STARLY = 'asc-168';
const BELLSPROUT = 'asc-004';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
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

describe('TA-691 / B.97: Colorful Catch (Eevee sfa-050) reveals the Energy it finds', () => {
  const attack = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Colorful Catch' } as never;
  const eevee = () => mon('a1', EEVEE, [{ iid: 'ae1', printing: METAL }]);

  it('one Basic Energy type in the deck: the single pick completes the search; revealed from deck, deck > hand public [TA-691 sfa-050]', () => {
    const r = step(game(eevee(), cards('ad', 8, FIRE)), [attack, choose('ad1')]);
    expect(reveals(r.events).map(e => [e.owner, e.from, e.cards, e.to])).toEqual([['A', 'deck', ['ad1'], 'all']]);
    expect(legs(r.events, 'ad1')).toEqual(['deck>hand:public']);
    expect(r.state.players.A.hand.map(c => c.iid)).toContain('ad1');
  });

  it('two types: both picks are revealed as one pile from transit; the legs are public [TA-691 sfa-050]', () => {
    const r = step(game(eevee(), [...cards('ad', 3, FIRE), ...cards('ad', 3, WATER, 4)]), [attack, choose('ad1'), choose('ad4')]);
    expect(reveals(r.events).map(e => [e.owner, e.from, e.cards])).toEqual([['A', 'transit', ['ad1', 'ad4']]]);
    expect(legs(r.events, 'ad1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
    expect(legs(r.events, 'ad4')).toEqual(['deck>hand:public']);
  });

  it('control: no pick reveals nothing [TA-691 sfa-050]', () => {
    const r = step(game(eevee(), cards('ad', 8, FIRE)), [attack, stop]);
    expect(reveals(r.events)).toEqual([]);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ah1']);
  });
});

describe('TA-691 / B.97: Gather Strength (Charcadet pfl-019 / mep-022) reveals the Energy it finds', () => {
  const attack = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Gather Strength' } as never;

  for (const printing of [CHARCADET, CHARCADET_MEP]) {
    it(`two picks: revealed as one pile from transit; the legs are public [TA-691 ${printing}]`, () => {
      const r = step(game(mon('a1', printing, [{ iid: 'ae1', printing: FIRE }]), cards('ad', 8, FIRE)), [attack, choose('ad1'), choose('ad2')]);
      expect(reveals(r.events).map(e => [e.owner, e.from, e.cards])).toEqual([['A', 'transit', ['ad1', 'ad2']]]);
      expect(legs(r.events, 'ad1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
      expect(legs(r.events, 'ad2')).toEqual(['deck>hand:public']);
    });
  }

  it('one pick then stop: revealed from transit, transit > hand public [TA-691 pfl-019]', () => {
    const r = step(game(mon('a1', CHARCADET, [{ iid: 'ae1', printing: FIRE }]), cards('ad', 8, FIRE)), [attack, choose('ad1'), stop]);
    expect(reveals(r.events).map(e => [e.owner, e.from, e.cards])).toEqual([['A', 'transit', ['ad1']]]);
    expect(legs(r.events, 'ad1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
  });

  it('control: no pick reveals nothing [TA-691 pfl-019]', () => {
    expect(reveals(step(game(mon('a1', CHARCADET, [{ iid: 'ae1', printing: FIRE }]), cards('ad', 8, FIRE)), [attack, stop]).events)).toEqual([]);
  });
});

describe('TA-691 / B.97: Minor Errand-Running (Larry\'s Starly asc-168) reveals the Energy it finds', () => {
  const attack = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Minor Errand-Running' } as never;
  const starly = () => mon('a1', STARLY, [{ iid: 'ae1', printing: METAL }]);

  it('two picks: revealed as one pile from transit; the legs are public [TA-691 asc-168]', () => {
    const r = step(game(starly(), cards('ad', 8, FIRE)), [attack, choose('ad1'), choose('ad2')]);
    expect(reveals(r.events).map(e => [e.owner, e.from, e.cards])).toEqual([['A', 'transit', ['ad1', 'ad2']]]);
    expect(legs(r.events, 'ad1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
    expect(legs(r.events, 'ad2')).toEqual(['deck>hand:public']);
  });

  it('control: no pick reveals nothing [TA-691 asc-168]', () => {
    expect(reveals(step(game(starly(), cards('ad', 8, FIRE)), [attack, stop]).events)).toEqual([]);
  });
});
