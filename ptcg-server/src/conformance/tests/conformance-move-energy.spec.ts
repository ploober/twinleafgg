import { step } from '../driver';
import { classify } from '../decomposers';
import { moveEnergyDecomposer } from '../decomposers/move-energy';
import { MoveEnergyPrompt } from '../../game/store/prompts/move-energy-prompt';
import { State } from '../../game/store/state/state';
import { Prompt } from '../../game/store/prompts/prompt';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// MoveEnergyPrompt ('Move energy') decomposer. Before it was registered, the driver classified this
// prompt as 'unsupported' and any card raising it (Energy Switch, Multi Switch, Pow Hand Extension, …)
// faulted `[conformance] prompt 'Move energy' has no decomposer (out of scope)` — silently defeating
// every energy-movement repro. One transfer decomposes to one `moveEnergy{card, source, target}`
// (CF-34: a relocation is not an attach; `source` = the Pokemon the energy sits on). These specs drive
// Energy Switch (move a basic Energy from 1 of your Pokemon to another) end-to-end through step().

const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT';
const ENERGY_SWITCH = 'Energy Switch SVI';

function markers(played = 1): PokemonMarkers {
  return { playedOnTurn: played, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function pip(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const withDefaults = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }],
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withDefaults(A, 'A'), B: withDefaults(B, 'B') },
  };
}

/**
 * Active Ralts holding one basic Water Energy + **two** bench Ralts to receive it; Energy Switch in
 * hand. The second bench slot is load-bearing: with one, the relocation has exactly one legal
 * (card, destination) pair and CF-14 collapses it, so there is no menu to make assertions about —
 * and the menu (the VERB, and the self-exclusion of the source) is what these cells are for. This
 * board was one-bench until 2026-08-21 and could not test its own subject.
 */
function energySwitchBoard(): NeutralState {
  return board(
    player({
      active: pip('A-act', RALTS, [{ iid: 'e0', printing: WATER }]),
      bench: [pip('A-b0', RALTS), pip('A-b1', RALTS)],
      hand: [{ iid: 'es', printing: ENERGY_SWITCH }],
    }),
    player({ active: pip('B-act', RALTS) }),
  );
}

/** The same board with ONE bench slot — the forced 1-of-1 relocation CF-34 says collapses. */
function forcedRelocationBoard(): NeutralState {
  return board(
    player({
      active: pip('A-act', RALTS, [{ iid: 'e0', printing: WATER }]),
      bench: [pip('A-b0', RALTS)],
      hand: [{ iid: 'es', printing: ENERGY_SWITCH }],
    }),
    player({ active: pip('B-act', RALTS) }),
  );
}

describe('MoveEnergyPrompt decomposer — Energy Switch', () => {

  it("classifies 'Move energy' as decomposable (was 'unsupported' -> 500)", () => {
    expect(classify({ type: 'Move energy' } as Prompt<unknown>)).toBe('decomposable');
  });

  it('surfaces the move as a pending with a moveEnergy legalAction when the log is dry (CF-34)', () => {
    const res = step(energySwitchBoard(), [{ actor: 'A', type: 'playItem', card: 'es' }]);

    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.actor).toBe('A');
    expect(res.pending!.descriptor).toContain('Move energy');
    // the source energy e0 may move to EITHER bench Ralts, and not back onto its own active
    expect(res.pending!.legalActions.some(a =>
      a.type === 'moveEnergy' && a.card === 'e0' && (a as { source?: string }).source === 'A-act' && a.target === 'A-b0')).toBe(true);
    expect(res.pending!.legalActions.some(a =>
      a.type === 'moveEnergy' && a.card === 'e0' && (a as { source?: string }).source === 'A-act' && a.target === 'A-b1')).toBe(true);
    expect(res.pending!.legalActions.some(a =>
      a.type === 'moveEnergy' && a.target === 'A-act')).toBe(false);
    // CF-34: the relocation must NOT be misverbed as an attach
    expect(res.pending!.legalActions.some(a => a.type === 'attachEnergy')).toBe(false);
  });

  it('moves the basic energy from source to destination and completes', () => {
    const res = step(energySwitchBoard(), [
      { actor: 'A', type: 'playItem', card: 'es' },
      { actor: 'A', type: 'moveEnergy', card: 'e0', source: 'A-act', target: 'A-b0' },
    ]);

    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.A.active!.energy.map(e => e.iid)).toEqual([]);
    expect(res.state.players.A.bench[0].energy.map(e => e.iid)).toEqual(['e0']);
  });

  /**
   * TA-303 / CF-34's closing sentence: *"A forced 1-of-1 relocation still collapses per CF-14."*
   * The assertion is the STATE EFFECT, not the absence of a pending — an absent pending is also what
   * a silently-dropped effect looks like, and a guard that only checks for absence cannot tell the two
   * apart. The board is the previous version of `energySwitchBoard`, kept precisely because it is the
   * degenerate one.
   */
  it('applies a forced 1-of-1 relocation ATOMICALLY: the energy has MOVED and no pending is raised', () => {
    const res = step(forcedRelocationBoard(), [{ actor: 'A', type: 'playItem', card: 'es' }]);

    expect(res.state.players.A.active!.energy.map(e => e.iid)).toEqual([]);
    expect(res.state.players.A.bench[0].energy.map(e => e.iid)).toEqual(['e0']);
    expect(res.pending?.descriptor ?? '').not.toContain('Move energy');
  });

  it('does NOT collapse when two destinations are legal', () => {
    const res = step(energySwitchBoard(), [{ actor: 'A', type: 'playItem', card: 'es' }]);

    expect(res.pending!.descriptor).toContain('Move energy');
    expect(res.pending!.legalActions.filter(a => a.type === 'moveEnergy').length).toBe(2);
    expect(res.state.players.A.active!.energy.map(e => e.iid)).toEqual(['e0']);
  });

  /**
   * ⚠️ The scope boundary, pinned on the HOOK rather than on a board — and the reason is worth the
   * comment, because it is a limit on this guard rather than a feature of it.
   *
   * Mutating the gate from `max === 1` to `true` does NOT red any board-level cell above, and after
   * looking for a board that would kill it I do not believe one exists for this decomposer. Sources
   * and destinations are enumerated against the STABLE pause-state and only `pickedKeys` changes
   * between steps, so "exactly one legal (card, destination) pair at this step" implies zero pairs at
   * the next: for move-energy, step-forced entails decision-forced. And where `max > min` the
   * decomposer appends `END_CHOICE`, which makes `forced.length === 1` false before the gate is even
   * consulted. So the widened gate is very likely EQUIVALENT on every reachable board — which means a
   * board-level boundary cell here would be red-by-construction-free, i.e. no evidence at all.
   *
   * `max === 1` is kept anyway: it is what the decomposer contract and the driver's comment both
   * DECLARE, and a declared scope that a future edit can widen silently is worth one assertion. This
   * cell pins the declaration. It does not claim the wider gate is behaviourally wrong.
   */
  it('DECLARES its scope: a multi-transfer prompt is not atomicResolvable, whatever a board shows', () => {
    const opts = (max: number | undefined) => ({
      options: { allowCancel: true, min: 1, max, blockedFrom: [], blockedTo: [], blockedMap: [] },
    } as unknown as MoveEnergyPrompt);

    expect(moveEnergyDecomposer.atomicResolvable!(opts(1), null as unknown as State)).toBe(true);
    expect(moveEnergyDecomposer.atomicResolvable!(opts(2), null as unknown as State)).toBe(false);
    expect(moveEnergyDecomposer.atomicResolvable!(opts(undefined), null as unknown as State)).toBe(false);
  });
});
