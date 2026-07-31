import { PokemonCard, Stage, CardType, PowerType, StoreLike, State, StateUtils, ChooseCardsPrompt, GameMessage, SuperType, GamePhase } from '../../../game';
import { AfterDamageEffect, DiscardCardsEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { CoinFlipEffect } from '../../../game/store/effects/play-card-effects';
import { IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Turtonator extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = R;
  public hp: number = 120;
  public weakness = [{ type: W }];
  public retreat = [C, C];

  public powers = [{
    name: 'Shell Spikes',
    powerType: PowerType.ABILITY,
    text: 'If this Pokémon is in the Active Spot and is damaged by an attack from your opponent\'s Pokémon (even if this Pokémon is Knocked Out), discard an Energy from the Attacking Pokémon.'
  }];

  public attacks = [{
    name: 'Heat Breath',
    cost: [R, R, C],
    damage: 80,
    damageCalculation: '+',
    text: 'Flip a coin. If heads, this attack does 80 more damage.'
  }];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '17';
  public name: string = 'Turtonator';
  public fullName: string = 'Turtonator M3';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Shell Spikes — "If this Pokémon is in the Active Spot and is damaged by an attack from your
    // opponent's Pokémon (even if this Pokémon is Knocked Out), discard an Energy from the Attacking
    // Pokémon."
    //
    // TA-168: this used to hang off PutDamageEffect and then bail unless the damaged player already
    // carried DAMAGE_DEALT_MARKER. That marker is stamped by the PutDamageEffect REDUCER
    // (effect-reducers/attack-effect.ts), and `store.reduceEffect` runs `propagateEffect` — the card
    // handlers — BEFORE the reducers. So on the first damage of a turn the marker was never set yet
    // and the guard returned early every single time: the Ability never fired at all. It was found as
    // the negative control for the Mist Energy work (#2310, which says an Ability reaches through
    // Mist); the control row with no Mist in play is what proved Mist was not involved.
    //
    // AfterDamageEffect is the right hook and the established idiom here (cf. mega-scrafty-ex's
    // "Counter Crest"): the reducer only dispatches it inside `if (damage > 0)`, so "is damaged" is
    // expressed by the effect's own existence instead of by a downstream side effect, and it is
    // dispatched before the knock-out check — which is what "even if this Pokémon is Knocked Out"
    // needs.
    if (effect instanceof AfterDamageEffect && effect.target.getPokemonCard() === this
      && state.phase === GamePhase.ATTACK) {
      const player = StateUtils.findOwner(state, effect.target);

      // Must be Active, and the damage must come from the OPPONENT's attack (effect.player is the
      // attacking player, so a self-inflicted hit is excluded by the same test).
      if (player.active !== effect.target || player === effect.player) {
        return state;
      }

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      if (!effect.source || effect.source.energies.cards.length === 0) {
        return state;
      }

      // TA-168, second half: the chooser is the TURTONATOR player, not the attacker. Compendium
      // #2310: "you will get to discard YOUR CHOICE of an energy card from the attacking Pokemon" —
      // "you" is the player whose Turtonator it is. This prompted the opponent.
      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        effect.source,
        { superType: SuperType.ENERGY },
        { min: 1, max: 1, allowCancel: false }
      ), selected => {
        const cards = selected || [];
        if (cards.length > 0) {
          const discardEffect = new DiscardCardsEffect(effect.attackEffect, cards);
          // Target the ATTACKER: this keeps Mist Energy correctly out of it (#2310) — the guard in
          // mist-energy.ts only prevents effects whose target and source sit on opposite sides.
          discardEffect.target = effect.source;
          store.reduceEffect(state, discardEffect);
        }
      });
    }

    // Heat Breath - coin flip for +80 damage
    if (WAS_ATTACK_USED(effect, 0, this) && effect instanceof AttackEffect) {
      const player = effect.player;

      const coinFlipEffect = new CoinFlipEffect(player, (result: boolean) => {
        if (result === true) {
          effect.damage += 80;
        }
      });

      return store.reduceEffect(state, coinFlipEffect);
    }

    return state;
  }
}
