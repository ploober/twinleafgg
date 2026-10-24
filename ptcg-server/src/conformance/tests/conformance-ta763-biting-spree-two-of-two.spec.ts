import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-763 — Biting Spree dri-122 / dri-217 / dri-234 / dri-242 (Team Rocket's Crobat ex): "you may put 2 damage counters
 * on 2 of your opponent's Pokémon." Two Pokémon, not "up to" two: the pick is min 2 (as many as the opponent has, up to
 * 2), so with exactly two it has no decision (CF-14 addendum, TA-416: an N-of-exactly-N pick collapses) and with three
 * the second pick offers no stop. The script picked min 1, so the pick was asked and could stop after one.
 * Mutation guard: min back to 1 -> the two-Pokémon cell sees the placeCounter pick, the three-Pokémon cell a stop.
 */

/** The spec cell labels, literal so the registry can read them (one per printing and cell). */
const CELLS: Record<string, string> = {
  'dri-122': '[TA-763 dri-122]',
  'dri-122 three': '[TA-763 dri-122 three]',
  'dri-217': '[TA-763 dri-217]',
  'dri-217 three': '[TA-763 dri-217 three]',
  'dri-234': '[TA-763 dri-234]',
  'dri-234 three': '[TA-763 dri-234 three]',
  'dri-242': '[TA-763 dri-242]',
  'dri-242 three': '[TA-763 dri-242 three]',
};

const WATER = 'sve-003', FILLER = 'asc-004', GOLBAT = 'dri-121';

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


for (const printing of ['dri-122', 'dri-217', 'dri-234', 'dri-242']) {
  describe(`TA-763 — Biting Spree ${printing} on 2 of the opponent's Pokémon`, () => {
    const board = (bench: number) => state(
      player('a', { active: pip([{ iid: 'a1s0', printing: GOLBAT }]), hand: [{ iid: 'ah0', printing }] }),
      player('b', {
        active: pip([{ iid: 'b1s0', printing: FILLER }]),
        bench: Array.from({ length: bench }, (_, i) => pip([{ iid: `bb${i + 1}s0`, printing: FILLER }])),
      }),
    );
    const go = [
      { actor: 'A', type: 'evolve', card: 'ah0', target: 'a1s0' },
      { actor: 'A', type: 'confirm', value: true },
    ] as unknown as NeutralAction[];

    it(`exactly two: no pick, 2 counters on each ${CELLS[printing + '']}`, () => {
      const r = step(board(1), go);
      expect(r.status).not.toBe('invalidAction');
      expect(offered(r).some(a => a.type === 'placeCounter')).toBe(false);
      expect(r.state.players.B.active?.damage).toBe(20);
      expect(r.state.players.B.bench[0].damage).toBe(20);
    });
    it(`three: the second pick offers no stop ${CELLS[printing + ' three']}`, () => {
      const r = step(board(2), [...go, { actor: 'A', type: 'placeCounter', target: 'b1s0' } as unknown as NeutralAction]);
      expect(r.status).not.toBe('invalidAction');
      const acts = offered(r) as Array<La & { value?: boolean }>;
      expect(acts.filter(a => a.type === 'placeCounter').map(a => a.target).sort()).toEqual(['bb1s0', 'bb2s0']);
      expect(acts.some(a => a.type === 'confirm' && a.value === false)).toBe(false);
    });
  });
}
