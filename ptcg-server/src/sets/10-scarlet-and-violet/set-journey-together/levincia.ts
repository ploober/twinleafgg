import { Effect } from '../../../game/store/effects/effect';
import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardType, EnergyType, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StateUtils } from '../../../game/store/state-utils';
import { UseStadiumEffect } from '../../../game/store/effects/game-effects';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { EnergyCard } from '../../../game';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Levincia extends TrainerCard {

  protected _trainerType: TrainerType = TrainerType.STADIUM;

  public set: string = 'JTG';

  public name: string = 'Levincia';

  public fullName: string = 'Levincia JTG';

  public regulationMark = 'I';

  public cardImage: string = 'assets/cardback.png';

  public setNumber = '150';

  public text: string = 'Once during each player\'s turn, that player may put up to 2 Basic [L] Energy cards from their discard pile into their hand.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      const player = effect.player;

      let hasCardsInDiscard = false;
      player.discard.cards.forEach((c) => {
        if (c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.provides.includes(CardType.LIGHTNING)) {
          hasCardsInDiscard = true;
        }
      });

      if (hasCardsInDiscard === false) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.discard,
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Lightning Energy' },
        // TA-159 / §B.18: the floor is 1, not 0. #2301 — "For other effects (such as the effects of
        // Trainer cards and Abilities), you can choose any number between 1 and the maximum." A
        // Stadium is a Trainer. The printed "may" is the ACTIVATION gate (`useStadium` is itself the
        // "may"), not a licence to take zero after activating — rotomancer reached the identical
        // reading independently on Thwackey `svp-115`/`twm-015`, the same once-per-turn "may" shape.
        // #968's untyped-search exception does not reach this: fail-to-find is a HIDDEN-zone doctrine
        // ("the contents of the deck are unknown"), and this is a TYPED retrieval from the discard
        // pile, where contents and quantity are both public. The "no Basic [L] in the discard" case
        // is already handled above by the CANNOT_USE_POWER guard, so a floor of 1 is always
        // satisfiable by the time we get here.
        { allowCancel: false, min: 1, max: 2 }
      ), selected => {
        selected = selected || [];
        MOVE_CARDS(store, state, player.discard, player.hand, { cards: selected, sourceCard: this });
      });
    }

    return state;
  }
}