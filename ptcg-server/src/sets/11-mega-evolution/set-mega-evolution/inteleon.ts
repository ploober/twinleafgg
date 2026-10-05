import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { CardTarget, ChoosePokemonPrompt, GameError, GameMessage, PlayerType, SlotType, State, StateUtils, StoreLike } from '../../../game';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CheckHpEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { DISCARD_X_ENERGY_FROM_THIS_POKEMON } from '../../../game/store/prefabs/costs';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Inteleon extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Drizzile';
  public cardType: CardType[] = [W];
  public hp: number = 150;
  public weakness = [{ type: L }];
  public retreat = [C];

  public attacks = [{
    name: 'Bring Down',
    cost: [W],
    damage: 0,
    text: 'The Pokémon in play that has the least HP remaining, except for this Pokémon, is Knocked Out. (If there are multiple Pokémon, choose 1.)'
  },
  {
    name: 'Water Shot',
    cost: [W],
    damage: 110,
    text: 'Discard an Energy from this Pokémon.'
  }];

  public set: string = 'MEG';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '41';
  public name: string = 'Inteleon';
  public fullName: string = 'Inteleon M1S';
  public regulationMark = 'I';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = effect.opponent;
      // TA-615: "the least HP REMAINING" — the current HP (CheckHpEffect, reduced so HP modifiers apply) minus the
      // damage on it. The CheckHpEffect was never reduced and damage was ignored, so every Pokémon with the same
      // printed HP was offered.
      const remaining = (owner: typeof player, list: PokemonCardList): number => {
        const hpCheck = new CheckHpEffect(owner, list);
        store.reduceEffect(state, hpCheck);
        return hpCheck.hp - list.damage;
      };
      let leastHP = Infinity;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, list => {
        if (list !== player.active) { leastHP = Math.min(leastHP, remaining(player, list)); }
      });
      opponent.forEachPokemon(PlayerType.BOTTOM_PLAYER, list => {
        leastHP = Math.min(leastHP, remaining(opponent, list));
      });

      // making sure it gets put on the active pokemon
      if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
        if (effect.target !== effect.player.active) { throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD); }
      }

      // eliminating the pokemon that don't have the least hp from being chosen
      const blockedTo: CardTarget[] = [];
      // TA-141: this iterated the player's OWN Pokemon but stamped `PlayerType.TOP_PLAYER`.
      // `Player.forEachPokemon` writes that value verbatim into every emitted CardTarget, so the
      // attacker's own Active was blocked as `{TOP_PLAYER, ACTIVE, 0}` — the OPPONENT's Active.
      // Net effect: `blocked` came out as [1:1:0, 1:1:0] and the attacker itself stayed selectable,
      // which the card explicitly forbids ("except for this Pokémon").
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
        if (list === player.active || remaining(player, list) !== leastHP) { blockedTo.push(target); }
      });
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (list, card, target) => {
        if (remaining(opponent, list) !== leastHP) { blockedTo.push(target); }
      });

      store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON,
        PlayerType.ANY,
        [SlotType.ACTIVE, SlotType.BENCH],
        { min: 1, max: 1, blocked: blockedTo }
      ), target => {
        // TA-391: `KnockOutEffect(player, …)` named the ATTACKER as the Knocked-Out Pokemon's owner, so
        // choosing an OPPONENT's Pokemon sent its cards to the attacker's discard and handed the PRIZE
        // to the opponent (the KO'd side). The owner is whoever owns the chosen slot.
        const damageEffect = new KnockOutEffect(StateUtils.findOwner(state, target[0]), target[0]);
        store.reduceEffect(state, damageEffect);
      });
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      // B.82 (#1834, #2002): the choice is made before the damage; the chosen Energy moves after it (afterDamageMoves).
      DISCARD_X_ENERGY_FROM_THIS_POKEMON(store, state, effect, 1);
    }

    return state;
  }
}