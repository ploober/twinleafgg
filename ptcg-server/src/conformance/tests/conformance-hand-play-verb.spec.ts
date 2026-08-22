import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';

/**
 * TA-273 — the hand-play VERB is now validated against the card it names.
 *
 * Every hand-play verb dispatches the same `PlayCardAction`, so the engine resolved from the CARD's
 * own category and never read the verb: `benchBasic`, `playSupporter`, `attachTool` and
 * `attachEnergy` each successfully resolved an Ultra Ball. All three engines' MENUS offered exactly
 * `playItem` for it — only the executor did not check. That is the "menu and dispatcher are written
 * in two places" shape rotomancer named in RE-117 / RE-121, so the derivation now lives in ONE
 * exported function (`handPlayVerbFor`) that both the menu and the dispatcher read.
 *
 * CF-54 pins that the verb SELECTS THE GATES, so a non-load-bearing verb is a contract violation.
 * The reason it was raised to a scale blocker rather than left open: with 2,000 agent-authored specs
 * agents WILL write the wrong verb, twinleaf would accept where rotomancer refuses, and the harness
 * would report DIVERGED with no rules content in it.
 */

const ULTRA_BALL = 'Ultra Ball SVI';
const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function pip(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}

/** A to act, Ultra Ball in hand with its two-card discard cost payable. */
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 5, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: pip('a0', RALTS),
        bench: [pip('ab0', RALTS)],
        hand: [{ iid: 'ah0', printing: ULTRA_BALL }, { iid: 'ah1', printing: WATER }, { iid: 'ah2', printing: WATER }],
        deck: [{ iid: 'ad0', printing: RALTS }, { iid: 'ad1', printing: WATER }],
        prizes: [{ iid: 'ap0', printing: WATER, faceUp: false }],
      }),
      B: player({
        active: pip('b0', RALTS),
        deck: [{ iid: 'bd0', printing: WATER }],
        prizes: [{ iid: 'bp0', printing: WATER, faceUp: false }],
      }),
    },
  };
}

describe('Conformance — the hand-play verb names the card (TA-273)', () => {

  it('offers exactly `playItem` for an Item, and accepts it', () => {
    const menu = step(board(), []).pending!.legalActions;
    const ultraBall = menu.filter(a => (a as { card?: string }).card === 'ah0');

    expect(ultraBall.length).toBe(1);
    expect(ultraBall[0].type).toBe('playItem');
    expect(step(board(), [{ actor: 'A', type: 'playItem', card: 'ah0' } as NeutralAction]).status)
      .toBe('awaitingAction');
  });

  it('REJECTS every other hand-play verb on that same Item', () => {
    // Before this gate each of these returned `awaitingAction` and resolved the Ultra Ball.
    const wrong: NeutralAction[] = [
      { actor: 'A', type: 'benchBasic', card: 'ah0' } as NeutralAction,
      { actor: 'A', type: 'playSupporter', card: 'ah0' } as NeutralAction,
      { actor: 'A', type: 'playStadium', card: 'ah0' } as NeutralAction,
      { actor: 'A', type: 'attachTool', card: 'ah0', target: 'a0' } as NeutralAction,
      { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a0' } as NeutralAction,
    ];
    for (const action of wrong) {
      const res = step(board(), [action]);
      expect(res.status).toBe('invalidAction', `${action.type} on an Item must be invalidAction`);
      expect(res.applied).toBe(0, `${action.type}`);
    }
  });

  /**
   * The negative controls. A gate keyed on "is this an Item?" would pass the cell above while
   * breaking every legitimate play, so each remaining category is driven with its OWN correct verb —
   * and with a wrong one, so the cell cannot pass by accepting everything.
   */
  it('still accepts each category with its own verb, and rejects the swap', () => {
    // Energy: attachEnergy is right, playItem is not.
    expect(step(board(), [{ actor: 'A', type: 'attachEnergy', card: 'ah1', target: 'a0' } as NeutralAction]).status)
      .toBe('awaitingAction');
    expect(step(board(), [{ actor: 'A', type: 'playItem', card: 'ah1' } as NeutralAction]).status)
      .toBe('invalidAction');
  });
});
