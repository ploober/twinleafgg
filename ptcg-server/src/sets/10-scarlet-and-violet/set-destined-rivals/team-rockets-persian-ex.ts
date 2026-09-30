import { PokemonCard, Stage, CardType, CardTag, StoreLike, State, GameMessage, StateUtils, CardList, SuperType, ShowCardsPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import {ADD_CONFUSION_TO_PLAYER_ACTIVE,
  AFTER_ATTACK,
  SHUFFLE_DECK,
  WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { COPY_ATTACK_FROM_POKEMON_LIST } from '../../../game/store/prefabs/copy-attack-prefabs';

export class TeamRocketsPersianex extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = "Team Rocket's Meowth";
  protected _tags = [CardTag.TEAM_ROCKET, CardTag.POKEMON_ex];
  public cardType: CardType[] = [C];
  public hp: number = 260;
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Haughty Order',
      cost: [C, C],
      damage: 0,
      copycatAttack: true,
      text: 'Your opponent reveals the top 10 cards of their deck. You may choose an attack from a Pokemon you find there and use it as this attack. Your opponent shuffles the revealed cards back into their deck.',
    },
    {
      name: 'Cruel Slash',
      cost: [C, C, C],
      damage: 140,
      text: "Your opponent's Active Pokemon is now Confused.",
    },
  ];

  public set: string = 'DRI';
  public regulationMark = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '150';
  public name: string = "Team Rocket's Persian ex";
  public fullName: string = "Team Rocket's Persian ex DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // TA-131: declarable even if the opponent's deck is empty (rulebook p.20) — the reveal whiffs.
      const opponentTop10 = new CardList();
      MOVE_CARDS(store, state, opponent.deck, opponentTop10, { count: Math.min(10, opponent.deck.cards.length), sourceCard: this });
      const toppedPokemon = opponentTop10.cards.filter(
        (card) => card.superType === SuperType.POKEMON,
      ) as PokemonCard[];

      store.prompt(
        state,
        [
          new ShowCardsPrompt(player.id, GameMessage.CARDS_SHOWED_BY_EFFECT, opponentTop10.cards, {
            allowCancel: false,
          }),
          new ShowCardsPrompt(opponent.id, GameMessage.CARDS_SHOWED_BY_EFFECT, opponentTop10.cards, {
            allowCancel: false,
          }),
        ],
        (results) => {
          // TA-166 / CF-9 put-back boundary: with an empty deck nothing is revealed and nothing goes
          // back, so there is NO shuffle. #2377 (April 2026 rulebook update; #1022 and #1968 reversed
          // the same day): "you do not shuffle since you are not putting any cards back into the
          // deck." CF-9's unconditional shuffle governs a deck SEARCH (#2171) and does not reach a
          // put-back. NOTE: zero CANDIDATES is not zero CARDS — revealing ten cards none of which has
          // a copyable attack still puts ten back, so that board DOES shuffle.
          const putBack = opponentTop10.cards.length;
          MOVE_CARDS(store, state, opponentTop10, opponent.deck, { sourceCard: this });
          if (putBack > 0) {
            SHUFFLE_DECK(store, state, opponent);
          }
        },
      );

      if (toppedPokemon.length === 0) {
        return state;
      }

      return COPY_ATTACK_FROM_POKEMON_LIST(store, state, effect as AttackEffect, toppedPokemon, {
        allowCancel: true,
        maxRetries: 3,
      });
    }

    if (AFTER_ATTACK(effect, 1, this)) {
      ADD_CONFUSION_TO_PLAYER_ACTIVE(store, state, effect.opponent, this);
    }

    return state;
  }
}
