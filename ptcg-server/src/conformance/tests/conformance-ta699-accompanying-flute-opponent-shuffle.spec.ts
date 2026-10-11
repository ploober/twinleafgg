import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-699 — Accompanying Flute twm-142 shuffles the PLAYER's own deck and leaves the opponent's revealed cards on the
 * bottom of their deck in known order.
 *
 * Card text (card-data/final/twm.json): "Reveal the top 5 cards of your opponent's deck. You may choose any number of
 * Basic Pokémon you find there and put those Pokémon onto their Bench. Your opponent shuffles the other cards back
 * into their deck."
 *
 * With no Basic among the five (nothing to bench) the card file's empty-pick branch raised ShuffleDeckPrompt for the
 * PLAYER and applied the order to the player's deck: `shuffled {A, deck}`, A's deck reordered, and B's five revealed
 * cards put back under B's deck in the order everyone just saw. The text has the OPPONENT shuffle THEIR deck. The
 * Basic-found branch already shuffles the opponent's deck (the control below).
 */

const FLUTE = 'twm-142';
const BELLSPROUT = 'asc-004';
const E = ['sve-001', 'sve-002', 'sve-003', 'sve-004', 'sve-005'];

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: E[2], faceUp: false }));
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function deck(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}

const A_DECK = deck('ad', [...E, ...E, BELLSPROUT, BELLSPROUT]);
const ids = (cs: CardRef[]) => cs.map(c => c.iid);

/** A's turn; B's top five are `top5`, then ten more. B has open Bench slots. */
function board(top5: string[]): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', BELLSPROUT), bench: [mon('ab1', BELLSPROUT)],
        hand: [{ iid: 'ah1', printing: FLUTE }, { iid: 'ah2', printing: E[0] }], deck: A_DECK, prizes: prizes('ap', 6),
      }),
      B: player({
        active: mon('b1', BELLSPROUT), bench: [mon('bb1', BELLSPROUT)],
        hand: [{ iid: 'bh1', printing: E[0] }], deck: deck('bd', [...top5, ...E, ...E]), prizes: prizes('bp', 6),
      }),
    },
  } as NeutralState;
}

const play: NeutralAction = { actor: 'A', type: 'playItem', card: 'ah1' } as NeutralAction;
const shuffle = (order: string[]): NeutralAction => ({ actor: 'system', type: 'shuffle', order });
const shuffledEvents = (r: { events: Array<{ kind: string }> }) =>
  r.events.filter(e => e.kind === 'shuffled') as Array<{ kind: 'shuffled'; player: string; zone: string }>;

describe('TA-699 Accompanying Flute twm-142: the OPPONENT shuffles the other cards back into THEIR deck', () => {
  describe('no Basic among the five (nothing to bench)', () => {
    const b = board([...E]);   // five Energy on top

    it('the shuffle pending is over the opponent\'s deck, not the player\'s [TA-699]', () => {
      const r = step(b, [play]);
      expect(r.pending?.actor).toBe('system');
      const la = r.pending?.legalActions ?? [];
      expect(la.length).toBe(1);
      expect(la[0].type).toBe('shuffle');
      const d = (la[0] as { deck: string[] }).deck;
      expect(d.every(iid => iid.startsWith('bd'))).toBe(true);
      expect(d.sort()).toEqual(ids(b.players.B.deck).sort());
    });

    it('the shuffled event names B; A\'s deck is untouched; the five are back in B\'s deck [TA-699]', () => {
      const first = step(b, [play]);
      const order = (first.pending!.legalActions[0] as { deck: string[] }).deck.slice().reverse();
      const r = step(b, [play, shuffle(order)]);
      expect(shuffledEvents(r)).toEqual([{ kind: 'shuffled', player: 'B', zone: 'deck' }]);
      expect(ids(r.state.players.A.deck)).toEqual(ids(A_DECK));
      expect(ids(r.state.players.B.deck)).toEqual(order);
      expect(r.state.players.B.hand.map(c => c.iid)).toEqual(['bh1']);
    });

    it('the player\'s own deck order is never submitted: B\'s order is the only legal one [TA-699]', () => {
      const r = step(b, [play, shuffle(ids(A_DECK))]);
      expect(r.status).toBe('invalidAction');
    });
  });

  describe('CONTROL: a Basic among the five is benched, then the opponent shuffles the rest', () => {
    const b = board([BELLSPROUT, ...E.slice(0, 4)]);

    it('after the bench pick the shuffle is the opponent\'s and the four others are back in B\'s deck', () => {
      // bd0 is the only Basic among the five: after its pick the decision completes and the shuffle is raised.
      const r = step(b, [play, { actor: 'A', type: 'choose', target: 'bd0' } as NeutralAction]);
      const la = r.pending?.legalActions ?? [];
      expect(r.pending?.actor).toBe('system');
      expect(la[0]?.type).toBe('shuffle');
      const d = (la[0] as { deck: string[] }).deck;
      expect(d).not.toContain('bd0');
      expect(d.every(iid => iid.startsWith('bd'))).toBe(true);
      expect(d.length).toBe(14);
      expect(r.state.players.B.bench.map(p => p.stack[0].iid)).toContain('bd0');
    });
  });
});
