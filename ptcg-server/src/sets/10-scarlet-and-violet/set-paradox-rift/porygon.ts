import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike, State, AttachEnergyPrompt, PlayerType, SlotType, StateUtils } from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { GameMessage } from '../../../game/game-message';
import { AFTER_ATTACK, COIN_FLIP_PROMPT, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Porygon extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [C];
  public hp: number = 60;
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [{
    name: 'Data Displacement',
    cost: [C],
    damage: 10,
    text: 'Flip a coin. If heads, move an Energy from your opponent\'s Active Pokémon to 1 of their Benched Pokémon.'
  }];

  public regulationMark = 'G';

  public set: string = 'PAR';
  public name: string = 'Porygon';
  public fullName: string = 'Porygon PAR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '142';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // TA-494 (B.84 (1), (3); #571): the flip only gates the move, so the flip, the choice and the move are effects of
    // the attack and come after its damage (AFTER_ATTACK); the damage reads the Energy attached (#77). On heads the
    // move is mandatory ("move an Energy"): min 1, no decline. Nothing to move (no Energy on the Active or no Benched
    // Pokémon) is checked at heads, after the flip.
    if (AFTER_ATTACK(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      return COIN_FLIP_PROMPT(store, state, player, result => {
        if (result !== true) {
          return state;
        }
        const hasBench = opponent.bench.some(b => b.cards.length > 0);
        const hasEnergy = opponent.active.cards.some(c => c.superType === SuperType.ENERGY);
        if (!hasBench || !hasEnergy) {
          return state;
        }

        return store.prompt(state, new AttachEnergyPrompt(
          player.id,
          GameMessage.ATTACH_ENERGY_TO_BENCH,
          opponent.active,
          PlayerType.TOP_PLAYER,
          [SlotType.BENCH],
          { superType: SuperType.ENERGY },
          { allowCancel: false, min: 1, max: 1 }
        ), transfers => {
          transfers = transfers || [];
          for (const transfer of transfers) {
            const target = StateUtils.getTarget(state, player, transfer.to);
            MOVE_CARDS(store, state, opponent.active, target, { cards: [transfer.card], sourceCard: this });
          }
        });
      });
    }
    return state;
  }
}