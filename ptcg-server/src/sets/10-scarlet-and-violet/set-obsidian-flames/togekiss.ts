import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, PowerType, GameMessage, PlayerType, ConfirmPrompt, GameLog } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PowerEffect } from '../../../game/store/effects/game-effects';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { MOVE_ENERGY_FROM_THIS_POKEMON_TO_BENCH_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Togekiss extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Togetic';
  public cardType: CardType[] = [P];
  public hp: number = 150;
  public weakness = [{ type: M }];
  public retreat = [];

  public powers = [{
    name: 'Precious Gift',
    powerType: PowerType.ABILITY,
    text: 'Once at the end of your turn (after your attack), you may use this Ability. Draw cards until you have 8 cards in your hand.'
  }];

  public attacks = [{
    name: 'Power Cyclone',
    cost: [C, C],
    damage: 110,
    text: 'Move an Energy from this Pokémon to 1 of your Benched Pokémon.'
  }];

  public set: string = 'OBF';
  public regulationMark = 'G';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '85';
  public name: string = 'Togekiss';
  public fullName: string = 'Togekiss OBF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Precious Gift
    // TA-549 (#1869): "used at the end of your turn after attacking and checking for a KO but before Pokemon Checkup.
    // So if your attack causes a KO you would take Prize cards first, and then you can use Precious Gift." Prompting
    // directly on EndTurnEffect asked before the attack's Knock Out was resolved (the KO'd Active still in play, the
    // Prize not yet in hand); the step is queued for after the KO check, and every test is read at that time.
    if (effect instanceof EndTurnEffect) {
      const player = effect.player;
      effect.afterKnockOuts.push(() => {
        let isTogekissInPlay = false;
        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
          if (card === this) {
            isTogekissInPlay = true;
          }
        });

        if (!isTogekissInPlay) {
          return;
        }

        try {
          const powerEffect = new PowerEffect(player, this.powers[0], this);
          store.reduceEffect(state, powerEffect);
        } catch {
          return;
        }

        if (player.hand.cards.length >= 8) {
          return;
        }

        store.prompt(state, new ConfirmPrompt(
          player.id,
          GameMessage.WANT_TO_USE_ABILITY,
        ), wantToUse => {
          if (wantToUse) {
            store.log(state, GameLog.LOG_PLAYER_USES_ABILITY, { name: player.name, ability: 'Togekiss' });

            while (player.hand.cards.length < 8 && player.deck.cards.length > 0) {
              MOVE_CARDS(store, state, player.deck, player.hand, { count: 1, sourceCard: this });
            }
          }
        });
      });
    }

    // Power Cyclone
    if (WAS_ATTACK_USED(effect, 0, this)) {
      // TA-494 / TA-651, B.82 (1), B.85 (1)(c) (#1834, #2002): the Energy is chosen before the damage (recorded as
      // `chosen`), the damage reads it attached (Double Turbo Energy's 20 less), and it moves after the damage. TA-653 /
      // B.89 (1): the Benched Pokémon is a Step-D choice too, asked with the Energy (the joint pre-damage moveEnergy).
      return MOVE_ENERGY_FROM_THIS_POKEMON_TO_BENCH_CHOOSE_FIRST(store, state, effect, this);
    }

    return state;
  }
}
