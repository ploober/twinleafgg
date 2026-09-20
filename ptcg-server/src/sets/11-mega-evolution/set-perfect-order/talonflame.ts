import { PokemonCard, Stage, CardType, PowerType, StoreLike, State, StateUtils, GameError, GameMessage } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { CoinFlipEffect } from '../../../game/store/effects/play-card-effects';
import { WAS_POWER_USED, ABILITY_USED, REMOVE_MARKER_AT_END_OF_TURN } from '../../../game/store/prefabs/prefabs';

export class Talonflame extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Fletchinder';
  public cardType: CardType[] = [R];
  public hp: number = 150;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public powers = [{
    name: 'Sky Hunt',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, you may use this Ability. Flip a coin. If heads, discard a random card from your opponent\'s hand.'
  }];

  public attacks = [{
    name: 'Fire Wing',
    cost: [R, R],
    damage: 110,
    text: ''
  }];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '14';
  public name: string = 'Talonflame';
  public fullName: string = 'Talonflame M3';

  public readonly SKY_HUNT_MARKER = 'SKY_HUNT_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Sky Hunt ability
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (player.marker.hasMarker(this.SKY_HUNT_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      // TA-213 / B.27: the only thing this Ability can do is discard a card from the opponent's
      // hand, so with that hand EMPTY no branch of it can accomplish anything and it may not be
      // used. Ruling #2306 (Grand Wing, Perfect Order FAQ 2026-03-26) is directly on point and is
      // about an Ability: "If my opponent has zero cards in their hand, can I use Vivillon's Grand
      // Wing Ability even though it won't do anything? -- No."
      //
      // The intervening coin flip does not rescue it. #1661 (Moonlit Miracle) lets a flip-first
      // ATTACK be used regardless -- but that is the attack/ability asymmetry (an attack may always
      // be used once its cost is paid), and even there the Rules Team stops before the effect
      // "since you know there won't be any effect". For an Ability, #2306 governs.
      if (opponent.hand.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      ABILITY_USED(player, this);
      // TA-450: the guard above asks for a marker SOURCED by this card (`hasMarker(name, this)`), but
      // `addMarkerToState` records the marker with no source, so the guard never matched and the
      // Ability was usable any number of times per turn (the menu hid it via ABILITY_USED; the reducer
      // took it). Same spelling as the end-of-turn removal, which is also source-qualified.
      player.marker.addMarker(this.SKY_HUNT_MARKER, this);

      const coinFlipEffect = new CoinFlipEffect(player, (result: boolean) => {
        if (result === true && opponent.hand.cards.length > 0) {
          const randomIndex = Math.floor(Math.random() * opponent.hand.cards.length);
          const randomCard = opponent.hand.cards[randomIndex];
          opponent.hand.moveCardTo(randomCard, opponent.discard);
        }
      });

      return store.reduceEffect(state, coinFlipEffect);
    }

    REMOVE_MARKER_AT_END_OF_TURN(effect, this.SKY_HUNT_MARKER, this);

    return state;
  }
}
