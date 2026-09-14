import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { CardTarget, GameMessage, PlayerType, SlotType, State, StoreLike } from '../../../game';
import { ChoosePokemonPrompt } from '../../../game/store/prompts/choose-pokemon-prompt';
import { CheckPokemonTypeEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK } from '../../../game/store/prefabs/prefabs';

export class Vikavolt extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = 'Charjabug';
  public hp: number = 160;
  public cardType: CardType[] = [L];
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [{
    name: 'Volt Switch',
    cost: [L],
    damage: 90,
    text: 'Switch this Pokémon with 1 of your Benched Lightning Pokémon.'
  },
  {
    name: 'Sparking Strike',
    cost: [L, L, C, C],
    damage: 240,
    text: ''
  }];

  public regulationMark = 'H';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '66';
  public name: string = 'Vikavolt';
  public fullName: string = 'Vikavolt ASC';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Volt Switch — TA-418: the text has no "may", so no confirm is offered. With no Benched
    // Lightning Pokémon the switch whiffs silently (an offer that can do nothing is not surfaced,
    // §B.27); with candidates the pick is mandatory — restricted to Lightning (the old prompt let
    // ANY benched Pokémon in), and a lone candidate collapses under CF-14. Idiom: Heliolisk TEU.
    if (AFTER_ATTACK(effect, 0, this)) {
      const player = effect.player;

      const blocked: CardTarget[] = [];
      player.bench.forEach((bench, index) => {
        if (bench.cards.length === 0) {
          blocked.push({ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index });
          return;
        }
        const checkType = new CheckPokemonTypeEffect(bench);
        store.reduceEffect(state, checkType);
        if (!checkType.cardTypes.includes(CardType.LIGHTNING)) {
          blocked.push({ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index });
        }
      });

      const hasLightningBench = player.bench.some((bench, index) => {
        return bench.cards.length > 0 && !blocked.some(b => b.index === index);
      });

      if (hasLightningBench) {
        store.prompt(state, new ChoosePokemonPrompt(
          player.id,
          GameMessage.CHOOSE_NEW_ACTIVE_POKEMON,
          PlayerType.BOTTOM_PLAYER,
          [SlotType.BENCH],
          { allowCancel: false, blocked }
        ), selected => {
          if (selected && selected.length > 0) {
            player.switchPokemon(selected[0], store, state);
          }
        });
      }
    }

    return state;
  }
}
