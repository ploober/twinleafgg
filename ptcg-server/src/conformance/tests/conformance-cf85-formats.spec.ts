import { step } from '../driver';
import { handleStep, handleCards, handleCapabilities } from '../http/handlers';
import { UnsupportedFormatError } from '../formats';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * CF-85 — format on the wire. twinleaf declares `formats: [standard, expanded]`, accepts a board's `format`
 * and echoes it in every response state, refuses an unadvertised format as a malformed request, and answers
 * `GET /v1/cards/{set}?format=` with the cards its OWN deck validator calls legal there (the claim the
 * harness tests against the card oracle).
 *
 * Mutation guard: drop the echo and the two echo cells fail; drop `resolveFormat` from the step handler and the
 * refusal cell fails; drop the legality filter from `buildCardsForSet` and the Standard/Expanded split cell
 * fails (tef-140 is regulation mark G: Expanded, not Standard).
 */

const RALTS = 'sit-067';
const GRASS = 'sve-001';
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function mon(iid: string): PokemonInPlay {
  return {
    stack: [{ iid, printing: RALTS }], energy: [], tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function player(tag: string): PlayerState {
  const deck: CardRef[] = Array.from({ length: 10 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
  return { active: mon(`${tag}a`), bench: [], hand: [], deck, discard: [], lostZone: [], prizes: [], flags: flags() };
}
/** An ordinary quiescent main-phase board (no setup walk: twinleaf-main shares this spec and has none). */
function board(format?: string): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, ...(format === undefined ? {} : { format }), turn: 2, activePlayer: 'A',
    firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: player('a'), B: player('b') },
  };
}

describe('CF-85 formats', () => {
  it('declares the formats it serves', () => {
    expect(handleCapabilities().formats).toEqual(['standard', 'expanded']);
  });

  it('echoes the board format in the response state', () => {
    expect(step(board('expanded'), []).state.format).toBe('expanded');
    expect(step(board('standard'), []).state.format).toBe('standard');
  });

  it('reads an absent format as standard (rollout bridge) and echoes it', () => {
    expect(step(board(), []).state.format).toBe('standard');
  });

  it('refuses a format it does not advertise as a malformed request', () => {
    const body = { schemaVersion: SCHEMA_VERSION, initialState: board('glc'), actions: [] };
    expect(() => handleStep(body)).toThrowError(UnsupportedFormatError);
    expect(() => handleCards('tef', 'glc')).toThrowError(UnsupportedFormatError);
  });

  it('lists per-format legality: a regulation-mark G card is Expanded, not Standard', () => {
    const std = handleCards('tef', 'standard').cards.map(c => c.printing);
    const exp = handleCards('tef', 'expanded').cards.map(c => c.printing);
    expect(exp).toContain('tef-140');
    expect(std).not.toContain('tef-140');
    expect(std.length).toBeLessThan(exp.length);
  });
});
