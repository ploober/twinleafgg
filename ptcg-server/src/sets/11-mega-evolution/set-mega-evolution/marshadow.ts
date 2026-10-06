import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { GamePhase, PlayerType, StateUtils, StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AbstractAttackEffect } from '../../../game/store/effects/attack-effects';
import { BeginTurnEffect, EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Marshadow extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [F];
  public hp: number = 90;
  public weakness = [{ type: P }];
  public retreat = [C];

  public attacks = [{
    name: 'Shadowy Side Kick',
    cost: [F, F],
    damage: 60,
    text: 'If your opponent\'s Pokémon is Knocked Out by damage from this attack, during your opponent\'s next turn, prevent all damage from and effects of attacks done to this Pokémon.'
  }];

  public set: string = 'MEG';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '80';
  public name: string = 'Marshadow';
  public fullName: string = 'Marshadow M1L';
  public regulationMark = 'I';

  private readonly PREVENT_ALL_DAMAGE_AND_EFFECTS = 'PREVENT_ALL_DAMAGE_AND_EFFECTS';
  private readonly CLEAR_PREVENT_ALL_DAMAGE_AND_EFFECTS = 'CLEAR_PREVENT_ALL_DAMAGE_AND_EFFECTS';

  private readonly SHADOWY_SIDE_KICK_USED = 'SHADOWY_SIDE_KICK_USED';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Attack: Shadowy Side Kick
    // Ref: set-plasma-freeze/kakuna.ts (prevent damage/effects), set-crimson-invasion/guzzlord-gx.ts (KO-conditional flag)
    //
    // TA-524: "this attack was used" lives on Marshadow's SLOT (game state), never on the card instance. The KO
    // window probes every in-play card against a CLONE of the state (Store.probe), and Card instances are shared
    // between the clone and the real state: a card-instance flag consumed by the probe was gone when the real
    // KnockOutEffect arrived (a TA-87 regression). A slot marker is cloned with the probe state, so the probe
    // consumes only its own copy.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      effect.player.active.marker.addMarker(this.SHADOWY_SIDE_KICK_USED, this);
    }

    // The attack's KO is processed in the KO sweep (after AFTER_ATTACK), still in the ATTACK phase of the
    // attacking player's turn. TA-87: KnockOutEffect.player is the KO'd Pokémon's OWNER, not the attacker.
    if (effect instanceof KnockOutEffect && state.phase === GamePhase.ATTACK) {
      const koOwner = effect.player;                            // opponent — loses the KO'd Pokémon
      const attacker = StateUtils.getOpponent(state, koOwner);  // Marshadow's owner
      const slot = attacker.active;
      if (state.players[state.activePlayer] === attacker
        && slot.getPokemonCard() === this
        && slot.marker.hasMarker(this.SHADOWY_SIDE_KICK_USED, this)
        && effect.target.getPokemonCard()) {
        slot.marker.removeMarker(this.SHADOWY_SIDE_KICK_USED, this);
        slot.marker.addMarker(this.PREVENT_ALL_DAMAGE_AND_EFFECTS, this);
        koOwner.marker.addMarker(this.CLEAR_PREVENT_ALL_DAMAGE_AND_EFFECTS, this);
      }
    }

    // A Side Kick that Knocked Out nothing leaves its marker; it lapses when the next turn begins (the attack's KO
    // window always completes before the turn advances).
    if (effect instanceof BeginTurnEffect) {
      state.players.forEach(p => p.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
        cardList.marker.removeMarker(this.SHADOWY_SIDE_KICK_USED, this);
      }));
    }

    // Prevent damage and effects when marker is set
    // Ref: set-cosmic-eclipse/alolan-persian-gx.ts (Smug Face - AbstractAttackEffect for all effects)
    if (effect instanceof AbstractAttackEffect
      && effect.target.cards.includes(this)
      && effect.target.marker.hasMarker(this.PREVENT_ALL_DAMAGE_AND_EFFECTS, this)) {
      effect.preventDefault = true;
      return state;
    }

    // Cleanup at end of opponent's turn
    if (effect instanceof EndTurnEffect && effect.player.marker.hasMarker(this.CLEAR_PREVENT_ALL_DAMAGE_AND_EFFECTS, this)) {
      effect.player.marker.removeMarker(this.CLEAR_PREVENT_ALL_DAMAGE_AND_EFFECTS, this);
      const opponent = StateUtils.getOpponent(state, effect.player);
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList) => {
        cardList.marker.removeMarker(this.PREVENT_ALL_DAMAGE_AND_EFFECTS, this);
      });
    }

    return state;
  }
}
