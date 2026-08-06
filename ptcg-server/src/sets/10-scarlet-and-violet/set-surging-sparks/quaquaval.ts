import { PokemonCard, Stage, CardType, State, StoreLike, GameMessage, PowerType, GameError, ChooseCardsPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { ABILITY_USED, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class Quaquaval extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Quaxwell';
  public cardType: CardType = W;
  public hp: number = 170;
  public weakness = [{ type: L }];
  public retreat = [C, C];

  public powers = [{
    name: 'Up-Tempo',
    powerType: PowerType.ABILITY,
    useWhenInPlay: true,
    text: 'You must put a card from your hand on the bottom of your deck in order to use this Ability. Once during your turn, you may draw cards until you have 5 cards in your hand.'
  }];

  public attacks = [
    {
      name: 'Hydro Splash',
      cost: [W, C],
      damage: 120,
      text: ''
    }
  ];

  public regulationMark = 'H';
  public set: string = 'SSP';
  public setNumber: string = '52';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Quaquaval';
  public fullName: string = 'Quaquaval SSP';

  public readonly UP_TEMPO_MARKER = 'UP_TEMPO_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      if (this.marker.hasMarker(this.UP_TEMPO_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      if (player.hand.cards.length > 5 || player.hand.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      state = store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        player.hand,
        {},
        { allowCancel: false, min: 1, max: 1 }
      ), cards => {
        cards = cards || [];
        if (cards.length === 0) {
          return;
        }

        ABILITY_USED(player, this);

        this.marker.addMarker(this.UP_TEMPO_MARKER, this);
        player.marker.addMarker(this.UP_TEMPO_MARKER, this);
        player.hand.moveCardsTo(cards, player.deck);

        // TA-217: this loop had no deck term. Once the deck runs dry `moveTo` moves nothing, the
        // hand never reaches 5 and the loop spins forever -- a genuine infinite loop, not merely a
        // wrong result: the single /v1/step call never returns and wedges the whole server process,
        // so every later request on that instance times out too.
        //
        // Stopping on an empty deck is the PRINTED behaviour, not a safety hack, and the rulebook
        // states both halves directly (Web Rulebook, July 2026):
        //   "If a card tells you to draw or look at more cards from your deck than you have left,
        //    draw or look at the cards you have and continue play as normal."
        //   "You lose if you cannot draw a card at the beginning of your turn, BUT NOT if you
        //    cannot draw one because a card told you to do so."
        // So the shortfall is not a loss here: the deck-out loss belongs to the turn-start draw.
        // Verified on the TA-217 board -- both engines stay `ongoing` after this Ability with an
        // empty deck, and both reach `winB` the moment A's next turn begins. Compendium #481
        // (Heart Wink) says the same at card level; TA-210 settled the same shape for meg-104.
        while (player.hand.cards.length < 5 && player.deck.cards.length > 0) {
          player.deck.moveTo(player.hand, 1);
        }
      });
    }

    if (effect instanceof EndTurnEffect && effect.player.marker.hasMarker(this.UP_TEMPO_MARKER, this)) {
      effect.player.marker.removeMarker(this.UP_TEMPO_MARKER, this);
      this.marker.removeMarker(this.UP_TEMPO_MARKER, this);
    }

    return state;
  }
}