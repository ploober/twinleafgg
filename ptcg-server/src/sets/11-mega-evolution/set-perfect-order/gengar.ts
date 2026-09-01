import { PokemonCard, Stage, CardType, PowerType, StoreLike, State, StateUtils, GameLog, GamePhase, PokemonCardList } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED, IS_ABILITY_BLOCKED } from '../../../game/store/prefabs/prefabs';
import { PokemonCard as PokemonCardType } from '../../../game/store/card/pokemon-card';
import { KnockOutEffect, MoveCardsEffect } from '../../../game/store/effects/game-effects';

export class Gengar extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Haunter';
  public cardType: CardType[] = [D];
  public hp: number = 130;
  public weakness = [{ type: F }];
  public retreat = [C];

  public powers = [{
    name: 'Infinite Shadow',
    // TA-209: NOT player-activated. 'Infinite Shadow' is a PASSIVE ability -- a continuous replacement effect applied through KnockOutEffect below,
    // with no WAS_POWER_USED branch anywhere in this card. `useWhenInPlay: true` put it in the
    // menu as a `useAbility` the engine accepted and that did nothing; rotomancer never offered
    // it. Same fix as TA-77 (por-012) and TA-78 (meg-101).
    powerType: PowerType.ABILITY,
    text: 'If this Pokémon is Knocked Out by damage from an attack from your opponent\'s Pokémon, put it into your hand instead of the discard pile. (Discard all attached cards.)'
  }];

  public attacks = [{
    name: 'Mind Jack',
    cost: [D],
    damage: 10,
    damageCalculation: '+',
    text: 'This attack does 30 more damage for each of your opponent\'s Benched Pokémon.'
  }];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '50';
  public name: string = 'Gengar';
  public fullName: string = 'Gengar M3';


  public readonly INFINITE_SHADOW_MARKER = 'INFINITE_SHADOW_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Infinite Shadow — TA-344 (2026-09-01). "If this Pokémon is Knocked Out by damage from an attack
    // from your opponent's Pokémon, put it into your hand instead of the discard pile. (Discard all
    // attached cards.)" #2308: "this Pokémon" is the whole stack (Gastly/Haunter too); #2307: the
    // prize is still taken. The previous marker/DiscardCardsEffect/CheckTableStateEffect chain read
    // DAMAGE_DEALT_MARKER off the opponent — the marker sits on the DAMAGED Pokémon's owner — so it
    // never fired and the stack went to the discard.
    //
    // Two steps, because the core KO handler must still see the Pokémon in the slot (it reads
    // getPokemonCard() for the KO log, the ex/V prize rule and the prize accounting): (1) ARM at
    // KnockOutEffect time; (2) when the core's closing MoveCardsEffect sends the slot to the discard,
    // pull the Pokémon cards out to the hand first and let the attached cards go to the discard.
    if (effect instanceof KnockOutEffect && effect.target.getPokemonCard() === this) {
      const player = effect.player;
      const koByOpponentsAttack = state.phase === GamePhase.ATTACK
        && player.marker.hasMarker(player.DAMAGE_DEALT_MARKER);
      if (koByOpponentsAttack && !IS_ABILITY_BLOCKED(store, state, player, this)) {
        player.marker.addMarker(this.INFINITE_SHADOW_MARKER, this);
      }
    }

    if (effect instanceof MoveCardsEffect && effect.source instanceof PokemonCardList
      && effect.source.cards.includes(this)) {
      const player = StateUtils.findOwner(state, effect.source);
      if (effect.destination === player.discard && player.marker.hasMarker(this.INFINITE_SHADOW_MARKER, this)) {
        player.marker.removeMarker(this.INFINITE_SHADOW_MARKER, this);
        const stack = effect.source.cards.filter(card => card instanceof PokemonCardType);
        stack.forEach(card => {
          store.log(state, GameLog.LOG_PLAYER_RETURNS_CARD_TO_HAND, { name: player.name, card: card.name });
        });
        effect.source.moveCardsTo(stack, player.hand);
      }
    }

    // Mind Jack - damage based on opponent's benched Pokemon
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const opponent = effect.opponent;
      const benchCount = opponent.bench.filter(bench => bench.cards.length > 0).length;
      effect.damage = 10 + (benchCount * 30);
    }

    return state;
  }
}
