import { CardType, Stage, SuperType } from '../../../game/store/card/card-types';
import { Attack, Card, ChooseCardsPrompt, CoinFlipPrompt, GameMessage, PokemonCard, Power, PowerType, State, StateUtils, StoreLike } from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { DealDamageEffect, DiscardCardsEffect } from '../../../game/store/effects/attack-effects';
import { IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Goldeen extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public regulationMark = 'H';

  public cardType: CardType = W;

  public hp: number = 50;

  public weakness = [{ type: L }];

  public retreat = [C];

  public powers: Power[] = [{
    name: 'Festival Lead',
    powerType: PowerType.ABILITY,
    text: 'If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent\'s Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon.'
  }];

  public attacks: Attack[] = [{
    name: 'Whirlpool',
    cost: [C, C],
    damage: 10,
    text: 'Flip a coin. If heads, discard an Energy from your opponent\'s Active Pokémon.'
  }];

  public set: string = 'TWM';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '44';

  public name: string = 'Goldeen';

  public fullName: string = 'Goldeen TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Rulebook attack step F / compendium #543, #649 (the TA-79 family): base damage is applied
      // BEFORE a post-damage rider. The flip PAUSES, so the 10 must already be placed. This was
      // latent while the early return above skipped the flip on an Energy-less defender — nothing
      // paused, so the core damage landed on its own. TA-306 made the flip real and exposed it.
      const damageEffect = new DealDamageEffect(effect, effect.damage);
      state = store.reduceEffect(state, damageEffect);
      effect.damage = 0;

      state = store.prompt(state, [
        new CoinFlipPrompt(player.id, GameMessage.COIN_FLIP)
      ], result => {
        if (result === true) {

          // TA-306 / compendium #1661 (Clefable "Moonlit Miracle", TPCi Rules Team 2022-02-24):
          // "You can use the attack no matter what, but AFTER FLIPPING COINS if you have no Pokemon
          // that can evolve the attack stops there." The flip is a mandated STEP of the attack, not a
          // decision, so CF-33's zero-achievable suppression does not reach it — only the DISCARD is
          // gated on a target existing. This guard used to sit above the flip: it skipped the flip
          // entirely on an Energy-less defender, AND it returned before the Festival Lead `barrage`
          // assignment below, so Whirlpool silently kept the previous invocation's barrage value.
          if (!opponent.active.cards.some(c => c.superType === SuperType.ENERGY)) {
            return;
          }

          let card: Card;
          return store.prompt(state, new ChooseCardsPrompt(
            player,
            GameMessage.CHOOSE_CARD_TO_DISCARD,
            opponent.active,
            { superType: SuperType.ENERGY },
            { min: 1, max: 1, allowCancel: false }
          ), selected => {
            card = selected[0];
            return store.reduceEffect(state, new DiscardCardsEffect(effect, [card]));
          });
        }
      });

      if (!IS_ABILITY_BLOCKED(store, state, effect.player, this)) {
        // Dynamically set barrage if Festival Grounds is in play
        const stadiumCard = StateUtils.getStadiumCard(state);
        if (stadiumCard && stadiumCard.name === 'Festival Grounds') {
          this.attacks[0].barrage = true;
        } else {
          this.attacks[0].barrage = false;
        }
      }
    }
    return state;
  }
}