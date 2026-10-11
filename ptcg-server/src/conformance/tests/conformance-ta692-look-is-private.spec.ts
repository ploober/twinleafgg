import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-692 / B.97 / CF-18: a "Look at the top N cards of your deck" is a PRIVATE look: it emits no `reveal` and the lifted
 * cards' legs are `owner`. Only the cards the player then chooses to reveal are revealed.
 *
 *  - Tropius pbl-001 Fruity Aroma: "Look at the top 6 cards of your deck, and you may reveal any number of Pokémon you
 *    find there and put them into your hand. Shuffle the other cards back into your deck." tropius.ts showed the whole
 *    looked-at pile to BOTH players before the pick, so the adapter published the look as a reveal (with the wrong
 *    owner, B, for A's own cards) and the six lift legs read `public`.
 *  - Mega Delphox ex pbl-008 Trick Portal: "Look at the top 9 cards of your deck, and you may put any number of Pokémon
 *    you find there onto your Bench. Shuffle the other cards back into your deck." The same show-to-self of the look.
 *
 * Rotomancer (:8099 17fa5070a, 2026-10-11, Fruity Aroma with Pokémon at ad1 and ad3): six `deck > transit` legs
 * `owner`, no reveal at the pick pause; after the picks one `reveal A from transit [ad1, ad3]`, `transit > hand`
 * `public` for the chosen, `transit > deck:any` `owner` for the rest.
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;
type Reveal = { kind: 'reveal'; owner: string; cards: string[]; from: string; to: string };

const FIRE = 'sve-002';
const METAL = 'sve-008';
const TROPIUS = 'pbl-001';
const DELPHOX = 'pbl-008';
const BELLSPROUT = 'asc-004';
const VENUSAUR_EX = 'mew-003'; // a Stage 2: a Pokémon for Fruity Aroma, not a Basic for Trick Portal

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
/** A deck of 12 Fire Energy with the given Pokémon at the given positions (1-based). */
const deckWithPokemonAt = (positions: number[], printing: string) =>
  cards('ad', 12, FIRE).map((c, i) => positions.includes(i + 1) ? { ...c, printing } : c);

describe('TA-692 / B.97: Fruity Aroma (Tropius pbl-001) looks privately and reveals only the chosen Pokémon', () => {
  const attack = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Fruity Aroma' } as never;
  const tropius = () => mon('a1', TROPIUS, [{ iid: 'ae1', printing: METAL }]);

  it('no Pokémon in the top six: nothing is revealed; the six are lifted owner and shuffled back [TA-692 pbl-001]', () => {
    const r = step(game(tropius(), cards('ad', 12, FIRE)), [attack]);
    expect(reveals(r.events)).toEqual([]);
    for (let i = 1; i <= 6; i++) {
      expect(legs(r.events, `ad${i}`)).toEqual(['deck>transit:owner', 'transit>deck:owner']);
    }
  });

  it('Pokémon in the look: at the pick pause nothing is revealed and the lifts are owner [TA-692 pbl-001]', () => {
    const r = step(game(tropius(), deckWithPokemonAt([1, 3], VENUSAUR_EX)), [attack]);
    expect(r.pending?.actor).toBe('A');
    expect(reveals(r.events)).toEqual([]);
    for (let i = 1; i <= 6; i++) {
      expect(legs(r.events, `ad${i}`)).toEqual(['deck>transit:owner']);
    }
  });

  it('the chosen Pokémon alone are revealed, from transit, and go to the hand public; the rest return owner [TA-692 pbl-001]', () => {
    const r = step(game(tropius(), deckWithPokemonAt([1, 3], VENUSAUR_EX)), [attack, choose('ad1'), choose('ad3')]);
    expect(reveals(r.events).map(e => [e.owner, e.from, e.cards, e.to])).toEqual([['A', 'transit', ['ad1', 'ad3'], 'all']]);
    expect(legs(r.events, 'ad1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
    expect(legs(r.events, 'ad3')).toEqual(['deck>transit:owner', 'transit>hand:public']);
    expect(legs(r.events, 'ad2')).toEqual(['deck>transit:owner', 'transit>deck:owner']);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ah1', 'ad1', 'ad3']);
  });
});

describe('TA-692 / B.97: Trick Portal (Mega Delphox ex pbl-008) looks privately', () => {
  const attack = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Trick Portal' } as never;
  const delphox = () => mon('a1', DELPHOX, [{ iid: 'ae1', printing: FIRE }]);

  // Control (green before the fix): with no pick the engine returns the nine in the attack's own dispatch, before the
  // adapter sees the show; the defect needs the pick pause below.
  it('control: no Basic Pokémon in the top nine: nothing is revealed; the nine are lifted owner and shuffled back [TA-692 pbl-008]', () => {
    const r = step(game(delphox(), cards('ad', 12, FIRE)), [attack]);
    expect(reveals(r.events)).toEqual([]);
    for (let i = 1; i <= 9; i++) {
      expect(legs(r.events, `ad${i}`)).toEqual(['deck>transit:owner', 'transit>deck:owner']);
    }
  });

  it('Basic Pokémon in the look: at the pick pause nothing is revealed and the lifts are owner [TA-692 pbl-008]', () => {
    const r = step(game(delphox(), deckWithPokemonAt([2, 5], BELLSPROUT)), [attack]);
    expect(r.pending?.actor).toBe('A');
    expect(reveals(r.events)).toEqual([]);
    for (let i = 1; i <= 9; i++) {
      expect(legs(r.events, `ad${i}`)).toEqual(['deck>transit:owner']);
    }
  });
});
