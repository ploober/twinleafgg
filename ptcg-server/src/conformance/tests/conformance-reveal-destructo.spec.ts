import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * CF-18 first cross-engine reveal card — Iron Thorns `tef-062` "Destructo-Press":
 *   "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find
 *    there. Then, discard the revealed Future cards and shuffle the other cards back into your deck."
 *
 * Rotomancer's declared first CF-18 emitter: `reveal{owner, cards, from:"deck", to:"all"}`, the
 * top 5 in deck-top order (top first), emitted BEFORE the damage and the discard. This repro locks
 * twinleaf to the same wire so the first reveal differential converges: exactly ONE reveal event
 * carrying ALL FIVE top cards (top-first), owner A, from `deck`, to `all` — NOT the Future-only
 * subset (the pre-fix bug under-revealed), and NOT double-emitted (the card raised two ShowCardsPrompts).
 */

const IRON_THORNS = 'tef-062';   // Basic, Future; Destructo-Press cost [L,C]
const LIGHTNING = 'sve-004';
const WATER = 'sve-003';
const TANKY = 'Wellspring Mask Ogerpon ex TWM'; // 210 HP — survives 140 so the game stays ongoing

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function en(printing: string, n: number, tag: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}e${i}`, printing }));
}
function poke(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}

describe('Conformance — CF-18 reveal: Iron Thorns "Destructo-Press" (first cross-engine emitter)', () => {
  function boardWithTop5(top5: CardRef[]): NeutralState {
    const A = player({
      active: poke('A-act', IRON_THORNS, en(LIGHTNING, 2, 'A')),
      deck: [...top5, { iid: 'A-d5', printing: WATER }, { iid: 'A-d6', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })),
    });
    const B = player({
      active: poke('B-act', TANKY),
      deck: [{ iid: 'B-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `B-pz${i}`, printing: WATER, faceUp: false })),
    });
    return { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
  }

  it('emits ONE reveal of ALL top-5 cards (top-first), owner A, from deck, to all', () => {
    // Top 5 = 2 Future (Iron Thorns) interleaved with 3 non-Future: the WHOLE 5 must be revealed.
    const top5: CardRef[] = [
      { iid: 'A-d0', printing: IRON_THORNS },
      { iid: 'A-d1', printing: WATER },
      { iid: 'A-d2', printing: IRON_THORNS },
      { iid: 'A-d3', printing: WATER },
      { iid: 'A-d4', printing: WATER },
    ];
    const res = step(boardWithTop5(top5),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Destructo-Press' }]);
    expect(res.events.filter(e => e.kind === 'reveal')).toEqual([
      { kind: 'reveal', owner: 'A', cards: ['A-d0', 'A-d1', 'A-d2', 'A-d3', 'A-d4'], from: 'deck', to: 'all' },
    ]);
  });

  it('the revealed cards are lifted and the others shuffled back: deck -> transit -> deck any, Future cards to the discard pile (B.80 / B.81) [TA-665]', () => {
    const top5: CardRef[] = [
      { iid: 'A-d0', printing: IRON_THORNS },
      { iid: 'A-d1', printing: WATER },
      { iid: 'A-d2', printing: WATER },
      { iid: 'A-d3', printing: WATER },
      { iid: 'A-d4', printing: WATER },
    ];
    const res = step(boardWithTop5(top5),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Destructo-Press' }]);
    type Leg = { card: string; origin: { zone: string }; destination: { zone: string; position?: string } };
    const legs = res.events.filter(e => e.kind === 'moved') as unknown as Leg[];
    const path = (iid: string) => legs.filter(l => l.card === iid)
      .map(l => `${l.origin.zone}>${l.destination.zone}${l.destination.position ? ':' + l.destination.position : ''}`);
    for (const iid of ['A-d1', 'A-d2', 'A-d3', 'A-d4']) {
      expect(path(iid)).toEqual(['deck>transit', 'transit>deck:any']);
    }
    expect(path('A-d0')).toEqual(['deck>discardPile']);   // a Future card: discarded, one leg
    expect(path('A-d5')).toEqual([]);   // not revealed, never lifted
  });

  it('still applies the damage (70 × Future count) through the deferred reveal callback', () => {
    // Deck = 2 Future + 1 non-Future (only 3 cards): reveal all 3 from deck, damage 70×2=140. After
    // discarding the 2 Future, exactly 1 card remains → CF-11 collapses the shuffle (no pending), so
    // the attack runs to completion and the damage lands — proving the callback-deferred moves don't
    // drop it. (B = Wellspring Ogerpon, Water, is Lightning-weak, so 140 → 280 and it's KO'd — the
    // point is the damage flows: a `damaged` + `ko` fire, i.e. the callback didn't swallow it.)
    const A = player({
      active: poke('A-act', IRON_THORNS, en(LIGHTNING, 2, 'A')),
      deck: [{ iid: 'A-d0', printing: IRON_THORNS }, { iid: 'A-d1', printing: IRON_THORNS }, { iid: 'A-d2', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })),
    });
    const B = player({
      active: poke('B-act', TANKY),
      deck: [{ iid: 'B-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `B-pz${i}`, printing: WATER, faceUp: false })),
    });
    const state: NeutralState = { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
    const res = step(state, [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Destructo-Press' }]);
    expect(res.events.filter(e => e.kind === 'reveal')).toEqual([
      { kind: 'reveal', owner: 'A', cards: ['A-d0', 'A-d1', 'A-d2'], from: 'deck', to: 'all' },
    ]);
    // The reveal fires BEFORE the damage, and the damage still lands (not swallowed by the callback).
    const kinds = res.events.map(e => e.kind);
    expect(kinds.indexOf('reveal')).toBeLessThan(kinds.indexOf('damaged'));
    expect(kinds).toContain('ko');
  });
});

describe('Conformance — CF-18 reveal: an EMPTY hand reveal is still a reveal [TA-153]', () => {
  // Whimsicott ex wht-005 "Wondrous Cotton": "Your opponent reveals their hand." With an EMPTY hand
  // the instruction still EXECUTES — the attacker learns the hand is empty, which is real information
  // and is exactly why the attack then does 0 damage. That is the CF-9/TA-126 discriminator (the
  // instruction executes even over zero objects) applied to the reveal event, and rotomancer emits
  // `reveal{owner, cards: [], from: "hand", to: "all"}` here. buildRevealEvent's early return
  // suppressed the whole event, so the first-ever firing of the CF-18 gate (the day roto folded
  // handRevealed into reveal, RE-73) flagged xfz-wht-005: roto 2 reveals, twinleaf 1.
  const WHIMSICOTT = 'wht-005';
  const GRASS = 'sve-001';

  function wondrousCotton(opponentHand: CardRef[]): ReturnType<typeof step> {
    const A = player({
      active: poke('A-act', WHIMSICOTT, en(GRASS, 1, 'A')),
      deck: [{ iid: 'A-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })),
    });
    const B = player({
      active: poke('B-act', TANKY),
      hand: opponentHand,
      deck: [{ iid: 'B-d', printing: WATER }],
      prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `B-pz${i}`, printing: WATER, faceUp: false })),
    });
    const st: NeutralState = { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
    return step(st, [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Wondrous Cotton' }]);
  }

  it('empty opponent hand: no reveal, nothing hidden becomes visible (B.97; supersedes TA-153) [TA-663]', () => {
    const r = wondrousCotton([]);
    expect(r.events.filter(e => e.kind === 'reveal')).toEqual([]);
  });

  it('populated opponent hand: unchanged — one reveal carrying the iids', () => {
    const r = wondrousCotton([{ iid: 'B-h0', printing: WATER }]);
    const reveals = r.events.filter(e => e.kind === 'reveal');
    expect(reveals.length).toBe(1);
    expect((reveals[0] as { cards: string[] }).cards).toEqual(['B-h0']);
    expect((reveals[0] as { from: string }).from).toBe('hand');
  });
});
