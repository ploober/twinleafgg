import { step } from '../driver';
import { classify } from '../decomposers';
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

/** Active Ralts holding one basic Water Energy + a bench Ralts to receive it; Energy Switch in hand. */
function energySwitchBoard(): NeutralState {
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
    // the source energy e0 may move to the bench Ralts (A-b0), not back onto its own active
    expect(res.pending!.legalActions.some(a =>
      a.type === 'moveEnergy' && a.card === 'e0' && (a as { source?: string }).source === 'A-act' && a.target === 'A-b0')).toBe(true);
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
});
