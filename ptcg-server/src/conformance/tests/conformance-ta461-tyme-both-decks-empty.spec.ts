import { replay, step } from '../driver';
import { importState } from '../state-adapter';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-461 — Tyme `ssp-190` must NOT be playable when NEITHER player can draw.
 *
 * Tyme (Supporter): "Tell your opponent the name of a Pokémon in your hand ... Your opponent guesses that
 * Pokémon's HP, and then you reveal it. If your opponent guessed right, they draw 4 cards. If they guessed
 * wrong, you draw 4 cards. Then, return the Pokémon to your hand." The only game-state effect is a draw —
 * by the opponent on a correct guess, by you on a wrong guess. The name / guess / reveal is information,
 * not an effect on the game state.
 *
 * When BOTH decks are empty no draw can happen on either branch, so the card is played for no effect.
 * Compendium #924 ("you cannot play a Trainer when it is known it will have no effect"), #925, #1042.
 * Twinleaf offered and applied playSupporter Tyme on this degenerate board (guess pending, reveal, no draw,
 * card returned); rotomancer omits it from legalActions. Surfaced by the 2026-09-20 full fuzz
 * (`tr-nobench-ssp-190--deck0`), re-driven live 2026-09-20.
 *
 * The gate is "at least one deck non-empty" — if EITHER deck has a card, some branch draws, so the play is
 * legal (the guesser, not the player, decides which branch). Both engines agree: offered with A-deck-only
 * and with B-deck-only, refused only when both are empty.
 *
 * Mutation guard: restore the both-decks-empty carve-out in tyme.ts canPlay and the first cell fails
 * (Tyme is offered again).
 */

const TYME = 'ssp-190';
const BELLSPROUT = 'asc-004';
const GRASS = 'sve-001';
const PSYCHIC = 'sve-005';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function basic(iid: string, printing = BELLSPROUT): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function prizes(tag: string): CardRef[] {
  return Array.from({ length: 3 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS }));
}
function deck(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}

/** A's main turn, supporter not yet played, a Pokémon in hand for Tyme; deck sizes are the axis. */
function board(aDeck: number, bDeck: number): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: basic('a1'),
        hand: [
          { iid: 'tyme', printing: TYME },
          { iid: 'ah-poke', printing: BELLSPROUT },
          { iid: 'ah-g', printing: GRASS },
          { iid: 'ah-p', printing: PSYCHIC },
        ],
        deck: deck('a', aDeck), prizes: prizes('a'),
      }),
      B: player({ active: basic('b1'), deck: deck('b', bDeck), prizes: prizes('b') }),
    },
  };
}

function tymeOffered(state: NeutralState): boolean {
  const la = replay(importState(state), []).pending?.legalActions ?? [];
  return la.some(a => (a as { type: string }).type === 'playSupporter' && (a as { card?: string }).card === 'tyme');
}

describe('TA-461 Tyme ssp-190 is not playable with both decks empty (a Trainer for no effect)', () => {
  it('BOTH decks empty: Tyme is NOT offered — no branch can draw', () => {
    expect(tymeOffered(board(0, 0))).toBe(false);
  });

  it('control — A deck has a card: Tyme IS offered (a wrong guess draws for A)', () => {
    expect(tymeOffered(board(1, 0))).toBe(true);
  });

  it('control — B deck has a card: Tyme IS offered (a right guess draws for B)', () => {
    expect(tymeOffered(board(0, 1))).toBe(true);
  });

  it('control — the card is refused end-to-end when both decks are empty', () => {
    const res = replay(importState(board(0, 0)),
      [{ actor: 'A', type: 'playSupporter', card: 'tyme' } as never]);
    expect(res.rejection).toBeDefined();
    expect(res.applied).toBe(0);
    // sanity: the same play lands when a deck is available
    const ok = step(board(1, 0), [{ actor: 'A', type: 'playSupporter', card: 'tyme' } as never]);
    expect(ok.applied).toBe(1);
  });
});
