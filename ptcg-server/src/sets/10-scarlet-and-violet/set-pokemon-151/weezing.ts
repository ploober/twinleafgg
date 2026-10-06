import { CardType, GamePhase, PokemonCard, PowerType, Stage, State, StateUtils, StoreLike } from '../../../game';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { COIN_FLIP_PROMPT, IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Weezing extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Koffing';
  public cardType: CardType[] = [D];
  public hp: number = 110;
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public powers = [{
    name: 'Let\'s Have a Blast',
    powerType: PowerType.ABILITY,
    text: 'If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your ' +
    'opponent\'s Pokémon, flip a coin. If heads, the Attacking Pokémon is Knocked Out.'
  }];

  public attacks = [{
    name: 'Spinning Fumes',
    cost: [C, C],
    damage: 50,
    text: 'This attack also does 10 damage to each of your opponent\'s Benched Pokémon. ' +
    '(Don\'t apply Weakness and Resistance for Benched Pokémon.)'
  }];

  public set: string = 'MEW';

  public regulationMark = 'G';

  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '110';
  public name: string = 'Weezing';
  public fullName: string = 'Weezing MEW';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof KnockOutEffect &&
      effect.target.getPokemonCard() === this &&
      effect.player.marker.hasMarker(effect.player.DAMAGE_DEALT_MARKER)
    ) {
      const player = StateUtils.findOwner(state, effect.target);
      const opponent = StateUtils.getOpponent(state, player);

      // Do not activate between turns, or when it's not opponents turn, or if abilities are blocked.
      if (state.phase !== GamePhase.ATTACK ||
        player.active.getPokemonCard() !== this ||
        state.players[state.activePlayer] !== opponent ||
        IS_ABILITY_BLOCKED(store, state, player, this)
      )
        return state;

      COIN_FLIP_PROMPT(store, state, player, (result) => {
        if (!result) {
          return;
        }
        // TA-563: the Attacking Pokémon's Knock Out joins Weezing's own Knock Out group (TA-577): the sweep that is
        // resolving Weezing re-collects it, discards BOTH before any Prize card is taken, and pays each player's Prize
        // once, the next player (Weezing's owner) first (#2026: Prize cards before the replacement Active). It was
        // dispatched here and its Prize asked at once (TAKE_X_PRIZES), with the Knocked Out Weezing still in the Active
        // Spot. TA-559's single payment is kept: the sweep is now the only place that pays it.
        opponent.active.knockedOutByEffect = true;
      });
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const opponent = effect.opponent;
      const benched = opponent.bench.filter(b => b.cards.length > 0);

      benched.forEach(target => {
        const damageEffect = new PutDamageEffect(effect, 10);
        damageEffect.target = target;
        store.reduceEffect(state, damageEffect);
      });
    }
    return state;
  }
}