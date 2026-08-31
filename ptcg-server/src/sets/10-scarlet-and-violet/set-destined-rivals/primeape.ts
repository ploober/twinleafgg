import { PokemonCard, Stage, CardType, State, StoreLike, ChoosePokemonPrompt, GameMessage, PlayerType, SlotType, StateUtils } from '../../../game';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';
import { AfterAttackEffect } from '../../../game/store/effects/game-phase-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Primeape extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Mankey';
  public cardType: CardType[] = [F];
  public hp: number = 110;
  public weakness = [{ type: P }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Drag Off',
      cost: [F],
      damage: 0,
      text: 'Switch in 1 of your opponent\'s Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.'
    }
  ];

  public set: string = 'DRI';
  public regulationMark = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '91';
  public name: string = 'Primeape';
  public fullName: string = 'Primeape DRI';

  public usedDragOff: boolean = false;

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      this.usedDragOff = true;
    }

    if (effect instanceof AfterAttackEffect && this.usedDragOff) {
      // TA-243 / SD-16: `usedDragOff` was set on WAS_ATTACK_USED and never cleared ANYWHERE, so once
      // this Primeape had attacked, its handler re-fired on every later AfterAttackEffect in the game
      // — including the OPPONENT'S. `effect.player` binds to whoever just attacked, so the opponent
      // then got Drag Off for free against us: their attack ended by dragging one of OUR benched
      // Pokemon into the Active Spot and dealing it 30. The flag is a within-attack handoff from
      // WAS_ATTACK_USED to this handler, so clear it unconditionally on entry, and only proceed when
      // THIS card is the one that attacked. Same fix as TA-232 (Team Rocket's Crobat ex); the safe
      // idiom is `mega-latias-ex.ts`.
      this.usedDragOff = false;
      const player = effect.player;
      if (player.active.getPokemonCard() !== this) {
        return state;
      }
      const opponent = StateUtils.getOpponent(state, player);

      const hasBench = opponent.bench.some(b => b.cards.length > 0);

      if (!hasBench) {
        return state;
      }

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_SWITCH,
        PlayerType.TOP_PLAYER,
        [SlotType.BENCH],
        { allowCancel: false }
      ), result => {
        const cardList = result[0];
        opponent.switchPokemon(cardList);

        const afterDamage = new DealDamageEffect(effect.attackEffect, 30);
        afterDamage.target = opponent.active;
        store.reduceEffect(state, afterDamage);
      });
    }

    return state;
  }
}
