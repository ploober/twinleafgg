import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardTag, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { Player } from '../../../game/store/state/player';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class DrumsOfAwakening extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;

  // TA-260: canonical prints BOTH rule-box tags — `['Ancient', 'ACE SPEC']`. The Ancient half was
  // missing, so this card is invisible to Ancient-counting readers (e.g. Roaring Moon's
  // discard-pile count). Rotomancer agrees with canonical.
  protected _tags = [CardTag.ANCIENT, CardTag.ACE_SPEC];

  public regulationMark = 'H';

  public set: string = 'TEF';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '141';

  public name: string = 'Awakening Drum';

  public fullName: string = 'Awakening Drum TEF';

  public text: string = 'Draw a card for each of your Ancient Pokémon in play.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    // TA-381 (B.41 / #2306): "draw a card for each of your Ancient Pokemon in play" with ZERO of them
    // draws nothing — a provable no-op, so the card is not playable. Same count as the draw below.
    let ancientInPlay = 0;
    if (player.active?.getPokemonCard()?.hasTag(CardTag.ANCIENT)) {
      ancientInPlay++;
    }
    player.bench.forEach((benchSpot) => {
      if (benchSpot.getPokemonCard()?.hasTag(CardTag.ANCIENT)) {
        ancientInPlay++;
      }
    });
    return ancientInPlay > 0;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;

      let ancientPokemonCount = 0;

      if (player.active?.getPokemonCard()?.hasTag(CardTag.ANCIENT)) {
        ancientPokemonCount++;
      }

      player.bench.forEach((benchSpot) => {
        if (benchSpot.getPokemonCard()?.hasTag(CardTag.ANCIENT)) {
          ancientPokemonCount++;
        }
      });
      MOVE_CARDS(store, state, player.deck, player.hand, { count: ancientPokemonCount, sourceCard: this });
    }
    return state;
  }
}
