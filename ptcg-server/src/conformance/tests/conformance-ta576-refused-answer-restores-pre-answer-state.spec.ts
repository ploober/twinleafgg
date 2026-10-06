import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-576: a prompt answer that the resolving card refuses (throws a GameError) is a rejected action, and a rejected
 * action's state is the state before it. Store.reduce restores its own snapshot for a top-level action, but
 * Store.reducePrompt cannot: the answered prompt's continuation has already run (and is consumed) when the card
 * throws, so whatever it moved first stays moved.
 *
 * Witness: Custom Catcher lot-171 (twinleaf's card refuses the two-card play when its own player has no Bench, see
 * OOP-109) with three copies in hand and an opponent's Bench. playItem cc1 opens "play both?"; confirm true moves the
 * second copy to the discard pile and then throws CANNOT_PLAY_THIS_CARD. The rejection used to report cc2 in the
 * discard pile; it must report the board at the confirm: hand [cc2, cc3], cc1 resolving, discard empty.
 */

const FILL = 'sve-003';

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
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, FILL).map(c => ({ ...c, faceUp: false }));
}
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', 'sit-060'),
        hand: [{ iid: 'cc1', printing: 'lot-171' }, { iid: 'cc2', printing: 'lot-231' }, { iid: 'cc3', printing: 'lot-171' }],
        deck: cards('ad', 6, FILL), prizes: prizes('ap', 6),
      }),
      B: player({ active: mon('b1', 'sit-060'), bench: [mon('bb1', 'sit-061')], deck: cards('bd', 6, FILL), prizes: prizes('bp', 6) }),
    },
  };
}

const play = { actor: 'A', type: 'playItem', card: 'cc1' } as never;
const yes = { actor: 'A', type: 'confirm', value: true } as never;
const iids = (zone: CardRef[] | undefined) => (zone ?? []).map(c => c.iid);

describe('TA-576: a prompt answer the card refuses leaves the board as it was before the answer', () => {
  it('Custom Catcher confirm true refused: the rejection state is the board at the confirm [TA-576]', () => {
    const before = step(board(), [play]);
    expect(before.status).toBe('awaitingAction');
    expect(before.pending?.legalActions).toContain(yes);

    const r = step(board(), [play, yes]);
    expect(r.status).toBe('invalidAction');
    expect(r.index).toBe(1);
    expect(iids(r.state.players.A.hand)).toEqual(['cc2', 'cc3']);
    expect(iids(r.state.players.A.discard)).toEqual([]);
    expect(iids(r.state.players.A.resolving)).toEqual(['cc1']);
    // The whole rejection state is the pre-answer state, and the refused answer emits nothing of its own.
    expect(r.state).toEqual(before.state);
    expect(r.events).toEqual(before.events);
  });

  it('CONTROL: a refused top-level action (retreat with no Bench) still reports the pre-action board', () => {
    const r = step(board(), [{ actor: 'A', type: 'retreat', to: 'bb1' } as never]);
    expect(r.status).toBe('invalidAction');
    expect(r.index).toBe(0);
    expect(iids(r.state.players.A.hand)).toEqual(['cc1', 'cc2', 'cc3']);
    expect(r.events).toEqual([]);
  });
});
