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

function twoSidedBoard(): NeutralState {
  return board(
    player({ active: ralts('A-act') }),
    player({ active: ralts('B-act'), bench: [ralts('B-b0')] }),
  );
}

describe('Conformance — PutDamagePrompt honours its `slots` restriction in the offered menu', () => {

  it('BENCH-only prompt does not offer the Active (regression: Phantom Dive asc-160 → HTTP 500)', () => {
    const game = importState(twoSidedBoard());
    openPrompt(game, [SlotType.BENCH]);

    const targets = counterTargets(game);
    expect(targets).toContain('B-b0');
    // The defect: 'B-act' was offered, and taking it made validate() reject → 500 on the wire.
    expect(targets).not.toContain('B-act');
  });

  it('ACTIVE-only prompt does not offer the Bench (the mirror case)', () => {
    const game = importState(twoSidedBoard());
    openPrompt(game, [SlotType.ACTIVE]);

    const targets = counterTargets(game);
    expect(targets).toContain('B-act');
    expect(targets).not.toContain('B-b0');
  });

  it('unrestricted prompt still offers both — the fix must not over-filter', () => {
    const game = importState(twoSidedBoard());
    openPrompt(game, [SlotType.ACTIVE, SlotType.BENCH]);

    const targets = counterTargets(game);
    expect(targets).toContain('B-act');
    expect(targets).toContain('B-b0');
  });
});
