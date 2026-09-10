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

  constructor(playerId: number, options: { bottomCount?: number } = {}) {
    super(playerId);
    this.bottomCount = options.bottomCount;
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
