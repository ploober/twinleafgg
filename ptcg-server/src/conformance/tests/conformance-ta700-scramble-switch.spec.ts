import { step } from '../driver';
import {
  NeutralState, NeutralAction, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-700 (B.80 / B.81): Scramble Switch ssp-186 — "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do,
 * you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon."
 *
 * The text's order is the move's order: the switch happens, THEN the Energy move is offered from the Pokémon now on
 * the Bench to the new Active. The engine used to raise the Energy prompt over the still-Active old Pokémon and switch
 * only at the prompt's close, so the wire projected the pre-switch board at the Energy-move pending (the Energy
 * addressed on A.active, no `moved` legs, `choose` instead of `moveEnergy`). B.80: the wire shows a card where it
 * physically is; B.81: per-pick board truth implies per-pick event truth. Board = fz-tr-bench-ssp-186
 * (results/fuzz-20261010-full/corpus): one Energy on the Active, two Benched.
 */

const SCRAMBLE = 'ssp-186';
const BELLSPROUT = 'asc-004';
const E = ['sve-001', 'sve-002', 'sve-003', 'sve-004', 'sve-005'];

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function basic(iid: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing: BELLSPROUT }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: E[0], faceUp: false }));
}
function deck(tag: string, start: number): CardRef[] {
  const printings = [...E, ...E, BELLSPROUT, BELLSPROUT, BELLSPROUT, 'por-083', 'por-083'];
  return printings.map((printing, i) => ({ iid: `${tag}${start + i}`, printing }));
}

function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: basic('a1', [{ iid: 'ae20', printing: E[2] }]), bench: [basic('ab1'), basic('ab2')],
        hand: [{ iid: 'ah4', printing: SCRAMBLE }, { iid: 'ah1', printing: E[0] }, { iid: 'ah2', printing: E[4] }, { iid: 'ah3', printing: BELLSPROUT }],
        deck: deck('ad', 5), prizes: prizes('ap', 6),
      }),
      B: player({
        active: basic('b1', [{ iid: 'be19', printing: E[2] }]), bench: [basic('bb1'), basic('bb2')],
        hand: [{ iid: 'bh1', printing: E[0] }, { iid: 'bh2', printing: E[4] }, { iid: 'bh3', printing: BELLSPROUT }],
        deck: deck('bd', 4), prizes: prizes('bp', 6),
      }),
    },
  };
}

const PLAY = { actor: 'A', type: 'playItem', card: 'ah4' } as unknown as NeutralAction;
const PROMOTE = { actor: 'A', type: 'promoteBench', target: 'ab1' } as unknown as NeutralAction;
// TA-786 / SR-6: ab1 is the one destination, so the Energy is offered alone (choose, recipient ab1).
const MOVE = { actor: 'A', type: 'choose', target: 'ae20' } as unknown as NeutralAction;
const STOP = { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction;

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;
function legs(events: NeutralEvent[], iid: string): string[] {
  const loc = (l: { zone: string; pokemon?: string; role?: string }) => l.pokemon ? `${l.zone}:${l.pokemon}:${l.role}` : l.zone;
  return events.filter((e): e is Moved => e.kind === 'moved' && (e as Moved).card === iid)
    .map(e => `${loc(e.origin)}>${loc(e.destination)}:${e.visibility}`);
}

describe('TA-700 Scramble Switch ssp-186: the switch is projected (and its legs emitted) at the Energy-move pending; the move is offered as moveEnergy from the Benched old Active to the new Active (B.80 / B.81)', () => {
  it('after the Bench pick the switch has happened: ab1 is Active with no Energy, a1 is Benched carrying ae20 [TA-700 ssp-186]', () => {
    const res = step(board(), [PLAY, PROMOTE]);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending?.actor).toBe('A');
    const A = res.state.players.A;
    expect(A.active?.stack[0].iid).withContext('the new Active').toBe('ab1');
    expect(A.active?.energy).toEqual([]);
    expect(A.bench.map(b => b.stack[0].iid)).toEqual(['a1', 'ab2']);
    expect(A.bench[0].energy.map(c => c.iid)).withContext('the Energy rode with the old Active to the Bench').toEqual(['ae20']);
  });

  // TA-786 / SR-6: the one destination is the new Active, so the Energy is offered alone with recipient ab1 (not the
  // moveEnergy triple, and not TA-700's old choose addressed on A.active with no recipient).
  it('the pending offers choose {ae20, recipient ab1} and the stop, no moveEnergy [TA-700 ssp-186] [TA-786 ssp-186]', () => {
    const res = step(board(), [PLAY, PROMOTE]);
    const actions = (res.pending?.legalActions ?? []) as Array<{ type: string; target?: string; recipient?: string; value?: boolean }>;
    expect(actions.filter(a => a.type === 'choose').map(a => ({ target: a.target, recipient: a.recipient })))
      .toEqual([{ target: 'ae20', recipient: 'ab1' }]);
    expect(actions.some(a => a.type === 'confirm' && a.value === false)).withContext('"any amount" includes none').toBe(true);
    expect(actions.some(a => a.type === 'moveEnergy')).toBe(false);
  });

  it('the switch\'s moved legs are emitted at the pending: ab1 bench -> active, a1 active -> bench, ae20 riding active:a1 -> bench:a1 (B.81) [TA-700 ssp-186]', () => {
    const res = step(board(), [PLAY, PROMOTE]);
    expect(legs(res.events, 'ab1')).toEqual(['bench:ab1:pokemon>active:ab1:pokemon:public']);
    expect(legs(res.events, 'a1')).toEqual(['active:a1:pokemon>bench:a1:pokemon:public']);
    expect(legs(res.events, 'ae20')).toEqual(['active:a1:energy>bench:a1:energy:public']);
  });

  it('moving the only Energy completes the decision (nothing is left to move; rotomancer closes it too): ae20 is on the new Active, one leg bench:a1 -> active:ab1; the Item is discarded [TA-700 ssp-186]', () => {
    const res = step(board(), [PLAY, PROMOTE, MOVE]);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending?.actor).toBe('A');
    expect((res.pending?.legalActions ?? []).some(a => a.type === 'moveEnergy' || a.type === 'choose')).toBe(false);
    const A = res.state.players.A;
    expect(A.active?.stack[0].iid).toBe('ab1');
    expect(A.active?.energy.map(c => c.iid)).toEqual(['ae20']);
    expect(A.bench[0].stack[0].iid).toBe('a1');
    expect(A.bench[0].energy).toEqual([]);
    expect(A.discard.map(c => c.iid)).toContain('ah4');
    expect(A.resolving).toEqual([]);
    expect(legs(res.events, 'ae20')).toEqual(['active:a1:energy>bench:a1:energy:public', 'bench:a1:energy>active:ab1:energy:public']);
  });

  it('declining the move: the switch stands and the Energy stays on the Benched old Active [TA-700 ssp-186]', () => {
    const res = step(board(), [PLAY, PROMOTE, STOP]);
    expect(res.status).toBe('awaitingAction');
    const A = res.state.players.A;
    expect(A.active?.stack[0].iid).toBe('ab1');
    expect(A.active?.energy).toEqual([]);
    expect(A.bench[0].stack[0].iid).toBe('a1');
    expect(A.bench[0].energy.map(c => c.iid)).toEqual(['ae20']);
    expect(A.discard.map(c => c.iid)).toContain('ah4');
  });
});
