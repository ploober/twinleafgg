import { importState } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION,
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { ShowCardsPrompt } from '../../game/store/prompts/show-cards-prompt';
import { ConfirmPrompt } from '../../game/store/prompts/confirm-prompt';

/**
 * `ShowCardsPrompt` ('Show cards', `Prompt<true>`) is a pure reveal/acknowledge — the driver
 * auto-resolves it with `true` (classified as `wait`), since the revealed cards are already in the
 * projection. `ConfirmPrompt` ('Confirm', `Prompt<boolean>`) is a genuine yes/no decision: it
 * decomposes to two `confirm{value}` legalActions and resolves to the chosen boolean (requires the
 * contract's `confirm` Action — type enum + `value` property).
 */

const RALTS = 'Ralts SIT';
const WATER = 'Water Energy SVE';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function ralts(iid: string): PokemonInPlay {
  return { stack: [{ iid, printing: RALTS }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(): NeutralState {
  const side = (tag: string): PlayerState =>
    player({ active: ralts(`${tag}-act`), prizes: [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }] });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: side('A'), B: side('B') },
  };
}

describe('Conformance — ShowCardsPrompt auto-resolve + ConfirmPrompt decomposer', () => {

  it('ShowCardsPrompt auto-resolves (pure reveal): the callback fires and the driver drives past', () => {
    const game = importState(board());
    const p = game.state.players[0];
    let acknowledged = false;
    game.store.prompt(game.state, new ShowCardsPrompt(p.id, GameMessage.CARDS_SHOWED_BY_THE_OPPONENT, p.hand.cards),
      () => { acknowledged = true; });

    const res = replay(game, []); // no action needed — 'Show cards' is auto-resolved
    expect(acknowledged).toBe(true);       // the reveal callback fired
    expect(res.pending).not.toBeNull();    // drove past to A's main-phase menu
    expect(res.pending!.descriptor).toBe('main');
  });

  /** A fresh game with an open ConfirmPrompt for player A (replay mutates, so each case re-imports). */
  function withConfirm(): { game: ReturnType<typeof importState>; answer: () => boolean | undefined } {
    const game = importState(board());
    const p = game.state.players[0];
    let answer: boolean | undefined;
    game.store.prompt(game.state, new ConfirmPrompt(p.id, GameMessage.WANT_TO_USE_ABILITY),
      (r: boolean) => { answer = r; });
    return { game, answer: () => answer };
  }

  it('ConfirmPrompt surfaces both confirm{value} answers as legalActions (actor injected)', () => {
    const c = withConfirm();
    const pending = replay(c.game, []).pending!;
    expect(pending.actor).toBe('A');
    expect(pending.legalActions).toEqual([
      { actor: 'A', type: 'confirm', value: true },
      { actor: 'A', type: 'confirm', value: false },
    ]);
  });

  it('ConfirmPrompt resolves to the chosen boolean (yes and no)', () => {
    const yes = withConfirm();
    replay(yes.game, [{ actor: 'A', type: 'confirm', value: true }]);
    expect(yes.answer()).toBe(true);

    const no = withConfirm();
    replay(no.game, [{ actor: 'A', type: 'confirm', value: false }]);
    expect(no.answer()).toBe(false);
  });
});
