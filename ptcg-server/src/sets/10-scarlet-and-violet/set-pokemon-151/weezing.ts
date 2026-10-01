import { CardType, GamePhase, PokemonCard, PowerType, Stage, State, StateUtils, StoreLike } from '../../../game';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { COIN_FLIP_PROMPT, IS_ABILITY_BLOCKED, TAKE_X_PRIZES, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

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
        // Ability-triggered KO — not attack-sourced, so KnockOutEffect is used directly
        const ko = new KnockOutEffect(opponent, opponent.active);
        // TA-559 (2026-10-01): this card pays the Prize cards itself, at once (TAKE_X_PRIZES below), so the
        // engine's direct-KO accumulator (state.pendingDirectKoPrizes, CF-7) must not record this KO as well -
        // it did, and the owner took the Attacking Pokemon's Prize cards twice. The accumulator's only test is
        // `viaCheckState`. Paying here rather than through the accumulator keeps the order rotomancer drives on
        // the same board: the owner takes this Prize before the attacker takes Weezing's, both before either
        // player promotes (#2026: prizes are taken before the replacement Active is chosen); the accumulator
        // drains at the NEXT sweep, after the promotions.
        ko.viaCheckState = true;
        store.reduceEffect(state, ko);
        return TAKE_X_PRIZES(store, state, player, ko.prizeCount);
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