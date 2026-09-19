import { CardType, GamePhase, PokemonCard, PokemonCardList, PowerType, Stage, State, StateUtils, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { BeginTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { BLOCK_RETREAT } from '../../../game/store/prefabs/effect-of-attack-prefabs';

export class Maractus extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [G];
  public hp: number = 110;
  public weakness = [{ type: R }];
  public retreat = [C, C];

  public powers = [{
    name: 'Exploding Needles',
    powerType: PowerType.ABILITY,
    text: 'If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent\'s Pokémon, put 6 damage counters on the Attacking Pokémon.'
  }];

  public attacks = [{
    name: 'Corner',
    cost: [C],
    damage: 20,
    text: 'During your opponent\'s next turn, the Defending Pokémon can\'t retreat.'
  }];

  public set: string = 'JTG';
  public regulationMark: string = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '8';
  public name: string = 'Maractus';
  public fullName: string = 'Maractus JTG';

  /**
   * Names the Attacking Pokemon for a KO that has not happened yet. Exploding Needles fires in the KO
   * window (TA-438), by which time the attack — and any trailing effect of it — is over, so "the
   * Attacking Pokemon" has to be remembered from the damage step rather than re-derived from whoever
   * is Active at the KO. The marker's SOURCE is the attacking Pokemon card itself, and the counters
   * land only if that card is still in play: #2106's board is exactly the case where it is not.
   */
  public readonly EXPLODING_NEEDLES_ATTACKER = 'EXPLODING_NEEDLES_ATTACKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Remember the Attacking Pokemon while the attack is still happening (see the marker's doc).
    if (effect instanceof PutDamageEffect && effect.target.cards.includes(this) && effect.damage > 0) {
      const player = StateUtils.findOwner(state, effect.target);
      const attacker = effect.source.getPokemonCard();
      if (attacker !== undefined
        && effect.target.getPokemonCard() === this
        && effect.target === player.active
        && state.phase === GamePhase.ATTACK
        && state.players[state.activePlayer] !== player) {
        effect.target.marker.addMarker(this.EXPLODING_NEEDLES_ATTACKER, attacker);
      }
    }

    if (effect instanceof BeginTurnEffect) {
      for (const player of state.players) {
        for (const slot of [player.active, ...player.bench]) {
          if (slot.cards.includes(this)) {
            slot.marker.removeMarker(this.EXPLODING_NEEDLES_ATTACKER);
          }
        }
      }
    }

    // Exploding Needles
    //
    // TA-438 (#2106, Journey Together FAQ 2025-03-27: "Lillie's Comfey would go to the hand first and
    // then Exploding Needles would be triggered and find no valid target"). This is a KNOCK OUT
    // reaction, not a damage reaction: it triggers AFTER the attack's own effects have resolved, in
    // the KO window. Hooking `PutDamageEffect` and predicting the KO from `damage >= currentHp` fired
    // it INSIDE the damage step — the counters landed ahead of the attack's trailing effects, and
    // because the reaction never reached `KnockOutEffect` it was invisible to the KO window's
    // simultaneous batch (`Store.resolveKnockOutReactions`), so a board with two KO reactions offered
    // only one ordering candidate. On the KnockOutEffect path it is batched with its peers and the
    // prediction is replaced by the real Knock Out.
    if (effect instanceof KnockOutEffect && effect.target.cards.includes(this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // "If this Pokemon is in the Active Spot" — and is the top card of that stack, not a card
      // buried under an evolution.
      if (effect.target !== player.active || effect.target.getPokemonCard() !== this) {
        return state;
      }

      // "and is Knocked Out by damage from an attack from your opponent's Pokemon" — the attacker
      // remembered at the damage step, which is also the ATTACK-phase / opponent's-turn test the
      // engine's other KO reactions make (pyukumuku.ts, dunsparce.ts).
      if (state.phase !== GamePhase.ATTACK || state.players[state.activePlayer] !== opponent) {
        return state;
      }
      const stamped = effect.target.marker.markers
        .find(m => m.name === this.EXPLODING_NEEDLES_ATTACKER);
      const attacker = stamped?.source;
      if (attacker === undefined) {
        return state;
      }

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      // "put 6 damage counters on the Attacking Pokemon" — if it is still in play. #2106: a Lillie's
      // Comfey that Fade Outs into this Pokemon is back in its owner's hand by the time the KO window
      // opens (the bounce is an AfterAttackEffect, which CF-74 drains before the KO check), so
      // "Exploding Needles would be triggered and find no valid target". Reading `opponent.active`
      // instead is not the same question and gets that board WRONG — measured: it put the six counters
      // on the Pokemon the opponent had just promoted into the empty Active Spot.
      let attackerSlot: PokemonCardList | undefined;
      for (const slot of [opponent.active, ...opponent.bench]) {
        if (slot.cards.includes(attacker)) {
          attackerSlot = slot;
        }
      }
      if (attackerSlot === undefined) {
        return state;
      }
      attackerSlot.damage += 60;
    }
    // Corner
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return BLOCK_RETREAT(store, state, effect, this);
    }
    return state;
  }

}