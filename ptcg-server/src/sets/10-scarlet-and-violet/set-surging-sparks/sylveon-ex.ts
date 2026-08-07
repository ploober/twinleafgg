import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { ChoosePokemonPrompt, GameError, GameMessage, PlayerType, ShuffleDeckPrompt, SlotType, State, StateUtils, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED, DEFENDING_POKEMON_DOES_LESS_DAMAGE } from '../../../game/store/prefabs/prefabs';

export class Sylveonex extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Eevee';
  public tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public cardType: CardType = P;
  public hp: number = 270;
  public weakness = [{ type: M }];
  public retreat = [C, C];

  public attacks = [{
    name: 'Magical Charm',
    cost: [P, C, C],
    damage: 160,
    text: 'During your opponent\'s next turn, the Defending Pokemon\'s attacks do 100 less damage (before applying Weakness and Resistance).'
  },
  {
    name: 'Angelite',
    cost: [W, L, P],
    damage: 0,
    text: 'Choose 2 of your opponent\'s Benched Pokémon. They shuffle those Pokémon and all attached cards into their deck. If 1 of your Pokémon used Angelite during your last turn, this attack can\'t be used.'
  }];

  public regulationMark = 'H';
  public set: string = 'SSP';
  public setNumber: string = '86';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Sylveon ex';
  public fullName: string = 'Sylveon ex SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Magical Charm
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return DEFENDING_POKEMON_DOES_LESS_DAMAGE(store, state, effect, this, 100);
    }

    // Angelite
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const hasBench = opponent.bench.some(b => b.cards.length > 0);

      if (hasBench === false) {
        return state;
      }

      // "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used."
      //
      // Read `state.playerLastAttack` — the engine's own record of who attacked with what, and when —
      // rather than a private per-card marker (CF-49 / TA-227). The marker was wrong twice over:
      //   * it is scoped to THIS card instance, so a SECOND Sylveon ex having used Angelite last turn
      //     did not block this one, though the text says "1 of your POKEMON";
      //   * it has no wire representation, so the lockout vanished on a state round-trip — the engine
      //     projected `playerLastAttack` faithfully and then ignored it on ingest, handing the player
      //     back a spent attack.
      // `playerLastAttack` holds only the MOST RECENT attack, so comparing its turn to this player's
      // previous turn is what makes "during your LAST turn" exact: an Angelite from three turns ago,
      // or a different attack used since, correctly does not block.
      const last = state.playerLastAttack?.[player.id];
      if (last && last.attack.name === 'Angelite' && last.turn === state.turn - 2) {
        throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
      }

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.BENCH],
        { min: 1, max: 2, allowCancel: false },
      ), selected => {
        const targets = selected || [];

        targets.forEach(target => {
          target.clearEffects();
          target.damage = 0;
          target.moveTo(opponent.deck);

          return store.prompt(state, new ShuffleDeckPrompt(opponent.id), order => {
            opponent.deck.applyOrder(order);
          });
        });
      });
    }

    if (effect instanceof PutDamageEffect && effect.target.cards.includes(this) && effect.target.getPokemonCard() === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (effect.target === player.active || effect.target === opponent.active) {
        return state;
      }

      effect.preventDefault = true;
    }

    return state;
  }
}
