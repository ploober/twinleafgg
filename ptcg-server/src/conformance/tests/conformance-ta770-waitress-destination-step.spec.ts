import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-770 (B.121, owner 2026-10-23; B.54 / CF-63, B.116) — Waitress asc-215 with a Bench: after the card pick the
 * destination step asks choose {target} only (op: attach, CF-70); the picked card is not restated. Twinleaf's adapter
 * offered attachEnergy {card: <the picked card>, target} pairs over the prompt it raises for the chosen card alone.
 * Mutation guard: drop the `single` plan in attach-energy.ts planStep -> the pairs come back.
 */

const GRASS = 'sve-001', WATER = 'sve-003', FILLER = 'asc-004';

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

type Act = { type: string; target?: string; card?: string; op?: string; value?: boolean };
const acts = (r: ReturnType<typeof step>): string[] => (offered(r) as Act[])
  .map(a => (a.type === 'confirm' ? `confirm:${a.value}` : `${a.type}:${a.card ? a.card + '>' : ''}${a.target}${a.op ? ':' + a.op : ''}`)).sort();
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as unknown as NeutralAction);
const opp = () => player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]) });

describe('TA-770 — Waitress asc-215 asks only the Pokémon after the card pick', () => {
  const board = () => state(
    player('a', {
      active: pip([{ iid: 'a1s0', printing: FILLER }]), bench: [pip([{ iid: 'ab1s0', printing: FILLER }])],
      hand: [{ iid: 'wt', printing: 'asc-215' }],
      deck: [{ iid: 'ad0', printing: GRASS }, { iid: 'ad1', printing: WATER }, ...Array.from({ length: 6 }, (_, i) => ({ iid: `adx${i}`, printing: FILLER }))],
    }),
    opp(),
  );
  const play = { actor: 'A', type: 'playSupporter', card: 'wt' } as unknown as NeutralAction;

  it('after choose ad0 the step is choose {target} over a1s0 / ab1s0 [TA-770 asc-215]', () => {
    expect(acts(step(board(), [play, choose('ad0')]))).toEqual(['choose:a1s0:attach', 'choose:ab1s0:attach']);
  });
  it('choosing ab1s0 attaches ad0 there [TA-770 asc-215 attached]', () => {
    const r = step(board(), [play, choose('ad0'), choose('ab1s0')]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.A.bench[0].energy.map(e => e.iid)).toEqual(['ad0']);
  });
});
