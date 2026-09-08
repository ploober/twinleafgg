import {
  TrainerCard,
  TrainerType,
  Stage,
  CardType,
  PokemonType,
  Power,
  PowerType,
  StoreLike,
  State,
  GameLog,
  StateUtils,
  GameError,
  GameMessage,
  PokemonCard,
  Player,
  CardTag,
} from '../../../game';
import { AddSpecialConditionsPowerEffect, CheckGustBlockEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';
import { RetreatEffect } from '../../../game/store/effects/game-effects';
import {
  PlayItemEffect,
  PlayPokemonEffect,
} from '../../../game/store/effects/play-card-effects';
import { AddSpecialConditionsEffect } from '../../../game/store/effects/attack-effects';
import { IS_ABILITY_BLOCKED, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class AntiqueSailFossil extends TrainerCard {
  public trainerType = TrainerType.ITEM;
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [CardType.COLORLESS];
  public cardTypez: CardType = CardType.COLORLESS;
  public movedToActiveThisTurn = false;
  public pokemonType = PokemonType.NORMAL;
  public evolvesFrom = '';
  public cardTag = [];
  protected _tags = [CardTag.ANTIQUE];
  public tools = [];
  public evolvesTo = [];
  public evolvesToStage = [];
  public archetype = [];
  public hp: number = 60;
  public weakness = [];
  public retreat = [];
  public resistance = [];
  public attacks = [];
  public attacksThisTurn: number = 0;
  public maxAttacksThisTurn: number = 1;
  public allowSubsequentAttackChoice: boolean = false;
  public evolvesFromBase: string[] = [];
  public maxTools: number = 1;

  public powers: Power[] = [
    {
      name: 'Antique Sail Fossil',
      text: "Play this card as a 60 HP Basic [C] Pokémon. This card can't be affected by Special Conditions and can't retreat. At any time during your turn, you may discard this card from play.",
      useWhenInPlay: true,
      exemptFromAbilityLock: true,
      isFossil: true,
      powerType: PowerType.TRAINER_ABILITY,
    },
    {
      name: 'Protective Sail',
      powerType: PowerType.ABILITY,
      text: 'Whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to this Pokémon.',
    },
  ];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '69';
  public name: string = 'Antique Sail Fossil';
  public fullName: string = 'Antique Sail Fossil M3';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    const openSlots = player.bench.filter((b) => b.cards.length === 0);
    if (openSlots.length === 0) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Discard from play
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;
      store.log(state, GameLog.LOG_PLAYER_DISCARDS_CARD, {
        name: player.name,
        card: this.name,
        effect: 'Antique Sail Fossil',
      });
      const cardList = StateUtils.findCardList(state, this);
      cardList.moveCardTo(this, player.discard);
    }

    // Play as Pokemon
    if (effect instanceof PlayItemEffect && effect.trainerCard === this) {
      const player = effect.player;
      const emptySlots = player.bench.filter((b) => b.cards.length === 0);
      if (emptySlots.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }
      const playPokemonEffect = new PlayPokemonEffect(
        player,
        this as unknown as PokemonCard,
        emptySlots[0],
      );
      store.reduceEffect(state, playPokemonEffect);
    }
    // TA-348 / SD-26: the ABILITY channel. AddSpecialConditionsPowerEffect is reduced raw (no
    // wrapper), so the attack-channel interception above never saw an ability-inflicted condition
    // and Selective Slime burned this Fossil. "can't be affected by any Special Conditions" is
    // rules text: it holds against every source.
    if (effect instanceof AddSpecialConditionsPowerEffect && effect.target.getPokemonCard() === this) {
      effect.preventDefault = true;
    }

    // Prevent retreat
    if (effect instanceof RetreatEffect && effect.player.active.getPokemonCard() === this) {
      throw new GameError(GameMessage.CANNOT_RETREAT);
    }

    // Prevent special conditions
    if (effect instanceof AddSpecialConditionsEffect && effect.target.getPokemonCard() === this) {
      effect.preventDefault = true;
    }

    // TA-388: "Whenever your opponent plays a Supporter card from their hand, prevent all effects of
    // that card done to this Pokemon." The gust from an opponent Supporter (Boss's Orders) is such an
    // effect. SWITCH_IN_OPPONENT_BENCHED_POKEMON asks each opponent benched Pokemon via
    // CheckGustBlockEffect whether it may be switched in; this Fossil vetoes when the gust's source is
    // an opponent Supporter and the ability is live. (The former implementation set preventDefault on
    // the whole TrainerEffect, which aborted the play-resolution step that moves a played Supporter out
    // of the hand — stranding EVERY Supporter in the opponent's hand while preventing none of their
    // effects, since a card's own reduceEffect runs during propagateEffect before that short-circuit.)
    if (effect instanceof CheckGustBlockEffect && effect.target.getPokemonCard() === this) {
      const owner = StateUtils.findOwner(state, effect.target);
      const src = effect.sourceCard;
      const isOpponentSupporter = effect.player !== owner
        && src instanceof TrainerCard
        && src.trainerType === TrainerType.SUPPORTER;
      if (isOpponentSupporter && !IS_ABILITY_BLOCKED(store, state, owner, this)) {
        effect.blocked = true;
      }
    }

    return state;
  }
}
