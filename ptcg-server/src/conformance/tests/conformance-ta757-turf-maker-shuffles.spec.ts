import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-757 — Turf Maker jtg-086 (Hop's Silicobra): "Search your deck for a Stadium card, reveal it, and put it into your
 * hand. Then, shuffle your deck." When a Stadium was found the script returned the reveal prompt and never shuffled.
 * Mutation guard: return the ShowCardsPrompt without the shuffle again -> the found-a-Stadium cell sees no shuffle.
 */

const WATER = 'sve-003', FILLER = 'asc-004', STADIUM = 'jtg-150';

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

const shuffledA = (r: ReturnType<typeof step>): boolean =>
  (r.events ?? []).some(e => (e as { kind: string; player?: string; owner?: string }).kind === 'shuffled')
  || offered(r).some(a => a.type === 'shuffle');

describe('TA-757 — Turf Maker jtg-086 shuffles the deck in both branches', () => {
  const board = () => state(
    player('a', {
      active: pip([{ iid: 'a1s0', printing: 'jtg-086' }], [{ iid: 'a1e0', printing: WATER }]),
      deck: [{ iid: 'ad0', printing: WATER }, { iid: 'stad', printing: STADIUM }, { iid: 'ad2', printing: WATER }, { iid: 'ad3', printing: WATER }],
    }),
    player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]) }),
  );
  const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Turf Maker' } as unknown as NeutralAction;

  it('the Stadium found: it is in the hand and the deck is shuffled [TA-757 jtg-086]', () => {
    const r = step(board(), [declare, { actor: 'A', type: 'choose', target: 'stad' } as unknown as NeutralAction]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.A.hand.map(c => c.iid)).toContain('stad');
    expect(shuffledA(r)).toBe(true);
  });
  it('nothing found: the deck is shuffled [TA-757 jtg-086 none]', () => {
    const r = step(board(), [declare, { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction]);
    expect(r.status).not.toBe('invalidAction');
    expect(shuffledA(r)).toBe(true);
  });
});
