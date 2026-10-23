import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-748 — Lucian twm-157: "Each player shuffles their hand and puts it on the bottom of their deck. If either player
 * put any cards on the bottom of their deck in this way, each player flips a coin. If heads, that player draws 6
 * cards. If tails, they draw 3 cards."
 * The card shuffled each hand with an inline Math.random, so no `system` shuffle was ever pending and it sat in
 * EXCLUDED_RANDOM_CARDS. Iono's shape (TA-608, B.74): each hand's shuffle is a system shuffle of its bottom block, A's
 * then B's; then each player flips and draws. Mutation guard: restore the inline shuffle and the first cell reds.
 */

const FILL = 'sve-005';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: FILL }));
}
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing',
    stadium: null,
    players: {
      A: player({
        active: mon('a0', 'pal-090'), hand: [{ iid: 'luc', printing: 'twm-157' }, { iid: 'x0', printing: 'sve-001' }, { iid: 'x1', printing: 'sve-002' }],
        deck: cards('ad', 8), prizes: cards('ap', 3).map(c => ({ ...c, faceUp: false })),
      }),
      B: player({
        active: mon('b0', 'pal-090'), hand: [{ iid: 'y0', printing: 'sve-003' }, { iid: 'y1', printing: 'sve-004' }],
        deck: cards('bd', 8), prizes: cards('bp', 3).map(c => ({ ...c, faceUp: false })),
      }),
    },
  } as NeutralState;
}

const PLAY = { actor: 'A', type: 'playSupporter', card: 'luc' };
const shuffle = (order: string[]) => ({ actor: 'system', type: 'shuffle', order });
const flip = (face: 'heads' | 'tails') => ({ actor: 'system', type: 'flip', face });
const iids = (zone: CardRef[]) => zone.map(c => c.iid);

describe('TA-748: Lucian twm-157 shuffles each hand through a system shuffle', () => {
  it('playing Lucian pends the system shuffle of A\'s hand, before any flip [TA-748 twm-157]', () => {
    const r = step(board(), [PLAY as never]);
    expect(r.status).toBe('awaitingAction');
    expect(r.pending?.actor).toBe('system');
    expect(r.pending?.legalActions[0].type).toBe('shuffle');
  });

  it('each answered order lands on its deck bottom; heads draws 6, tails 3 [TA-748 twm-157 draws]', () => {
    const r = step(board(), [PLAY, shuffle(['x1', 'x0']), shuffle(['y1', 'y0']), flip('heads'), flip('tails')] as never[]);
    expect(r.pending?.descriptor).toBe('main');
    expect(r.state.players.A.hand.length).toBe(6);
    expect(r.state.players.B.hand.length).toBe(3);
    expect(iids(r.state.players.A.deck).slice(-2)).toEqual(['x1', 'x0']);
    expect(iids(r.state.players.B.deck).slice(-2)).toEqual(['y1', 'y0']);
  });
});
