import { importState, ImportedGame } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, NeutralAction,
  PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { SelectOptionPrompt } from '../../game/store/prompts/select-option-prompt';
import { SuperType, EnergyType } from '../../game/store/card/card-types';

/**
 * TA-205 / SD-14: the driver accepted an action that was never OFFERED.
 *
 * The CF-12 strictness check tested only the action's TYPE
 * (`pickTypes.has(nextAction.type)`), never whether that specific candidate appeared in the pending's
 * `legalActions`. `toPick` then resolved the iid to an index without consulting the menu either. So a
 * pick naming an un-offered target of the right verb was accepted into the accumulator, and its
 * illegality only surfaced downstream when the assembled result failed the prompt's `validate()` —
 * reported by the caller as `engineFault`, i.e. **HTTP 500 for what is an invalid action**.
 *
 * Adjudicated against rotomancer, which refuses it at an explicit gate and is right. Same board, same
 * request, before the fix:
 *
 *   rotomancer  HTTP 200  invalidAction  index=2  "no option matches target iid ad1 (choose)"
 *   twinleaf    HTTP 500  engineFault    "decomposed result failed validate for prompt 'Choose cards'"
 *
 * The contract has a status for an action illegal at a live decision node and we returned the wrong
 * one. After the fix both engines answer `invalidAction` at index 2.
 *
 * Found while verifying TA-204: with the choose-cards menu corrected, replaying the SAME action list —
 * which names a card the menu no longer offers — still 500'd. Fixing the menu does not fix acceptance;
 * they are independent, and only the acceptance gate protects against a replayed or hand-written log
 * (a `.rep` import, a stale recorded scenario). The fuzzer picks from offered menus and structurally
 * cannot reach this.
 *
 * ORDERING, asserted below because it is the subtle part: the gate runs AFTER the decomposer's own
 * `toPick`. Several decomposers already reject structurally-incoherent picks with a descriptive Error
 * (`select-option` on a disabled or out-of-range index) — the harness's "this log is malformed"
 * channel, which is distinct from "illegal at a live decision node". Gating before `toPick` collapsed
 * the two and silently downgraded those diagnostics to a generic ILLEGAL_ACTION.
 */

const FIRE = 'Fire Energy SVE';
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
function ralts(iid: string): PokemonInPlay {
  return { stack: [{ iid, printing: RALTS }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function deck(...printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `d${i}`, printing }));
}
function board(deckCards: CardRef[] = []): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: ralts('a1'), deck: deckCards, prizes: [{ iid: 'A-pz', printing: WATER, faceUp: false }] }),
      B: player({ active: ralts('b1'), prizes: [{ iid: 'B-pz', printing: WATER, faceUp: false }] }),
    },
  };
}

const pick = (target: string): NeutralAction => ({ actor: 'A', type: 'choose', target } as NeutralAction);

/** Energy Search Pro's shape: pick basic Energy of DIFFERENT types. */
function openEnergySearch(game: ImportedGame): void {
  const p = game.state.players[0];
  game.store.prompt(game.state, new ChooseCardsPrompt(
    p, GameMessage.CHOOSE_CARD_TO_HAND, p.deck,
    { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
    { min: 0, max: 3, allowCancel: false, differentTypes: true } as never
  ), () => { /* result unused */ });
}

describe('Conformance — the driver refuses an action the pending never offered (TA-205)', () => {

  it('a pick naming an un-offered candidate is a normalized REJECTION, not an engine fault', () => {
    const game = importState(board(deck(FIRE, FIRE, WATER, WATER)));
    openEnergySearch(game);

    // d0 is FIRE and legal; d1 is the SECOND fire, excluded by differentTypes and NOT offered.
    // Note `runLoop` CATCHES GameError and normalizes it onto the result — a rejected action is a
    // reportable outcome, not a thrown fault — which is exactly the distinction TA-205 is about. An
    // adapter/contract bug (a non-GameError) is what keeps propagating.
    const res = replay(game, [pick('d0'), pick('d1')]);

    expect(res.rejection).toBeDefined();
    // `applied` counts actions applied BEFORE the offending one: d0 landed, d1 did not.
    expect(res.applied).toBe(1);
    // The defect: d1 used to be ACCEPTED here and fault later as 'decomposed result failed validate
    // for prompt Choose cards' → engineFault → HTTP 500, with no rejection and applied=2.
    expect(JSON.stringify(res.rejection)).not.toContain('failed validate');
  });

  it('an OFFERED pick on the same board is still accepted — the gate must not over-reject', () => {
    const game = importState(board(deck(FIRE, FIRE, WATER, WATER)));
    openEnergySearch(game);

    expect(() => replay(game, [pick('d0'), pick('d2')])).not.toThrow();
  });

  it('the first pick, with nothing yet chosen, is accepted', () => {
    const game = importState(board(deck(FIRE, FIRE, WATER, WATER)));
    openEnergySearch(game);

    expect(() => replay(game, [pick('d1')])).not.toThrow();
  });

  it('the gate runs AFTER toPick, so a decomposer keeps its own descriptive rejection', () => {
    // select-option already omits disabled indices AND rejects them in toPick with a specific message.
    // That is the "malformed log" channel and must not be downgraded to a generic ILLEGAL_ACTION.
    const mk = (): ImportedGame => {
      const game = importState(board());
      const p = game.state.players[0];
      game.store.prompt(game.state, new SelectOptionPrompt(
        p.id, GameMessage.CHOOSE_OPTION, ['a', 'b', 'c'], { disabled: [false, true, false] }
      ), () => { /* unresolved */ });
      return game;
    };

    expect(() => replay(mk(), [{ actor: 'A', type: 'selectOption', option: 1 } as NeutralAction]))
      .toThrowError(/disabled/);
    expect(() => replay(mk(), [{ actor: 'A', type: 'selectOption', option: 9 } as NeutralAction]))
      .toThrowError(/out of range/);
  });
});
