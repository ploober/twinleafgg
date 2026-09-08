import { BoardEffect, CardType, EnergyType, Stage, SuperType } from '../../../game/store/card/card-types';
import { PowerType } from '../../../game/store/card/pokemon-types';
import { Effect } from '../../../game/store/effects/effect';
import { PokemonCard, StoreLike, State, StateUtils, PlayerType, ChooseCardsPrompt } from '../../../game';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { ABILITY_USED, WAS_POWER_USED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DRAW_CARDS } from '../../../game/store/prefabs/prefabs';
import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';

export class Delphox extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Braixen';
  public hp: number = 160;
  public cardType: CardType[] = [R];
  public weakness = [{ type: W }];
  public retreat = [C, C];

  public powers = [
    {
      name: 'Flaring Magic',
      powerType: PowerType.ABILITY,
      useWhenInPlay: true,
      text: 'Once during your turn, you may discard a Basic [R] Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand.',
    },
  ];

  public attacks = [
    {
      name: 'Energized Storm',
      cost: [R, R],
      damage: 30,
      damageCalculation: 'x',
      text: 'This attack does 30 damage for each Energy attached to all Pokémon.',
    },
  ];

  public regulationMark = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '13';
  public name: string = 'Delphox';
  public fullName: string = 'Delphox M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;
      if (player.active.getPokemonCard() !== this) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }
      // TA-361: refuse a direct second use too (menu filtering alone lets a dispatched
      // useAbility through) — silvally.ts's POWER_ALREADY_USED pattern.
      if (player.active.boardEffect.includes(BoardEffect.ABILITY_USED)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }
      // TA-372 (B.41 self-side, #2042): "discard a Basic [R] … Draw cards until you have 7" —
      // at hand ≥ 8 the post-discard hand is already ≥ 7, the draw arm provably draws ZERO, and
      // the discard is pure cost; withhold (rotomancer does; the Lacey/TA-349 shape).
      if (player.hand.cards.length - 1 >= 7) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }
      const basicRInHand = player.hand.cards.filter(
        (c) =>
          c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.provides.includes(R),
      );
      if (basicRInHand.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }
      // TA-384 / B.49 (2026-09-07): the cost is the PLAYER's pick. This used to `find` the first Basic
      // [R] and discard it with no prompt — even over two candidates, and even when they were different
      // printings of basic Fire. B.49 pins CF-14's collapse at exactly ONE candidate, counted by iid
      // (CF-60: the iid is the identity; the two resolutions leave different iids in the hand and the
      // wire distinguishes them), so two candidates surface a `discard` pick — rotomancer's shape on
      // the fz-atk-cri-013 seed. The Flashing Draw (jtg-055) idiom: `allowCancel:false, min:1, max:1`
      // — a cost is not declinable once the Ability is declared (B.30 rule 1) — and on ONE candidate the
      // decomposer's CHOOSE_CARD_TO_DISCARD collapse keeps the atomic resolution.
      const blocked: number[] = [];
      player.hand.cards.forEach((c, i) => {
        if (!basicRInHand.includes(c)) {
          blocked.push(i);
        }
      });
      state = store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        player.hand,
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { allowCancel: false, min: 1, max: 1, blocked }
      ), cards => {
        if (cards === null || cards.length === 0) {
          return state;
        }
        // TA-361: "Once during your turn" — mark the slot used at the point of no return, or the
        // Ability is re-offered AND a second use is accepted the same turn (TA-212's shape).
        ABILITY_USED(player, this);
        cards.forEach(card => player.hand.moveCardTo(card, player.discard));
        const toDraw = Math.max(0, 7 - player.hand.cards.length);
        if (toDraw > 0) {
          DRAW_CARDS(store, state, player, toDraw);
        }
      });
    }
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      let totalEnergy = 0;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        const checkEnergy = new CheckProvidedEnergyEffect(player, cardList);
        store.reduceEffect(state, checkEnergy);
        checkEnergy.energyMap.forEach((em) => {
          totalEnergy += em.provides.length;
        });
      });
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList) => {
        const checkEnergy = new CheckProvidedEnergyEffect(opponent, cardList);
        store.reduceEffect(state, checkEnergy);
        checkEnergy.energyMap.forEach((em) => {
          totalEnergy += em.provides.length;
        });
      });
      effect.damage = 30 * totalEnergy;
    }
    return state;
  }
}
