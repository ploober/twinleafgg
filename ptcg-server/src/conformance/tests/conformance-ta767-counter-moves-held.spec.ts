import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-767 (B.118, owner 2026-10-23: counter MOVES follow B.98) — an attack that moves damage counters chooses every move
 * first and the counters move after the last pick or the stop, all at once. Strange Hacking twm-082 (Alakazam) and
 * Damage Collection tef-107 (Sableye): the engine already applies the transfers when the prompt resolves, but the
 * adapter's mid-pick projection moved each counter at its pick (B.80's projection, which B.118 overrides for an attack).
 * The counter-move event kind B.118 also asks for is not in the contract yet: nothing is emitted for it here.
 * Mutation guard: drop the attack hold in move-damage.ts fixupProjection -> the mid-pick cells see the counters moved.
 */

const PSYCHIC = 'sve-005', DARK = 'sve-007', WATER = 'sve-003', FILLER = 'asc-004';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    flags: flags(), ...over,
  };
}
function state(A: PlayerState, B: PlayerState): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}
type La = { type: string; target?: string; actor?: string };
const offered = (r: ReturnType<typeof step>): La[] => (r.pending?.legalActions ?? []) as unknown as La[];

const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as unknown as NeutralAction);
const place = (target: string) => ({ actor: 'A', type: 'placeCounter', target } as unknown as NeutralAction);
const stop = { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction;
const dmg = (p: PokemonInPlay, d: number): PokemonInPlay => ({ ...p, damage: d });
const opp = () => player('b', {
  active: dmg(pip([{ iid: 'b1s0', printing: FILLER }]), 20),
  bench: [dmg(pip([{ iid: 'bb1s0', printing: FILLER }]), 10), dmg(pip([{ iid: 'bb2s0', printing: FILLER }]), 30)],
});
const damages = (r: ReturnType<typeof step>) => {
  const B = r.state.players.B;
  return [B.active?.damage, ...B.bench.map(p => p.damage)];
};

describe('TA-767 — Damage Collection tef-107 (Sableye) moves the counters after the last pick', () => {
  const board = () => state(
    player('a', { active: pip([{ iid: 'a1s0', printing: 'tef-107' }], [{ iid: 'a1e0', printing: DARK }, { iid: 'a1e1', printing: DARK }]) }),
    opp(),
  );
  const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Damage Collection' } as unknown as NeutralAction;

  it('after the first move is picked, the next pick pends and no counter has moved [TA-767 tef-107]', () => {
    const r = step(board(), [declare, choose('bb1s0')]);
    expect(r.pending).toBeTruthy();
    expect(offered(r).some(a => a.type === 'choose')).toBe(true);
    expect(damages(r)).toEqual([20, 10, 30]);
  });
  it('the stop: every chosen move is applied [TA-767 tef-107 stop]', () => {
    const r = step(board(), [declare, choose('bb1s0'), stop]);
    expect(r.status).not.toBe('invalidAction');
    expect(damages(r)).toEqual([30, 0, 30]);
  });
});

describe('TA-767 — Strange Hacking twm-082 (Alakazam) moves the counters after the last pick', () => {
  const board = () => state(
    player('a', { active: pip([{ iid: 'a1s0', printing: 'twm-082' }], [{ iid: 'a1e0', printing: PSYCHIC }]) }),
    opp(),
  );
  const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Strange Hacking' } as unknown as NeutralAction;

  it('after one move (b1s0 -> bb1s0) the next pick pends and no counter has moved [TA-767 twm-082]', () => {
    const r = step(board(), [declare, choose('b1s0'), place('bb1s0')]);
    expect(r.pending).toBeTruthy();
    expect(offered(r).some(a => a.type === 'choose')).toBe(true);
    expect(damages(r)).toEqual([20, 10, 30]);
  });
  it('the stop: the move is applied [TA-767 twm-082 stop]', () => {
    const r = step(board(), [declare, choose('b1s0'), place('bb1s0'), stop]);
    expect(r.status).not.toBe('invalidAction');
    expect(damages(r)).toEqual([10, 20, 30]);
  });
});
