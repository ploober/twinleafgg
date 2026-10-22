import { CardTarget, ChooseCardsPrompt, ChoosePokemonPrompt, EnergyType, GameError, GameMessage, Player, PlayerType, SlotType, State, StateUtils, StoreLike, SuperType, TrainerCard, TrainerType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Ruffian extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.SUPPORTER;
  public regulationMark = 'I';
  public set: string = 'JTG';
  public name: string = 'Ruffian';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '157';
  public fullName: string = 'Ruffian JTG';

  public text: string = 'Discard a Pokémon Tool and a Special Energy from 1 of your opponent\'s Pokémon.';

  /**
   * TA-181. "Discard a Pokémon **Tool** and a **Special** Energy from 1 of your opponent's Pokémon."
   *
   * A Pokémon is a legal target only if it carries something this card can actually discard — a Tool,
   * or a SPECIAL Energy. Basic Energy is untouchable by Ruffian, so a board whose only attachment is
   * a Basic Energy offers the card nothing to do, and #925 makes it unplayable ("you cannot play a
   * card if it is obvious that you cannot do what the card is supposed to do at that moment").
   *
   * This used to test `cardList.energies.cards.length > 0 || cardList.tools.length > 0` — **any**
   * Energy, Basic included — while `reduceEffect` below required a Special Energy or a Tool and threw
   * `CANNOT_PLAY_THIS_CARD` otherwise. The menu offered a play the engine then refused: the
   * MENU==DISPATCH violation of TA-177 / TA-71. `reduceEffect` was the correct one of the pair, so
   * the predicate is moved here and both now call it.
   */
  private hasDiscardableTarget(store: StoreLike, state: State, player: Player): boolean {
    const opponent = StateUtils.getOpponent(state, player);
    let hasTarget = false;
    opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList) => {
      if (Ruffian.isLegalTarget(cardList)) {
        hasTarget = true;
      }
    });
    return hasTarget;
  }

  /** A target must carry a Tool or a SPECIAL Energy — Basic Energy is not discardable by Ruffian. */
  private static isLegalTarget(cardList: { energies: { cards: { superType: SuperType; energyType?: EnergyType }[] }; tools: unknown[] }): boolean {
    const hasSpecialEnergy = cardList.energies.cards.some(
      c => c.superType === SuperType.ENERGY && c.energyType === EnergyType.SPECIAL);
    const hasTool = cardList.tools.some(
      c => c instanceof TrainerCard && c.trainerType === TrainerType.TOOL);
    return hasSpecialEnergy || hasTool;
  }

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    return this.hasDiscardableTarget(store, state, player);
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (player.supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      // TA-181: the same `isLegalTarget` test `canPlay` uses, so the menu and the dispatcher cannot
      // disagree. `blocked` still has to be built per-target for the prompt, but the go/no-go answer
      // comes from one place.
      let energyOrToolcard = false;
      const blocked: CardTarget[] = [];
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card, target) => {
        if (Ruffian.isLegalTarget(cardList)) {
          energyOrToolcard = true;
        } else {
          blocked.push(target);
        }
      });

      if (!energyOrToolcard) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { allowCancel: false, blocked }
      ), targets => {
        if (!targets || targets.length === 0) {
          return;
        }

        const target = targets[0];

        // removing the tool
        if (target.tools.length > 0) {
          const toolToDiscard = target.tools[0];
          if (target.tools.length > 1) {
            return store.prompt(state, new ChooseCardsPrompt(
              player,
              GameMessage.CHOOSE_CARD_TO_DISCARD,
              target,
              { superType: SuperType.TRAINER, trainerType: TrainerType.TOOL },
              { min: 1, max: 1, allowCancel: false }
            ), selected => {
              if (selected && selected.length > 0) {
                MOVE_CARDS(store, state, target, opponent.discard, { cards: [selected[0]], sourceCard: this });
              }
              // continue to energy discard
              // removing special energies
              let specialEnergies = 0;
              target.energies.cards.forEach(card => {
                if (card.superType === SuperType.ENERGY && card.energyType === EnergyType.SPECIAL) { specialEnergies++; }
              });

              if (specialEnergies > 0) {
                store.prompt(state, new ChooseCardsPrompt(
                  player,
                  GameMessage.CHOOSE_CARD_TO_DISCARD,
                  target,
                  { superType: SuperType.ENERGY, energyType: EnergyType.SPECIAL },
                  { min: 1, max: 1, allowCancel: false }
                ), selected => {
                  MOVE_CARDS(store, state, target, opponent.discard, { cards: selected, sourceCard: this });
                  MOVE_CARDS(store, state, player.supporter, player.discard, { sourceCard: this });
                });
              } else {
                MOVE_CARDS(store, state, player.supporter, player.discard, { sourceCard: this });
              }
            });
          } else {
            MOVE_CARDS(store, state, target, opponent.discard, { cards: [toolToDiscard], sourceCard: this });
          }
        }

        // removing special energies
        let specialEnergies = 0;
        target.energies.cards.forEach(card => {
          if (card.superType === SuperType.ENERGY && card.energyType === EnergyType.SPECIAL) { specialEnergies++; }
        });

        if (specialEnergies > 0) {
          store.prompt(state, new ChooseCardsPrompt(
            player,
            GameMessage.CHOOSE_CARD_TO_DISCARD,
            target,
            { superType: SuperType.ENERGY, energyType: EnergyType.SPECIAL },
            { min: 1, max: 1, allowCancel: false }
          ), selected => {
            MOVE_CARDS(store, state, target, opponent.discard, { cards: selected, sourceCard: this });
            MOVE_CARDS(store, state, player.supporter, player.discard, { sourceCard: this });
          });
        } else {
          MOVE_CARDS(store, state, player.supporter, player.discard, { sourceCard: this });
        }
      });
    }

    return state;
  }
}