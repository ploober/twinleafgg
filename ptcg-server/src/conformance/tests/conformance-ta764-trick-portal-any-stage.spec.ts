import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-764 — Trick Portal pbl-008 (Mega Delphox ex): "Look at the top 9 cards of your deck, and you may put any number of
 * Pokémon you find there onto your Bench." Any Pokémon, any Stage (#1592 Bubble Pod, #1782 Summoning Star, #2258
 * Grimsley's Move, #615 Spirit Burner: an effect that puts Pokémon onto the Bench takes any Stage). The script filtered
 * Basic Pokémon only.
 * Mutation guard: put back `stage: Stage.BASIC` -> Erika's Gloom is not offered.
 */

const FIRE = 'sve-002', WATER = 'sve-003', FILLER = 'asc-004', ODDISH = 'asc-001', GLOOM = 'asc-002';

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


describe('TA-764 — Trick Portal pbl-008 offers every Pokémon it finds, Evolutions included', () => {
  const board = () => state(
    player('a', {
      active: pip([{ iid: 'a1s0', printing: 'pbl-008' }], [{ iid: 'a1e0', printing: FIRE }]),
      deck: [{ iid: 'ad0', printing: ODDISH }, { iid: 'ad1', printing: GLOOM }, ...Array.from({ length: 10 }, (_, i) => ({ iid: `adw${i}`, printing: WATER }))],
    }),
    player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]) }),
  );
  const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Trick Portal' } as unknown as NeutralAction;

  it('the Basic and the Stage 1 are both offered, with the stop [TA-764 pbl-008]', () => {
    const r = step(board(), [declare]);
    const acts = offered(r) as Array<La & { value?: boolean }>;
    expect(acts.filter(a => a.target !== undefined).map(a => a.target).sort()).toEqual(['ad0', 'ad1']);
    expect(acts.some(a => a.type === 'confirm' && a.value === false)).toBe(true);
  });
  it('Erika\'s Gloom goes onto the Bench [TA-764 pbl-008 gloom]', () => {
    const r = step(board(), [declare, { actor: 'A', type: 'choose', target: 'ad1' } as unknown as NeutralAction,
      { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.A.bench.map(p => p.stack[0].iid)).toEqual(['ad1']);
  });
});
