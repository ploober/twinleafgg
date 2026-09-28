import { Prompt } from './prompt';
import { State } from '../state/state';

export class ShuffleDeckPrompt extends Prompt<number[]> {

  readonly type: string = 'Shuffle deck';

  /**
   * TA-396(c): when set, only the BOTTOM `bottomCount` cards of the deck are being shuffled ("Shuffle
   * the other cards and put them on the bottom of your deck" — Metal Maker tef-114); the rest of the
   * deck keeps its order. A client may answer with a permutation of the whole deck (the arbiters do)
   * or of just the segment; `SHUFFLE_BOTTOM_OF_DECK` applies either to the segment only. Undefined =
   * the whole deck, exactly as before.
   */
  public bottomCount?: number;

  /**
   * B.66 / TA-462 (2026-09-27): WHICH pile this prompt shuffles, declared by the card. The wire's
   * `shuffled` event is zone-qualified — `deck` means the deck's resting order is randomised (the only
   * case `shuffled ≺ draw` applies to); `hand` is a hand-to-bottom ("shuffles their hand and puts it on
   * the bottom", Grand Wing por-009 / Special Red Card cri-082), which TA-379/TA-458 externalize by
   * staging the hand INTO the emptied deck and raising THIS prompt on it — so the driver cannot tell
   * the pile from the prompt alone, and the card must say. Defaults to `deck`. A `bottomCount` segment
   * shuffle stays `deck` for now (a `deckBottom` value is an owner refinement, not pinned).
   */
  public zone: 'deck' | 'hand' | 'prizes';

  constructor(playerId: number, options: { bottomCount?: number; zone?: 'deck' | 'hand' | 'prizes' } = {}) {
    super(playerId);
    this.bottomCount = options.bottomCount;
    this.zone = options.zone ?? 'deck';
  }

  public validate(result: number[] | null, state: State): boolean {
    if (result === null) {
      return false;
    }
    const player = state.players.find(p => p.id === this.getPerspectivePlayerId());
    if (player === undefined) {
      return false;
    }
    const segmentAnswer = this.bottomCount !== undefined && result.length === this.bottomCount;
    if (result.length !== player.deck.cards.length && !segmentAnswer) {
      return false;
    }
    const s = result.slice();
    // Numeric comparator required: default Array.sort is LEXICOGRAPHIC, which scrambles any
    // permutation containing indexes >= 10 (e.g. 10 sorts before 2) and so rejected every valid
    // shuffle of a deck larger than 10 cards.
    s.sort((a, b) => a - b);
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== i) {
        return false;
      }
    }
    return true;
  }

}
