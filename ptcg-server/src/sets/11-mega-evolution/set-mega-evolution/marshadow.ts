import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { GamePhase, PlayerType, StateUtils, StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AbstractAttackEffect } from '../../../game/store/effects/attack-effects';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
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

  private usedShadowySideKick = false;

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Attack: Shadowy Side Kick
    // Ref: set-plasma-freeze/kakuna.ts (prevent damage/effects), set-crimson-invasion/guzzlord-gx.ts (KO-conditional flag)
    if (WAS_ATTACK_USED(effect, 0, this)) {
      this.usedShadowySideKick = true;
    }

    // If an opponent's Pokemon is KO'd by this attack's damage, protect Marshadow next turn.
    // TA-87: two bugs fixed here — (1) KnockOutEffect.player is the KO'd Pokémon's OWNER, not the attacker,
    // so the old `effect.target === opponent.active` guard never matched and the marker was added to the
    // wrong Pokémon; (2) the exact-lethal attack KO is processed LATE (after AFTER_ATTACK), so the old
    // EndTurnEffect flag-reset — which fires mid-attack (still ATTACK phase) — cleared `usedShadowySideKick`
    // before the KnockOutEffect arrived. We now consume the flag only in this branch (guarded to the ATTACK
    // phase and to Marshadow being the attacker's Active, so a lingering flag can't mis-fire).
    if (effect instanceof KnockOutEffect
      && this.usedShadowySideKick
      && state.phase === GamePhase.ATTACK) {
      const koOwner = effect.player;                            // opponent — loses the KO'd Pokémon
      const attacker = StateUtils.getOpponent(state, koOwner);  // Marshadow's owner

      if (attacker.active.getPokemonCard() === this && effect.target.getPokemonCard()) {
        attacker.active.marker.addMarker(this.PREVENT_ALL_DAMAGE_AND_EFFECTS, this);
        koOwner.marker.addMarker(this.CLEAR_PREVENT_ALL_DAMAGE_AND_EFFECTS, this);
        this.usedShadowySideKick = false;
      }
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

    // NB: no during-attack reset of `usedShadowySideKick` — the exact-lethal KO is processed *after*
    // AFTER_ATTACK, so any earlier reset (the old EndTurnEffect one) races ahead of the KnockOutEffect.
    // The flag is consumed in the KO branch above; a lingering flag (attack that didn't KO) is inert
    // because the KO branch only fires while Marshadow is the ATTACKER's Active in the ATTACK phase.

    return state;
  }
}
