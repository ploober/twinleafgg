import { importState, ImportedGame } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, WireLegalAction, NeutralAction,
  PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { PlayerType, SlotType, CardTarget } from '../../game/store/actions/play-card-action';
import { RemoveDamagePrompt } from '../../game/store/prompts/remove-damage-prompt';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';

/**
 * TA-202: a forced STEP inside a multi-step prompt was surfaced as a 1-option pending.
 *
 * `remove-damage` splits each transfer into a source `choose` and a destination `placeCounter`. When
 * both are unique we surfaced two pendings with no decision in them, while rotomancer had already
 * applied the transfer.
 *
 * The existing `atomicResolvable` hook structurally cannot express this: it asks "is this WHOLE prompt
 * forced?", which a multi-pick aggregate can never answer yes to — one transfer being forced says
 * nothing about whether the player wants a second. Its docstring excludes such aggregates and that
 * exclusion is correct. `atomicStep` is the step-level sibling: it receives `picks` (forcedness here is
 * a property of the POSITION, not the prompt) and means "auto-apply the sole candidate and CONTINUE".
 *
 * Absent by default, so the other 15 decomposers are unaffected by construction, not by testing.
 *
 * WHAT THESE SPECS ASSERT — the state EFFECT, not the pending. A guard for a forced prompt that asserts
 * a pending is asserting the wrong thing (the CF-14 lesson: that shape produced a false-red which
 * masked TA-121). Here the load-bearing claim is that the forced transfer LANDS without any pick
 * action being supplied for it.
 *
 * Not a cross-engine scenario: rotomancer decomposes this prompt count-first where twinleaf goes
 * source-first (**CF-41**, open), so the two cannot be driven through it by one `actions[]` and any
 * differential row stays red for CF-41 reasons no matter what TA-202 does.
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
function ralts(iid: string, damage: number): PokemonInPlay {
  return { stack: [{ iid, printing: RALTS }], energy: [], tools: [], damage, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(activeDamage: number, benchDamage: number[]): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: ralts('a1', activeDamage),
        bench: benchDamage.map((d, i) => ralts(`a${i + 2}`, d)),
        prizes: [{ iid: 'A-pz', printing: WATER, faceUp: false }],
      }),
      B: player({ active: ralts('b1', 0), prizes: [{ iid: 'B-pz', printing: WATER, faceUp: false }] }),
    },
  };
}

const t = (pl: PlayerType, slot: SlotType, index: number): CardTarget => ({ player: pl, slot, index });

/** Munkidori twm-095 "Adrena-Brain": move up to 3 counters from 1 of yours to 1 of the opponent's. */
function openAdrenaBrain(game: ImportedGame, benchCount: number): void {
  const p = game.state.players[0];
  const friendly: CardTarget[] = [t(PlayerType.BOTTOM_PLAYER, SlotType.ACTIVE, 0)];
  for (let i = 0; i < benchCount; i++) {
    friendly.push(t(PlayerType.BOTTOM_PLAYER, SlotType.BENCH, i));
  }
  const maxAllowedDamage: DamageMap[] = friendly.map(target => ({ target, damage: 110 }));
  game.store.prompt(game.state, new RemoveDamagePrompt(
    p.id, GameMessage.MOVE_DAMAGE, PlayerType.ANY, [SlotType.ACTIVE, SlotType.BENCH], maxAllowedDamage,
    {
      min: 1, max: 3, allowCancel: false, sameTarget: true,
      blockedTo: friendly,
      blockedFrom: [t(PlayerType.TOP_PLAYER, SlotType.ACTIVE, 0)],
    }
  ), transfers => {
    // Mirror the card: move one counter per transfer, source -> destination.
    for (const tr of (transfers ?? [])) {
      const from = tr.from.slot === SlotType.ACTIVE ? p.active : p.bench[tr.from.index];
      const opp = game.state.players[1];
      const to = tr.to.slot === SlotType.ACTIVE ? opp.active : opp.bench[tr.to.index];
      if (from.damage >= 10) {
        from.damage -= 10;
        to.damage += 10;
      }
    }
  });
}

function damages(game: ImportedGame): { a1: number; b1: number } {
  return { a1: game.state.players[0].active.damage, b1: game.state.players[1].active.damage };
}

const decline: NeutralAction = { actor: 'A', type: 'confirm', value: false } as NeutralAction;

describe('Conformance — a forced STEP inside a multi-step prompt collapses (TA-202)', () => {

  it('the forced transfer lands with NO pick action supplied for it', () => {
    // One damaged Pokemon (the only legal source, post-TA-203) and one opposing Pokemon (the only
    // legal destination). Both steps of transfer #1 are forced.
    const game = importState(board(30, [0]));
    openAdrenaBrain(game, 1);

    // `decline` stops the AGGREGATE after the first transfer. It supplies no source and no destination
    // pick — those must have been auto-applied.
    replay(game, [decline]);

    expect(damages(game)).toEqual({ a1: 20, b1: 10 });
  });

  it('the first pending is the SECOND transfer, not the first — and it can stop', () => {
    const game = importState(board(30, [0]));
    openAdrenaBrain(game, 1);

    const pending = replay(game, []).pending;
    expect(pending).not.toBeNull();
    const actions = pending!.legalActions as WireLegalAction[];
    // A genuine decision: move another from a1, or stop. Not a lone forced `choose`.
    expect(actions.some(a => a.type === 'confirm' && a.value === false)).toBe(true);
    expect(actions.filter(a => a.type === 'choose').length).toBe(1);
  });

  it('an UNforced source still surfaces its pick — the collapse must not swallow a real choice', () => {
    // Two damaged Pokemon: the source is a genuine decision, so no collapse.
    const game = importState(board(30, [20]));
    openAdrenaBrain(game, 1);

    const pending = replay(game, []).pending;
    const chooses = (pending!.legalActions as WireLegalAction[]).filter(a => a.type === 'choose');
    expect(chooses.length).toBe(2);
    // Nothing applied yet — the player has not picked.
    expect(damages(game)).toEqual({ a1: 30, b1: 0 });
  });

  it('once min is met, a lone candidate does NOT collapse — "move another or stop" is a real decision', () => {
    // This is the boundary that makes remove-damage's unconditional `atomicStep` safe: the driver's
    // `!canStopNow` gate refuses the collapse as soon as `END_CHOICE` is offered.
    const game = importState(board(30, [0]));
    openAdrenaBrain(game, 1);

    const pending = replay(game, []).pending;
    const actions = pending!.legalActions as WireLegalAction[];
    expect(actions.some(a => a.type === 'confirm' && a.value === false)).toBe(true);
    // ... and the second transfer is NOT auto-applied despite a1 being the only source.
    expect(damages(game)).toEqual({ a1: 30, b1: 0 });
  });
});
