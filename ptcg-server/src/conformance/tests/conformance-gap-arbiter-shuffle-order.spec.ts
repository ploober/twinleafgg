import { setupGame, loadAllSets } from '../../sets/tests/test-helpers';
import { Store } from '../../game/store/store';
import { StoreHandler } from '../../game/store/store-handler';
import { State } from '../../game/store/state/state';
import { Arbiter } from '../../game/core/arbiter';
import { AttackAction } from '../../game/store/actions/game-actions';
import { ResolvePromptAction } from '../../game/store/actions/resolve-prompt-action';
import { ShuffleDeckPrompt } from '../../game/store/prompts/shuffle-prompt';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { SuperType } from '../../game/store/card/card-types';

// GAP: arbiter shuffle runs ahead of an open search pick.
//
// Gimmighoul ssp-097 "Minor Errand-Running" [C]: "Search your deck for up to 2 Basic Energy cards,
// reveal them, and put them into your hand. Then, shuffle your deck." The printed order is: search
// (pick), THEN shuffle. The card file raises its ShuffleDeckPrompt OUTSIDE the ChooseCardsPrompt
// callback, so both prompts are unresolved at the same time.
//
// On the live server, Game.onStateChange -> Game.handleArbiterPrompts (game/core/game.ts) walks
// state.prompts, picks the FIRST unresolved prompt the Arbiter (game/core/arbiter.ts) can answer
// (ShuffleDeckPrompt / CoinFlipPrompt) WITHOUT waiting for the earlier prompts, and dispatches it.
// So live play shuffles the deck while the search is still open, and never again after the pick:
// the deck is left in the exact order the searching player just looked through, i.e. the
// "Then, shuffle your deck" instruction is not honoured.
//
// Why the wire cannot show it: the conformance driver answers prompts strictly in order (the pick
// first, then the shuffle), so /v1/step always sees search -> shuffle. Only the live arbiter loop
// jumps ahead. This spec therefore installs a StoreHandler that is a line-for-line copy of
// Game.handleArbiterPrompts (with the real Arbiter) and drives the Store directly.

interface ShuffleRecord {
  pickOpenAtShuffle: boolean;
  deckSizeAtShuffle: number;
  deckIdsAfterShuffle: number[];
}

/** Mirrors Game.onStateChange's arbiter step: resolve the first arbiter-answerable unresolved prompt. */
class LiveArbiterHandler implements StoreHandler {
  public store!: Store;
  private arbiter = new Arbiter();
  public shuffles: ShuffleRecord[] = [];

  onStateChange(state: State): void {
    const unresolved = state.prompts.filter(item => item.result === undefined);
    for (let i = 0; i < unresolved.length; i++) {
      const action = this.arbiter.resolvePrompt(state, unresolved[i]);
      if (action !== undefined) {
        const prompt = unresolved[i];
        const player = state.players.find(p => p.id === prompt.getPerspectivePlayerId())!;
        const pickOpen = state.prompts.some(p => p.result === undefined && p instanceof ChooseCardsPrompt);
        const size = player.deck.cards.length;
        this.store.dispatch(action);
        if (prompt instanceof ShuffleDeckPrompt) {
          this.shuffles.push({
            pickOpenAtShuffle: pickOpen,
            deckSizeAtShuffle: size,
            deckIdsAfterShuffle: player.deck.cards.map(c => c.id),
          });
        }
        return;
      }
    }
  }
}

const P = 'Psychic Energy SVE';
const F = 'Mega Sharpedo ex M2'; // non-energy filler

function build(attacker: string, energy: string) {
  const game = setupGame({
    turn: 2,
    player1: {
      active: { card: attacker, energy: [energy] },
      // 10 cards, 4 Basic Energy: deck ids are distinct and their order is observable
      deck: [F, P, F, F, P, F, P, F, F, P],
    },
    player2: {
      active: { card: 'Mega Sharpedo ex M2' },
      deck: [F, F, F, F, F],
    },
  });
  const handler = new LiveArbiterHandler();
  const store = new Store(handler);
  handler.store = store;
  store.state = game.state;
  return { game, handler, store, state: game.state, player: game.player1 };
}

function openPick(state: State): ChooseCardsPrompt | undefined {
  return state.prompts.find(p => p.result === undefined && p instanceof ChooseCardsPrompt) as ChooseCardsPrompt | undefined;
}

beforeAll(() => { loadAllSets(); });

describe('GAP: live arbiter resolves a ShuffleDeckPrompt ahead of an open search pick (Gimmighoul ssp-097)', () => {

  it('REPRO (open): Minor Errand-Running shuffles BEFORE the pick and never after it', () => {
    // When this goes red, the bug is fixed: flip the assertion to the rule (exactly one shuffle,
    // raised after the pick resolved, over the 8-card post-search deck).
    const { handler, store, state, player } = build('Gimmighoul SSP', P);
    const before = player.deck.cards.map(c => c.id);
    expect(before.length).toBe(10);

    store.dispatch(new AttackAction(player.id, 'Minor Errand-Running'));

    // Both prompts were raised together; the arbiter (as game.ts uses it) already took the shuffle.
    const shuffles = state.prompts.filter(p => p instanceof ShuffleDeckPrompt);
    expect(shuffles.length).toBe(1);
    expect(shuffles[0].result).toBeDefined();
    const pick = openPick(state);
    expect(pick).toBeDefined();
    expect(handler.shuffles.length).toBe(1);
    expect(handler.shuffles[0].pickOpenAtShuffle).toBe(true);
    expect(handler.shuffles[0].deckSizeAtShuffle).toBe(10); // the whole pre-search deck was shuffled
    const afterShuffle = handler.shuffles[0].deckIdsAfterShuffle;

    // The player now searches: take the first two Basic Energy in the (already shuffled) deck.
    const energyIdx = player.deck.cards
      .map((c, i) => (c.superType === SuperType.ENERGY ? i : -1))
      .filter(i => i >= 0)
      .slice(0, 2);
    expect(energyIdx.length).toBe(2);
    const picked = energyIdx.map(i => player.deck.cards[i]);
    const pickedIds = picked.map(c => c.id);
    store.dispatch(new ResolvePromptAction(pick!.id, picked));

    expect(player.hand.cards.map(c => c.id)).toEqual(jasmine.arrayContaining(pickedIds));
    expect(player.deck.cards.length).toBe(8);

    // DEFECT: no shuffle after the search. The deck is exactly the order the player searched,
    // minus the two picked cards.
    expect(handler.shuffles.length).toBe(1);
    expect(state.prompts.filter(p => p instanceof ShuffleDeckPrompt).length).toBe(1);
    expect(player.deck.cards.map(c => c.id)).toEqual(afterShuffle.filter(id => pickedIds.indexOf(id) === -1));
  });

  it('CONTROL: Greninja ex twm-106 Shinobi Blade (shuffle raised INSIDE the pick callback) shuffles after the pick', () => {
    const { handler, store, state, player } = build('Greninja ex TWM', 'Water Energy SVE');

    store.dispatch(new AttackAction(player.id, 'Shinobi Blade'));

    // Only the pick is open; the arbiter has nothing to jump ahead to.
    const pick = openPick(state);
    expect(pick).toBeDefined();
    expect(state.prompts.filter(p => p.result === undefined).length).toBe(1);
    expect(state.prompts.some(p => p instanceof ShuffleDeckPrompt)).toBe(false);
    expect(handler.shuffles.length).toBe(0);

    const card = player.deck.cards.find(c => c.superType === SuperType.ENERGY)!;
    store.dispatch(new ResolvePromptAction(pick!.id, [card]));

    // The shuffle is raised by the callback, after the pick, and the arbiter answers it then.
    expect(handler.shuffles.length).toBe(1);
    expect(handler.shuffles[0].pickOpenAtShuffle).toBe(false);
    expect(handler.shuffles[0].deckSizeAtShuffle).toBe(9); // the post-search deck
    expect(player.deck.cards.map(c => c.id)).toEqual(handler.shuffles[0].deckIdsAfterShuffle);
    expect(player.hand.cards.map(c => c.id)).toContain(card.id);
  });
});
