import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-707 — Accompanying Flute twm-142 reveals the top five only when nothing is chosen, and AFTER the choice.
 *
 * Card text (card-data/final/twm.json): "Reveal the top 5 cards of your opponent's deck. You may choose any number of
 * Basic Pokémon you find there and put those Pokémon onto their Bench. Your opponent shuffles the other cards back
 * into their deck."
 *
 * B.97: "A printed 'reveal' of a hidden zone always emits one"; B.82: a hidden choice is made public before it
 * acts. The card file lifted the five into a prompt pile, asked A to choose Basics from it, and raised the opponent's
 * ShowCardsPrompt only in the nothing-chosen branch, after the choice. So when A benched a Basic, B never saw the
 * five at all; and when A chose none, the reveal came after A's pick, read the five from the prompt pile, and named
 * `from: transit` although they were in B's deck when the action started (contract: `from` is the zone at the start
 * of the action). Rotomancer a312d1fe3 reveals first, `from: deck`, on both branches.
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

describe('TA-707 Accompanying Flute twm-142: the top five are revealed to both players before the choice, on every branch', () => {
  type Reveal = { kind: 'reveal'; owner: string; cards: string[]; from: string; to: string };
  const reveals = (r: { events: Array<{ kind: string }> }) => r.events.filter(e => e.kind === 'reveal') as Reveal[];

  describe('a Basic among the five', () => {
    const b = board([BELLSPROUT, ...E.slice(0, 4)]);

    it('the reveal of all five is on the wire at the choice, from B\'s deck [TA-707 twm-142]', () => {
      const r = step(b, [play]);
      expect(r.pending?.actor).toBe('A');
      const rv = reveals(r);
      expect(rv.length).toBe(1);
      expect(rv[0].owner).toBe('B');
      expect(rv[0].from).toBe('deck');
      expect(rv[0].to).toBe('all');
      expect(rv[0].cards.slice().sort()).toEqual(['bd0', 'bd1', 'bd2', 'bd3', 'bd4']);
    });

    it('benching the Basic shows nothing again: one reveal over the whole action [TA-707 twm-142]', () => {
      const r = step(b, [play, { actor: 'A', type: 'choose', target: 'bd0' } as NeutralAction]);
      expect(reveals(r).length).toBe(1);
      expect(r.state.players.B.bench.map(p => p.stack[0].iid)).toContain('bd0');
    });
  });

  describe('no Basic among the five', () => {
    const b = board([...E]);

    it('the reveal names B\'s deck, where the five were when the Item was played [TA-707 twm-142]', () => {
      const rv = reveals(step(b, [play]));
      expect(rv.length).toBe(1);
      expect(rv[0].from).toBe('deck');
      expect(rv[0].cards.slice().sort()).toEqual(['bd0', 'bd1', 'bd2', 'bd3', 'bd4']);
    });
  });
});
