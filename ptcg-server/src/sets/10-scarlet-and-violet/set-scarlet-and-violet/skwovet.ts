import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, BoardEffect } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { PowerType } from '../../../game/store/card/pokemon-types';

import { CardList, GameError, GameMessage, PlayerType, ShuffleDeckPrompt } from '../../../game';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { WAS_POWER_USED, DRAW_CARDS } from '../../../game/store/prefabs/prefabs';

export class Skwovet extends PokemonCard {

  public regulationMark = 'G';

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.COLORLESS];

  public hp: number = 60;

  public weakness = [{ type: CardType.FIGHTING }];

  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Nest Stash',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, you may shuffle your hand and put ' +
      'it on the bottom of your deck. If you put any cards on the ' +
      'bottom of your deck in this way, draw a card.'
  }];

  public attacks = [{
    name: 'Bite',
    cost: [CardType.COLORLESS, CardType.COLORLESS],
    damage: 20,
    text: ''
  }];

  public set: string = 'SVI';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '151';

  public name: string = 'Skwovet';

  public fullName: string = 'Skwovet SVI';

  public readonly NEST_STASH_MARKER = 'NEST_STASH_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      player.marker.removeMarker(this.NEST_STASH_MARKER, this);
    }

    if (WAS_POWER_USED(effect, 0, this)) {

      const player = effect.player;
      const cards = player.hand.cards.filter(c => c !== this);

      if (player.marker.hasMarker(this.NEST_STASH_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      if (cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // TA-502: "you may shuffle your hand and put it on the bottom of your deck. If you put any cards on the bottom of
      // your deck in this way, draw a card." The hand used to go to the bottom IN HAND ORDER, with no shuffle. The
      // TA-379 pattern (Special Red Card): stage the hand INTO the emptied deck so the ShuffleDeckPrompt carries
      // exactly those cards (zone 'hand', B.66), restack the rest of the deck on top in the callback, then draw.
      player.marker.addMarker(this.NEST_STASH_MARKER, this);
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
        if (cardList.getPokemonCard() === this) {
          cardList.addBoardEffect(BoardEffect.ABILITY_USED);
        }
      });

      const rest = new CardList();
      player.deck.moveTo(rest);
      player.hand.moveTo(player.deck);
      return store.prompt(state, new ShuffleDeckPrompt(player.id, { zone: 'hand' }), order => {
        player.deck.applyOrder(order);
        rest.moveToTopOfDestination(player.deck);
        DRAW_CARDS(store, state, player, 1);
      });
    }
    if (effect instanceof EndTurnEffect) {
      effect.player.marker.removeMarker(this.NEST_STASH_MARKER, this);
    }
    return state;
  }

}