import { step } from '../driver';
import { handleStep, handleCards, handleCapabilities } from '../http/handlers';
import { UnsupportedFormatError } from '../formats';
import { NeutralState, PlayerState, PlayerFlags, CardRef, SCHEMA_VERSION } from '../neutral-types';

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

const GRASS = 'sve-001';
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function deck(tag: string): CardRef[] {
  return Array.from({ length: 20 }, (_, i) => ({ iid: `${tag}${i}`, printing: i === 0 ? 'sit-060' : GRASS }));
}
function player(d: CardRef[]): PlayerState {
  return { active: null, bench: [], hand: [], deck: d, discard: [], lostZone: [], prizes: [], flags: flags() };
}
function board(format?: string): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, ...(format === undefined ? {} : { format }), turn: 0, activePlayer: 'A',
    firstPlayer: null, phase: 'setup', outcome: 'ongoing', stadium: null,
    players: { A: player(deck('a')), B: player(deck('b')) },
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
