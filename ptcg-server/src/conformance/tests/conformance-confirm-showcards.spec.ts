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

  // CF-18 (proposed 2026-07-12): a `ShowCardsPrompt` is a PUBLIC reveal. Auto-acking it (above) still
  // drives past, but it now ALSO externalizes a first-class `reveal{owner, cards, from, to}` event so
  // the reveal reaches the wire (previously it was silently dropped — RE-26 family). `owner`/`from` are
  // attributed from the card's actual zone at show time; the prompt's playerId is the AUDIENCE, not the
  // owner. This is the discriminating repro: RED before the driver emitted `reveal`, GREEN after.
  it('CF-18: ShowCardsPrompt emits a public `reveal` event (owner from card zone, ordered iids, to:all)', () => {
    const state = board();
    state.players.A.hand = [{ iid: 'A-h1', printing: WATER }]; // the card A "found" and put into hand
    const game = importState(state);
    const revealed = game.state.players[0].hand.cards;         // owned by A, sitting in A's hand
    // B is the audience ("cards shown by the opponent"); A owns the revealed card.
    game.store.prompt(game.state, new ShowCardsPrompt(game.state.players[1].id,
      GameMessage.CARDS_SHOWED_BY_THE_OPPONENT, revealed), () => { });

    const res = replay(game, []);
    expect(res.events.filter(e => e.kind === 'reveal')).toEqual([
      { kind: 'reveal', owner: 'A', cards: ['A-h1'], from: 'hand', to: 'all' },
    ]);
    expect(res.pending!.descriptor).toBe('main'); // still drives past; reveal is an event, not a pending
  });

  it('CF-18: `reveal.from` reflects the actual source zone (deck-top reveal)', () => {
    const state = board();
    state.players.A.deck = [{ iid: 'A-d1', printing: WATER }]; // revealed while still on top of A's deck
    const game = importState(state);
    game.store.prompt(game.state, new ShowCardsPrompt(game.state.players[1].id,
      GameMessage.CARDS_SHOWED_BY_THE_OPPONENT, game.state.players[0].deck.cards), () => { });

    expect(replay(game, []).events.filter(e => e.kind === 'reveal')).toEqual([
      { kind: 'reveal', owner: 'A', cards: ['A-d1'], from: 'deck', to: 'all' },
    ]);
  });

  it('CF-18: an empty ShowCardsPrompt emits reveal{cards: []} — the empty show IS observable [TA-153]', () => {
    // SUPERSEDES the original "(nothing observable)" pin, which was asserted, not adjudicated. An
    // empty show is observable: the audience learns the zone is EMPTY, which is real information
    // ("reveals their hand" then doing 0 damage is *why*). Same discriminator as CF-9/TA-126 — the
    // instruction executes even over zero objects — and the shape rotomancer emits (measured on
    // Wondrous Cotton wht-005 the day the CF-18 gate first fired). The harness eventKey omits an
    // empty cards list, so `cards: []` keys identically to roto's absent-cards spelling.
    const game = importState(board()); // board() hands are empty
    const a = game.state.players[0];
    game.store.prompt(game.state, new ShowCardsPrompt(game.state.players[1].id,
      GameMessage.CARDS_SHOWED_BY_THE_OPPONENT, a.hand.cards), () => { });
    expect(replay(game, []).events.filter(e => e.kind === 'reveal')).toEqual([
      { kind: 'reveal', owner: 'A', cards: [], from: 'hand', to: 'all' },
    ]);
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
