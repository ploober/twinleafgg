import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// Follow-up decomposers (impl §8 M5(d)): ChooseEnergyPrompt (retreat / energy-cost payment) and
// ChooseAttackPrompt (copy/disable attacks). Both previously surfaced in the menu but threw on
// dispatch; these specs drive each end-to-end through step().

const PSY = 'Psychic Energy SVE';
const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT'; // "Memory Skip" [P] 10 dmg (disables an opponent attack); retreat [C]

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

/** Active Ralts with two different energies (so retreat [C] needs a real choice) + a bench to promote. */
function retreatBoard(): NeutralState {
  return board(
    player({ active: pip('A-act', RALTS, [{ iid: 'e0', printing: PSY }, { iid: 'e1', printing: WATER }]), bench: [pip('A-b0', RALTS)] }),
    player({ active: pip('B-act', RALTS) }),
  );
}

describe('ChooseEnergyPrompt decomposer — retreat payment', () => {

  it('surfaces the energy choice as a pending when the log is dry', () => {
    const res = step(retreatBoard(), [{ actor: 'A', type: 'retreat', to: 0 }]);

    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.actor).toBe('A');
    expect(res.pending!.descriptor).toContain('Choose energy');
    expect(res.pending!.legalActions).toContain({ type: 'chooseEnergy', card: 'e0' });
    expect(res.pending!.legalActions).toContain({ type: 'chooseEnergy', card: 'e1' });
  });

  it('pays the cost with the chosen energy and completes the retreat', () => {
    const res = step(retreatBoard(), [
      { actor: 'A', type: 'retreat', to: 0 },
      { actor: 'A', type: 'chooseEnergy', card: 'e1' }, // pay [C] with the Water energy
    ]);

    expect(res.status).toBe('awaitingAction');
    // The bench Ralts is promoted to active; the former active retreats to the bench.
    expect(res.state.players.A.active!.stack[0].iid).toBe('A-b0');
    // The chosen energy was discarded; the other stays attached to the (now benched) Ralts.
    expect(res.state.players.A.discard.map(c => c.iid)).toContain('e1');
    const benched = res.state.players.A.bench.find(b => b.stack[0].iid === 'A-act');
    expect(benched!.energy.map(c => c.iid)).toEqual(['e0']);
  });

  it('replays the retreat-payment deterministically', () => {
    const actions: NeutralAction[] = [
      { actor: 'A', type: 'retreat', to: 0 },
      { actor: 'A', type: 'chooseEnergy', card: 'e0' },
    ];
    const a = step(retreatBoard(), actions);
    const b = step(retreatBoard(), actions);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });
});

describe('ChooseAttackPrompt decomposer — Memory Skip', () => {

  /** A's Ralts (with [P]) attacks; Memory Skip then picks one of B's attacks to disable. */
  function memorySkipBoard(): NeutralState {
    return board(
      player({ active: pip('A-act', RALTS, [{ iid: 'e0', printing: PSY }]) }),
      player({ active: pip('B-act', RALTS) }),
    );
  }

  it('surfaces the attack choice as a pending when the log is dry', () => {
    const res = step(memorySkipBoard(), [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Memory Skip' }]);

    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.actor).toBe('A');
    expect(res.pending!.descriptor).toContain('Choose attack');
    expect(res.pending!.legalActions).toContain({ type: 'chooseAttack', source: 'B-act', name: 'Memory Skip' });
  });

  it('resolves the chosen attack; the attack deals its damage and auto-ends the turn', () => {
    const res = step(memorySkipBoard(), [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Memory Skip' },
      { actor: 'A', type: 'chooseAttack', source: 'B-act', name: 'Memory Skip' },
    ]);

    expect(res.state.players.B.active!.damage).toBe(10); // Memory Skip's 10 damage
    expect(res.state.activePlayer).toBe('B');            // the attack auto-ended A's turn
  });
});
