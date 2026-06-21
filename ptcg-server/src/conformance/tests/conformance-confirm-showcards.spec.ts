import { importState } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION,
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { Card } from '../../game/store/card/card';
import { Prompt } from '../../game/store/prompts/prompt';
import { ShowCardsPrompt } from '../../game/store/prompts/show-cards-prompt';
import { ConfirmCardsPrompt } from '../../game/store/prompts/confirm-cards-prompt';
import { AlertPrompt } from '../../game/store/prompts/alert-prompt';
import { ConfirmPrompt } from '../../game/store/prompts/confirm-prompt';

/**
 * Reveal / single-acknowledgement prompts (`Prompt<true>` — `Show cards`, `Confirm cards`, `Alert`)
 * carry no branch, so the contract REQUIRES they auto-resolve (never surface, consume no action). The
 * driver classifies them as `wait` and resolves with `true`. `ConfirmPrompt` ('Confirm',
 * `Prompt<boolean>`) is the *genuine* yes/no — it decomposes to two `confirm{value}` legalActions and
 * resolves to the chosen boolean. (twinleaf has BOTH 'Confirm cards' (ack) and 'Confirm' (yes/no).)
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

  // Every `Prompt<true>` reveal/ack type auto-resolves identically (never surfaces, consumes no action).
  const REVEAL_ACK: Array<{ name: string; make: (pid: number, cards: Card[]) => Prompt<true> }> = [
    { name: 'Show cards', make: (pid, cards) => new ShowCardsPrompt(pid, GameMessage.CARDS_SHOWED_BY_THE_OPPONENT, cards) },
    { name: 'Confirm cards', make: (pid, cards) => new ConfirmCardsPrompt(pid, GameMessage.CARDS_SHOWED_BY_THE_OPPONENT, cards) },
    { name: 'Alert', make: (pid) => new AlertPrompt(pid, GameMessage.CARDS_SHOWED_BY_THE_OPPONENT) },
  ];
  REVEAL_ACK.forEach(({ name, make }) => {
    it(`${name} auto-resolves (reveal/ack): callback fires, driver drives past, never surfaces`, () => {
      const game = importState(board());
      const p = game.state.players[0];
      let acknowledged = false;
      game.store.prompt(game.state, make(p.id, p.hand.cards), () => { acknowledged = true; });

      const res = replay(game, []); // no action needed — reveal/ack prompts are auto-resolved
      expect(acknowledged).toBe(true);       // the reveal/ack callback fired
      expect(res.pending).not.toBeNull();    // drove past to A's main-phase menu
      expect(res.pending!.descriptor).toBe('main');
    });
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
