import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, ChoosePokemonPrompt, GameMessage, PlayerType, SlotType, CardTarget } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { HealTargetEffect } from '../../../game/store/effects/attack-effects';

export class Dolliv extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Smoliv';
  public cardType: CardType[] = [G];
  public hp: number = 90;
  public weakness = [{ type: R }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Nutrients',
      cost: [G],
      damage: 0,
      text: 'Heal 40 damage from 1 of your Pokémon.'
    },
    {
      name: 'Tackle',
      cost: [C, C],
      damage: 40,
      text: ''
    }
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '22';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Dolliv';
  public fullName: string = 'Dolliv DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Nutrients
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // Compendium (Audino "Busybody" / Moonlit Hill): you can only heal a Pokemon that HAS
      // damage. Restrict the pick to damaged Pokemon so a board with none skips the heal
      // (no-op, turn ends) and a single damaged Pokemon collapses instead of surfacing a
      // forced 1-option `choose` — the CF-14 over-pend rotomancer already auto-resolves.
      const blocked: CardTarget[] = [];
      let hasDamaged = false;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
        if (cardList.damage > 0) { hasDamaged = true; } else { blocked.push(target); }
      });
      if (!hasDamaged) { return state; }

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_HEAL,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { allowCancel: false, blocked }
      ), targets => {
        if (!targets || targets.length === 0) {
          return;
        }
        const damageEffect = new HealTargetEffect(effect, 40);
        damageEffect.target = targets[0];
        store.reduceEffect(state, damageEffect);
      });
    }

    return state;
  }
}
