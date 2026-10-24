import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-761 — Call for Family par-004 (Pansage) and twm-036 (Litwick): "Search your deck for a Basic Pokémon and put it
 * onto your Bench. Then, shuffle your deck." A search for a category may find nothing (#903), so the pick offers the
 * stop (Panpour par-041's shape, min 0). Both scripts searched with min 1.
 * Mutation guard: min back to 1 on either card -> its cell sees no `confirm {value: false}`.
 */

const WATER = 'sve-003', FIRE = 'sve-002', GRASS = 'sve-001', FILLER = 'asc-004';

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


for (const [printing, energy] of [['par-004', GRASS], ['twm-036', FIRE]] as const) {
  describe(`TA-761 — Call for Family ${printing} may find nothing`, () => {
    const board = () => state(
      player('a', {
        active: pip([{ iid: 'a1s0', printing }], [{ iid: 'a1e0', printing: energy }]),
        deck: [{ iid: 'ad0', printing: FILLER }, { iid: 'ad1', printing: WATER }, { iid: 'ad2', printing: WATER }],
      }),
      player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]) }),
    );
    const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Call for Family' } as unknown as NeutralAction;

    it(`the pick offers the Basic Pokémon and the stop [TA-761 ${printing}]`, () => {
      const r = step(board(), [declare]);
      const acts = offered(r) as Array<La & { value?: boolean }>;
      expect(acts.some(a => a.target === 'ad0')).toBe(true);
      expect(acts.some(a => a.type === 'confirm' && a.value === false)).toBe(true);
    });
    it(`the stop: nothing is benched and the deck is shuffled [TA-761 ${printing} stop]`, () => {
      const r = step(board(), [declare, { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction]);
      expect(r.status).not.toBe('invalidAction');
      expect(r.state.players.A.bench).toEqual([]);
      const shuffled = (r.events ?? []).some(e => (e as { kind: string }).kind === 'shuffled') || offered(r).some(a => a.type === 'shuffle');
      expect(shuffled).toBe(true);
    });
  });
}
