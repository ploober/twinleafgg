import { CardTag, CardType, GameError, GameLog, GameMessage, Player, PokemonCard, PokemonType, Power, PowerType, Stage, State, StateUtils, StoreLike, TrainerCard, TrainerType } from "../../../game";
import { AddSpecialConditionsEffect } from "../../../game/store/effects/attack-effects";
import { Effect } from "../../../game/store/effects/effect";
import { PowerEffect, RetreatEffect } from "../../../game/store/effects/game-effects";
import { CheckAttackCostEffect, AddSpecialConditionsPowerEffect } from "../../../game/store/effects/check-effects";
import { PlayItemEffect, PlayPokemonEffect } from "../../../game/store/effects/play-card-effects";
import {WAS_POWER_USED, MOVE_CARDS } from "../../../game/store/prefabs/prefabs";

export class AntiqueRootFossil extends TrainerCard {
  protected _trainerType = TrainerType.ITEM;
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
    name: 'Antique Root Fossil',
    text: "Play this card as a 60 HP Basic [C] Pokémon. This card can't be affected by Special Conditions and can't retreat. At any time during your turn, you may discard this card from play.",
    useWhenInPlay: true,
    exemptFromAbilityLock: true,
    isFossil: true,
    powerType: PowerType.TRAINER_ABILITY,
  }, {
    // TA-340: the printed second ability was missing entirely.
    name: 'Primal Root',
    powerType: PowerType.ABILITY,
    text: "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Basic Pokémon cost [C] more.",
  }];

  public regulationMark = 'H';
  public set: string = 'SCR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '130';
  public name: string = 'Antique Root Fossil';
  public fullName: string = 'Antique Root Fossil SCR';

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
        effect: 'Antique Root Fossil',
      });
      const cardList = StateUtils.findCardList(state, this);
      MOVE_CARDS(store, state, cardList, player.discard, { cards: [this], sourceCard: this });
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

    // Primal Root (TA-340): "attacks used by your opponent's Basic Pokémon cost [C] more" while this
    // is in the Active Spot. Seismitoad's shape; the lock probe names Primal Root, not the Fossil
    // trainer-ability (whose handler would discard this card).
    if (effect instanceof CheckAttackCostEffect
      && StateUtils.getOpponent(state, effect.player).active.getPokemonCard() === this) {
      const attackerOwner = effect.player;
      const fossilOwner = StateUtils.getOpponent(state, attackerOwner);
      const attacker = attackerOwner.active.getPokemonCard();
      if (attacker && attacker.stage === Stage.BASIC) {
        try {
          store.reduceEffect(state, new PowerEffect(fossilOwner, this.powers[1], this as unknown as PokemonCard));
          effect.cost.push(CardType.COLORLESS);
        } catch {
          // ability locked — no cost increase
        }
      }
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

    return state;
  }
}
