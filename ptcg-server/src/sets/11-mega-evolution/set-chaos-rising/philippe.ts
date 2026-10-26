import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType, CardType, EnergyType, SuperType } from '../../../game/store/card/card-types';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';
import { StoreLike, State, Player, AttachEnergyPrompt, StateUtils } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_TRAINER_USED } from '../../../game/store/prefabs/trainer-prefabs';
import { CheckPokemonTypeEffect } from '../../../game/store/effects/check-effects';
import { CardTarget, PlayerType, SlotType } from '../../../game/store/actions/play-card-action';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Philippe extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.SUPPORTER;
  public set: string = 'CRI';
  public regulationMark: string = 'J';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '79';
  public name: string = 'Philippe';
  public fullName: string = 'Philippe M4';
  public text: string =
    'Attach up to 2 Basic [M] Energy cards from your discard pile to 1 of your [M] Pokémon.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    const basicMetalInDiscard = player.discard.cards.filter(
      (c) =>
        c instanceof EnergyCard &&
        c.energyType === EnergyType.BASIC &&
        c.provides.includes(CardType.METAL),
    );
    if (basicMetalInDiscard.length === 0) {
      return false;
    }
    let metalPokemonCount = 0;
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
      const checkType = new CheckPokemonTypeEffect(cardList);
      store.reduceEffect(state, checkType);
      if (checkType.cardTypes.includes(CardType.METAL)) {
        metalPokemonCount++;
      }
    });
    if (metalPokemonCount === 0) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_TRAINER_USED(effect, this)) {
      const player = effect.player;

      const basicMetalInDiscard = player.discard.cards.filter(
        (c) =>
          c instanceof EnergyCard &&
          c.energyType === EnergyType.BASIC &&
          c.provides.includes(CardType.METAL),
      );

      if (basicMetalInDiscard.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      const blocked: CardTarget[] = [];
      let metalPokemonCount = 0;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
        const checkType = new CheckPokemonTypeEffect(cardList);
        store.reduceEffect(state, checkType);
        if (!checkType.cardTypes.includes(CardType.METAL)) {
          blocked.push(target);
        } else {
          metalPokemonCount++;
        }
      });

      if (metalPokemonCount === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      const discardBlocked: number[] = [];
      player.discard.cards.forEach((card, index) => {
        if (
          !(card instanceof EnergyCard) ||
          card.energyType !== EnergyType.BASIC ||
          !card.provides.includes(CardType.METAL)
        ) {
          discardBlocked.push(index);
        }
      });

      // TA-780 (B.120 amended; B.18 / #2301): every card first — a Trainer's "up to 2" is 1..2 — then the one [M] Pokémon
      // they all go to (sameTarget); non-[M] Pokémon are not offered.
      return store.prompt(
        state,
        new AttachEnergyPrompt(
          player.id,
          GameMessage.ATTACH_ENERGY_CARDS,
          player.discard,
          PlayerType.BOTTOM_PLAYER,
          [SlotType.ACTIVE, SlotType.BENCH],
          { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
          { allowCancel: false, min: 1, max: Math.min(2, basicMetalInDiscard.length), sameTarget: true,
            blocked: discardBlocked, blockedTo: blocked },
        ),
        (transfers) => {
          (transfers || []).forEach((transfer) => {
            const target = StateUtils.getTarget(state, player, transfer.to);
            MOVE_CARDS(store, state, player.discard, target, { cards: [transfer.card], sourceCard: this });
          });
          return state;
        },
      );
    }
    return state;
  }
}
