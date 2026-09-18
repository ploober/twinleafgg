import { step } from '../driver';
import {
  NeutralState, WireLegalAction, NeutralAction,
  PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-436 — Crispin ("Search your deck for up to 2 Basic Energy cards of different types …") must set
 * `differentTypes` on its ChooseCardsPrompt, so at the SECOND pick the legal menu excludes an Energy
 * of the type already taken (matching the engine's own validate, which rejects it). Without the flag
 * the menu advertised the duplicate type and the pick was then refused — the advertised menu and the
 * validator disagreed (CF-52). This drives the actual card. Mutation guard: drop `differentTypes: true`
 * from crispin.ts and test 2 reds (the duplicate type reappears in the menu).
 */

const CRISPIN = 'Crispin SCR';
const FIRE = 'Fire Energy SVE', WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function ralts(iid: string): PokemonInPlay {
  return { stack: [{ iid, printing: RALTS }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(): NeutralState {
  const deck: CardRef[] = [FIRE, FIRE, WATER, WATER].map((printing, i) => ({ iid: `d${i}`, printing }));
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: ralts('a1'), hand: [{ iid: 'ah0', printing: CRISPIN }], deck, prizes: [{ iid: 'A-pz', printing: WATER, faceUp: false }] }),
      B: player({ active: ralts('b1'), prizes: [{ iid: 'B-pz', printing: WATER, faceUp: false }] }),
    },
  };
}
const playCrispin: NeutralAction = { actor: 'A', type: 'playSupporter', card: 'ah0' } as NeutralAction;
const pick = (target: string): NeutralAction => ({ actor: 'A', type: 'choose', target } as NeutralAction);
const chooseTargets = (r: ReturnType<typeof step>): string[] =>
  ((r.pending?.legalActions ?? []) as WireLegalAction[])
    .filter((a): a is Extract<WireLegalAction, { type: 'choose' }> => a.type === 'choose')
    .map(a => a.target);

describe('TA-436 Crispin — second pick excludes the type already taken', () => {

  it('1. before any pick, all four basic Energy are offered', () => {
    expect(chooseTargets(step(board(), [playCrispin])).sort()).toEqual(['d0', 'd1', 'd2', 'd3']);
  });

  it('2. after picking the first Fire, the second Fire is NOT offered; the Waters still are', () => {
    const after = chooseTargets(step(board(), [playCrispin, pick('d0')]));
    expect(after).not.toContain('d1'); // the duplicate Fire — the defect
    expect(after).toContain('d2');     // Water — a different type stays legal
    expect(after).toContain('d3');
  });
});
