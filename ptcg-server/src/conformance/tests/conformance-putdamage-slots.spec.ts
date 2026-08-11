import { importState, ImportedGame } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, WireLegalAction,
  PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { PlayerType, SlotType } from '../../game/store/actions/play-card-action';
import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';

/**
 * PutDamagePrompt carries a `slots` restriction, and `PutDamagePrompt.validate()` ENFORCES it
 * (`result.some(r => !this.slots.includes(r.target.slot))` → false). The conformance decomposer
 * enumerated its legal actions from `maxAllowedDamage` alone and never consulted `slots`, so on a
 * bench-only effect it OFFERED the Active. Taking an offer the harness itself advertised then made
 * the engine reject the assembled result, which surfaced to the wire as **HTTP 500**.
 *
 * Found 2026-07-25 on Dragapult ex `asc-160` "Phantom Dive" — *"Put 6 damage counters on your
 * opponent's BENCHED Pokemon in any way you like"* — which correctly passes `[SlotType.BENCH]`. The
 * card and the prompt were both right; only the projection was wrong. Registered as a HARNESS gap,
 * not a card bug: an adapter-only crash is ours to fix, never the engine's to work around.
 *
 * The cross-engine scenario suite cannot express this. `ScenarioRunner` evaluates a `golden` only
 * "when the engines already agree", and this board also carries the open TA-128 damage-deferral
 * divergence — so the differential returns first and the menu assertion never runs. A menu bug on a
 * board that also has a state divergence is unassertable there; it belongs here.
 */

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
function board(A: PlayerState, B: PlayerState): NeutralState {
  const withPrize = (ps: PlayerState, tag: string): PlayerState =>
    ps.prizes.length ? ps : { ...ps, prizes: [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }] };
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withPrize(A, 'A'), B: withPrize(B, 'B') },
  };
}
function firstDecision(game: ImportedGame): WireLegalAction[] {
  const pending = replay(game, []).pending;
  if (pending === null) {
    throw new Error('no pending decision surfaced');
  }
  return pending.legalActions;
}

/** `WireLegalAction` is a discriminated union and not every arm carries `target` (takePrize does
 *  not), so narrow to the placeCounter arm rather than widening the union's type. */
function counterTargets(game: ImportedGame): string[] {
  return firstDecision(game)
    .filter((a): a is Extract<WireLegalAction, { type: 'placeCounter' }> => a.type === 'placeCounter')
    .map(a => a.target);
}

/** Both of the opponent's Pokemon are damageable as far as `maxAllowedDamage` is concerned. */
function bothTargets(): DamageMap[] {
  return [
    { target: { player: PlayerType.TOP_PLAYER, slot: SlotType.ACTIVE, index: 0 }, damage: 9999 },
    { target: { player: PlayerType.TOP_PLAYER, slot: SlotType.BENCH, index: 0 }, damage: 9999 },
  ];
}

function openPrompt(game: ImportedGame, slots: SlotType[]): void {
  const p = game.state.players[0];
  game.store.prompt(game.state, new PutDamagePrompt(
    p.id, GameMessage.CHOOSE_POKEMON_TO_DAMAGE, PlayerType.TOP_PLAYER, slots, 60, bothTargets(),
    { allowCancel: false }
  ), () => { /* result unused: this spec asserts the MENU */ });
}

/** As `openPrompt`, but captures the RESOLVED placement — where the counters actually landed. */
function openPromptCapturing(game: ImportedGame, slots: SlotType[]): { get(): DamageMap[] | undefined } {
  let captured: DamageMap[] | undefined;
  const p = game.state.players[0];
  game.store.prompt(game.state, new PutDamagePrompt(
    p.id, GameMessage.CHOOSE_POKEMON_TO_DAMAGE, PlayerType.TOP_PLAYER, slots, 60, bothTargets(),
    { allowCancel: false }
  ), (result: DamageMap[]) => { captured = result; });
  return { get: () => captured };
}

/** Total damage the resolved placement put on `slot`. */
function placedOn(captured: DamageMap[] | undefined, slot: SlotType): number {
  return (captured ?? []).filter(d => d.target.slot === slot).reduce((n, d) => n + d.damage, 0);
}

function twoSidedBoard(): NeutralState {
  return board(
    player({ active: ralts('A-act') }),
    player({ active: ralts('B-act'), bench: [ralts('B-b0')] }),
  );
}

describe('Conformance — PutDamagePrompt honours its `slots` restriction in the offered menu', () => {

  /**
   * TA-239 re-recorded the two restricted cases. A `slots` restriction on this board leaves exactly
   * ONE eligible target, and `put-damage` now applies a forced step atomically (CF-14), so there is
   * no menu left to inspect — the boards were built one-eligible-target *precisely* to inspect it.
   *
   * They now assert the RESOLVED placement instead, which is what the register requires of a
   * forced-prompt guard (assert the state effect, not the pending — the rule that exists because a
   * pending-shaped assertion once masked TA-121). The assertion is not weaker: if `slots` were
   * ignored again the prompt would have TWO eligible targets, nothing would be forced, the placement
   * would not resolve on its own, and `captured` would still be undefined — so the guard fails. It is
   * in fact stronger against the original bug, which was that taking the wrongly-offered Active made
   * `validate()` reject and surfaced as HTTP 500: that now cannot happen silently, because the
   * counters' final resting place is asserted directly.
   */
  it('BENCH-only prompt puts every counter on the Bench (regression: Phantom Dive asc-160 → HTTP 500)', () => {
    const game = importState(twoSidedBoard());
    const cap = openPromptCapturing(game, [SlotType.BENCH]);

    replay(game, []);   // the whole placement is forced onto the single eligible target

    expect(cap.get()).toBeDefined();
    expect(placedOn(cap.get(), SlotType.BENCH)).toBe(60);
    // The defect: 'B-act' was offered although the prompt is BENCH-only.
    expect(placedOn(cap.get(), SlotType.ACTIVE)).toBe(0);
  });

  it('ACTIVE-only prompt puts every counter on the Active (the mirror case)', () => {
    const game = importState(twoSidedBoard());
    const cap = openPromptCapturing(game, [SlotType.ACTIVE]);

    replay(game, []);

    expect(cap.get()).toBeDefined();
    expect(placedOn(cap.get(), SlotType.ACTIVE)).toBe(60);
    expect(placedOn(cap.get(), SlotType.BENCH)).toBe(0);
  });

  it('unrestricted prompt still offers both — the fix must not over-filter', () => {
    const game = importState(twoSidedBoard());
    openPrompt(game, [SlotType.ACTIVE, SlotType.BENCH]);

    const targets = counterTargets(game);
    expect(targets).toContain('B-act');
    expect(targets).toContain('B-b0');
  });
});
