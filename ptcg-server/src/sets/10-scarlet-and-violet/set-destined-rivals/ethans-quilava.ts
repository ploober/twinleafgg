import { PokemonCard, Stage, PowerType, StoreLike, State, ChooseCardsPrompt, GameMessage, StateUtils, CardTag } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_POWER_USED, BLOCK_EFFECT_IF_MARKER, BLOCK_IF_DECK_EMPTY, SHOW_CARDS_TO_PLAYER, ADD_MARKER, ABILITY_USED, SHUFFLE_DECK, REMOVE_MARKER_AT_END_OF_TURN, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class EthansQuilava extends PokemonCard {

  public stage = Stage.STAGE_1;

  public evolvesFrom = 'Ethan\'s Cyndaquil';

  public tags = [CardTag.ETHANS];

  public cardType = R;

  public hp = 100;

  public weakness = [{ type: W }];

  public retreat = [C];

  public powers = [{
    name: 'Bonded by the Journey',
    powerType: PowerType.ABILITY,
    useWhenInPlay: true,
    text: 'Once during your turn, you may search your deck for a Ethan\'s Adventure, reveal it, and put it into your hand. Then, shuffle your deck.'
  }];

  public attacks = [{
    name: 'Combustion',
    cost: [R],
    damage: 40,
    text: ''
  }];

  public regulationMark = 'I';

  public set: string = 'DRI';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '33';

  public name: string = 'Ethan\'s Quilava';

  public fullName: string = 'Ethan\'s Quilava DRI';

  public readonly ADVENTURE_BOUND_MARKER = 'ADVENTURE_BOUND';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      BLOCK_EFFECT_IF_MARKER(this.ADVENTURE_BOUND_MARKER, player, this);
      BLOCK_IF_DECK_EMPTY(player);

      state = store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck,
        { name: 'Ethan\'s Adventure' },
        { min: 0, max: 1 }
      ), cards => {
        // TA-218 / TA-212's class: the once-per-turn must be consumed by USING the Ability, not by
        // finding something. #127 (Floral Path to the Sky) is explicit -- "since you SEARCHED your
        // deck the ability is used up for the turn" -- so a fruitless search still spends it. These
        // two lines used to sit BELOW the early return, so on a deck with no Ethan's Adventure the
        // marker was never added and twinleaf re-offered the Ability; driven live it accepted a
        // second use (applied=8) where rotomancer refused it.
        ADD_MARKER(this.ADVENTURE_BOUND_MARKER, player, this);
        ABILITY_USED(player, this);

        if (!cards || cards.length === 0) {
          SHUFFLE_DECK(store, state, player);
          return state;
        }

        SHOW_CARDS_TO_PLAYER(store, state, opponent, cards);
        MOVE_CARDS(store, state, player.deck, player.hand, { cards, sourceCard: this, sourceEffect: this.powers[0] });
        SHUFFLE_DECK(store, state, player);
      });
    }

    REMOVE_MARKER_AT_END_OF_TURN(effect, this.ADVENTURE_BOUND_MARKER, this);

    return state;
  }
}
