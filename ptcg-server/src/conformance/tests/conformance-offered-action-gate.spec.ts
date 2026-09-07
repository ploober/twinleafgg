import { importState, ImportedGame } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, NeutralAction,
  PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { selectOptionDecomposer } from '../decomposers/select-option';
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
 * `toPick`. Several decomposers reject structurally-incoherent picks with a descriptive Error
 * (`select-option` on a disabled or out-of-range index) — the harness's "this log is malformed"
 * channel, which is distinct from "illegal at a live decision node".
 *
 * ⚠️ AMENDED 2026-08-21 (TA-302). That distinction was drawn in the wrong place. CF-52 names *"absent
 * `to`, unknown iid, bad index"* as `invalidAction` explicitly, so a DISABLED or OUT-OF-RANGE
 * `selectOption` — neither of which the menu offers — is an invalid action, not a malformed log, and
 * the descriptive Error was reaching the HTTP layer as a 500. An 11-cell (verb, required-field)
 * census on 2026-08-21 put twinleaf at 4 of 11 and rotomancer at 11 of 11.
 *
 * The ordering is UNCHANGED and still asserted; what changed is who decides the channel. `toPick`
 * still runs first, but a throw from it is now routed by the membership test: NOT OFFERED →
 * `invalidAction`; OFFERED and still unmappable → rethrown, because a menu advertising something the
 * adapter cannot map is OUR bug and an adapter-only fault must stay a loud harness gap.
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

  /**
   * TA-302 / CF-52. A disabled index and an out-of-range index are both things the menu does not
   * offer, so both are `invalidAction` — the same answer rotomancer gives, measured live on
   * `option: 99` and `option: -1`. Before this they were a decomposer Error, which the HTTP layer
   * reported as a 500 `engineFault`.
   */
  it('an UNOFFERED pick is invalidAction even when the decomposer has its own descriptive rejection', () => {
    const mk = (): ImportedGame => {
      const game = importState(board());
      const p = game.state.players[0];
      game.store.prompt(game.state, new SelectOptionPrompt(
        p.id, GameMessage.CHOOSE_OPTION, ['a', 'b', 'c'], { disabled: [false, true, false] }
      ), () => { /* unresolved */ });
      return game;
    };

    for (const option of [1, 9]) {
      // A GameError(ILLEGAL_ACTION) is caught by the driver and returned as a `rejection`, which the
      // caller renders as HTTP 200 + `status: invalidAction`. A bare Error escapes `replay` entirely
      // and reaches the HTTP layer as a 500 `engineFault` — which is exactly what these two did.
      const res = replay(mk(), [{ actor: 'A', type: 'selectOption', option } as NeutralAction]);

      expect(res.applied).toBe(0, `option ${option} must not be applied`);
      expect(res.rejection).toBeDefined();
      expect(res.rejection!.nativeReason!.code).toBe(GameMessage.ILLEGAL_ACTION);
    }
  });

  /**
   * The other half of the same routing, and the half with no natural board: an action the menu DOES
   * offer whose `toPick` still throws. That combination is a decomposer inconsistency (SD-14's class)
   * — every real descriptive rejection we have is for an un-offered action — so it is provoked here
   * with a spy rather than a board. Without this cell the rethrow branch is unexercised, and a later
   * edit could route every throw to `invalidAction` and silently turn our own adapter bugs into
   * clean-looking rejections. That is the failure the census was measuring in the other direction.
   */
  it('an OFFERED pick whose toPick throws is RETHROWN, so an adapter inconsistency stays loud', () => {
    const game = importState(board());
    const p = game.state.players[0];
    game.store.prompt(game.state, new SelectOptionPrompt(
      p.id, GameMessage.CHOOSE_OPTION, ['a', 'b', 'c'], { disabled: [false, false, false] }
    ), () => { /* unresolved */ });

    spyOn(selectOptionDecomposer, 'toPick').and.throwError('[conformance] synthetic adapter fault');

    // option 0 IS offered (nothing is disabled), so the throw is ours, not the caller's.
    expect(() => replay(game, [{ actor: 'A', type: 'selectOption', option: 0 } as NeutralAction]))
      .toThrowError(/synthetic adapter fault/);
  });
});

/**
 * TA-291: the same class one level up — the TOP-LEVEL dispatcher, not a decomposer pick.
 *
 * `declareAttack` and `useAbility` carry a `source` iid. `legal-actions.ts` emits the BOTTOM Pokemon
 * of the stack (`ctx.cardToIid.get(list.getPokemons()[0])`) — the wire's identifier for a Pokemon in
 * play — but the dispatcher accepted ANY card in the containing slot, so a caller could name an
 * evolved printing no menu ever offered and have it silently resolve to the slot. Rotomancer refuses
 * it (`CF-52: source names iid a2, which is not a Pokemon in play`) and is right; measured live
 * 2026-08-19 on this exact stack — both engines' menus offered only a0, and twinleaf ran the attack
 * for 300 damage when sent a2.
 *
 * RE-117 / RE-121 / TA-273 mirrored onto us: the menu and the dispatcher are written in two places.
 *
 * Note what did NOT guard it. The four regression spec files' own `inPlay()` helper stamped its
 * friendly iid on the TOP card, so 14 existing cells had been submitting exactly this un-offered
 * spelling and passing; tightening the check turned all 14 red at once and the helper now names the
 * bottom card. That is a helper convention silently contradicting the wire — so the cells below
 * assert the rule DIRECTLY, against a board built from raw printings, where no helper can drift.
 */
describe('Conformance — `source` names the Pokemon, not a card in its stack (TA-291)', () => {

  const ROWDY_HAMMER = 'Rowdy Hammer';

  /** Evolved Active: pbl-073 (Basic) -> pbl-044 -> pbl-045 Rampardos ex, two Fighting attached. */
  function stackBoard(): NeutralState {
    const b = board();
    b.players.A.active = {
      stack: [
        { iid: 'a0', printing: 'pbl-073' },
        { iid: 'a1', printing: 'pbl-044' },
        { iid: 'a2', printing: 'pbl-045' },
      ],
      energy: [{ iid: 'ae0', printing: 'sve-006' }, { iid: 'ae1', printing: 'sve-006' }],
      tools: [], damage: 0, conditions: [], markers: markers(),
    };
    // One Energy on the opponent's Active: Rampardos ex's Destructive Headbutting is withheld with none
    // to discard (TA-377, B.29 addendum 2), and this board's useAbility control needs it OFFERED.
    b.players.B.active = { stack: [{ iid: 'b1', printing: 'meg-003' }], energy: [{ iid: 'be0', printing: 'sve-003' }], tools: [], damage: 0, conditions: [], markers: markers() };
    return b;
  }

  it('the menu names ONLY the bottom card — the premise the rejection rests on', () => {
    const offered = replay(importState(stackBoard()), []).pending?.legalActions ?? [];
    const sources = offered
      .filter(a => (a as { type: string }).type === 'declareAttack' || (a as { type: string }).type === 'useAbility')
      .map(a => (a as { source: string }).source);
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(['a0']));
  });

  it('a `declareAttack` whose source is a NON-BOTTOM stack member is rejected, not resolved', () => {
    for (const bad of ['a1', 'a2']) {
      const res = replay(importState(stackBoard()),
        [{ actor: 'A', type: 'declareAttack', source: bad, name: ROWDY_HAMMER } as NeutralAction]);
      expect(res.rejection).toBeDefined();
      expect(res.applied).toBe(0);
    }
  });

  it('POSITIVE CONTROL — the same attack with the BOTTOM iid still runs', () => {
    const res = replay(importState(stackBoard()),
      [{ actor: 'A', type: 'declareAttack', source: 'a0', name: ROWDY_HAMMER } as NeutralAction]);
    expect(res.rejection).toBeUndefined();
    expect(res.applied).toBe(1);
  });

  it('`useAbility` carries the same rule, and its bottom-iid control still runs', () => {
    const offered = replay(importState(stackBoard()), []).pending?.legalActions ?? [];
    const abilities = offered.filter(a => (a as { type: string }).type === 'useAbility');
    expect(abilities.length).toBeGreaterThan(0);
    const ability = (abilities[0] as { ability: string }).ability;

    const bad = replay(importState(stackBoard()),
      [{ actor: 'A', type: 'useAbility', source: 'a2', ability } as NeutralAction]);
    expect(bad.rejection).toBeDefined();

    const good = replay(importState(stackBoard()),
      [{ actor: 'A', type: 'useAbility', source: 'a0', ability } as NeutralAction]);
    expect(good.rejection).toBeUndefined();
  });
});
