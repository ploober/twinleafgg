import { pokemonHasCardType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType, CardType } from '../../../game/store/card/card-types';
import { StateUtils } from '../../../game/store/state-utils';
import { UseStadiumEffect } from '../../../game/store/effects/game-effects';
import { CheckPokemonTypeEffect } from '../../../game/store/effects/check-effects';
import { HANDLE_ABILITY_LOCK } from '../../../game/store/prefabs/ability-lock';
import { IS_STADIUM_EFFECT_BLOCKED } from '../../../game/store/prefabs/stadium-effect';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';

export class TeamRocketsWatchtower extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.STADIUM;
  public set: string = 'DRI';
  public regulationMark = 'I';
  public name: string = 'Team Rocket\'s Watchtower';
  public fullName: string = 'Team Rocket\'s Watchtower DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '180';
  public text: string = '[C] Pokémon in play (both yours and your opponent\'s) have no Abilities.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    HANDLE_ABILITY_LOCK(effect, ({ card }) => {
      if (StateUtils.getStadiumCard(state) !== this) {
        return false;
      }
      // TA-180: when the card is not on a PokemonCardList we fall back to its PRINTED type instead of
      // reporting "not locked". A Pokemon being played from hand onto the Bench is still on the hand's
      // CardList at probe time — `Store.reduceEffect` runs `propagateEffect` (every card's own
      // reduceEffect, including an arrival Ability's) BEFORE `playPokemonReducer` moves the card — so
      // requiring a PokemonCardList here silently exempted every ARRIVAL Ability from the lock.
      // Compendium #2334: "Yes, Meowth ex will have no Ability when it comes into play."
      //
      // This restores what the card did before the ability-lock refactor (1da46991e), whose PowerEffect
      // branch blocked on `pokemonCard.cardType === CardType.COLORLESS` alone and never consulted
      // location. A genuinely in-hand or in-discard Ability stays exempt via the
      // `allowUseFromHand`/`allowUseFromDiscard` options below rather than by location — which is the
      // distinction that matches the card text ("Pokemon in play ... have no Abilities"), because an
      // arriving Pokemon is coming into play while a `useFromHand` Ability is not. Callers must pass
      // their power to `IS_ABILITY_BLOCKED` for that exemption to be visible to the probe.
      const lockedByPrintedType = () => pokemonHasCardType(card, CardType.COLORLESS);
      try {
        const cardList = StateUtils.findCardList(state, card);
        if (!(cardList instanceof PokemonCardList)) {
          return lockedByPrintedType();
        }
        const owner = StateUtils.findOwner(state, cardList);
        if (IS_STADIUM_EFFECT_BLOCKED(store, state, owner, cardList, this)) {
          return false;
        }
        const checkType = new CheckPokemonTypeEffect(cardList);
        store.reduceEffect(state, checkType);
        return checkType.cardTypes.includes(CardType.COLORLESS);
      } catch {
        return lockedByPrintedType();
      }
    }, {
      allowUseFromHand: true,
      allowUseFromDiscard: true,
      error: GameMessage.BLOCKED_BY_EFFECT,
    });

    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      throw new GameError(GameMessage.CANNOT_USE_STADIUM);
    }

    return state;
  }
}
