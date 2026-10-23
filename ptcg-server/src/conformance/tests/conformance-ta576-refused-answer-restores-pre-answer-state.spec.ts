import { step } from '../driver';
import { ConfirmPrompt, GameError, GameMessage, State, StoreLike } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { WAS_TRAINER_USED } from '../../game/store/prefabs/trainer-prefabs';
import { PuzzleOfTime } from '../../sets/07-x-and-y/set-breakpoint/puzzle-of-time';
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
 *
 * Since the 2026-10-22 upstream merge no card refuses an offered answer after moving a card (upstream's Custom Catcher
 * rewrite, 852e712eb, plays both; a scan of every card's prompt callbacks finds no reachable move-then-throw). The
 * fix is in the driver, not a card, so the cell injects the refusal: Puzzle of Time bkp-109's handler is replaced by
 * one that asks a confirm and, on true, moves the second copy to the discard pile and throws.
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

const yes = { actor: 'A', type: 'confirm', value: true } as never;
const iids = (zone: CardRef[] | undefined) => (zone ?? []).map(c => c.iid);

describe('TA-576: a prompt answer the card refuses leaves the board as it was before the answer', () => {
  it('injected refusal: a confirm true that moves a card and then throws is rejected with the board at the confirm [TA-576]', () => {
    const original = PuzzleOfTime.prototype.reduceEffect;
    spyOn(PuzzleOfTime.prototype, 'reduceEffect').and.callFake(function (this: PuzzleOfTime, store: StoreLike, state: State, effect: Effect): State {
      if (!WAS_TRAINER_USED(effect, this)) {
        return original.call(this, store, state, effect);
      }
      const player = effect.player;
      return store.prompt(state, new ConfirmPrompt(player.id, GameMessage.WANT_TO_PLAY_BOTH_CARDS_AT_ONCE), yes => {
        if (yes) {
          player.hand.moveCardTo(player.hand.cards[0], player.discard);
          throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
        }
      });
    });
    const puzzles = board();
    puzzles.players.A.hand = [{ iid: 'pt1', printing: 'bkp-109' }, { iid: 'pt2', printing: 'bkp-109' }];
    const playPuzzle = { actor: 'A', type: 'playItem', card: 'pt1' } as never;

    const before = step(puzzles, [playPuzzle]);
    expect(before.status).toBe('awaitingAction');
    expect(before.pending?.legalActions).toContain(yes);

    const r = step(puzzles, [playPuzzle, yes]);
    expect(r.status).toBe('invalidAction');
    expect(r.index).toBe(1);
    expect(iids(r.state.players.A.hand)).toEqual(['pt2']);
    expect(iids(r.state.players.A.discard)).toEqual([]);
    expect(iids(r.state.players.A.resolving)).toEqual(['pt1']);
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
