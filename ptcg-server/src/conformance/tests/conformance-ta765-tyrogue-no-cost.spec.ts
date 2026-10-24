import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-765 — Tyrogue meg-071: the printed Pow-Pow Punching has no Energy cost (golden card data, card-data/final/meg.json:
 * cost []); twinleaf had [C], so the attack was not offered with no Energy attached. A data fix; this cell guards it.
 * Mutation guard: cost back to [C] -> the attack is not offered.
 */

const WATER = 'sve-003', FILLER = 'asc-004';

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


describe('TA-765 — Tyrogue meg-071 Pow-Pow Punching costs nothing', () => {
  it('with no Energy attached the attack is offered [TA-765 meg-071]', () => {
    const r = step(state(
      player('a', { active: pip([{ iid: 'a1s0', printing: 'meg-071' }]) }),
      player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]) }),
    ), []);
    const acts = offered(r) as Array<La & { name?: string; source?: string }>;
    expect(acts.some(a => a.type === 'declareAttack' && a.name === 'Pow-Pow Punching')).toBe(true);
  });
});
