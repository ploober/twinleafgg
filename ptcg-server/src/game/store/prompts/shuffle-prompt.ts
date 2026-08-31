import { Prompt } from './prompt';
import { State } from '../state/state';

export class ShuffleDeckPrompt extends Prompt<number[]> {

  readonly type: string = 'Shuffle deck';

  constructor(playerId: number) {
    super(playerId);
  }

  public validate(result: number[] | null, state: State): boolean {
    if (result === null) {
      return false;
    }
    const player = state.players.find(p => p.id === this.getPerspectivePlayerId());
    if (player === undefined) {
      return false;
    }
    if (result.length !== player.deck.cards.length) {
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
