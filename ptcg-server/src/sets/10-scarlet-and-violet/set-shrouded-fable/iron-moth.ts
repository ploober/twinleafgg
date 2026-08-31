import { PokemonCard, Stage, CardType, StoreLike, State, StateUtils, PlayerType, CardTag } from '../../../game';
import { ApplyWeaknessEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';
import { HealEffect } from '../../../game/store/effects/game-effects';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class IronMoth extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [CardType.FIRE];
  public hp: number = 120;
  public weakness = [{ type: CardType.WATER }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];
  protected _tags = [CardTag.FUTURE];

  public attacks = [
    {
      name: 'Suction',
      cost: [CardType.COLORLESS, CardType.COLORLESS],
      damage: 30,
      text: "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon.",
    },
    {
      name: 'Anachronism Repulsor',
      cost: [CardType.FIRE, CardType.FIRE, CardType.COLORLESS],
      damage: 120,
      text: 'During your next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.',
    },
  ];
  public regulationMark = 'H';
  public set: string = 'SFA';
  public name: string = 'Iron Moth';
  public fullName: string = 'Iron Moth SFA';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '9';

  public readonly WILD_REJECTOR_MARKER: string = 'WILD_REJECTOR_MARKER';
  public readonly CLEAR_WILD_REJECTOR_MARKER: string = 'CLEAR_WILD_REJECTOR_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      // "Heal from THIS Pokémon the same amount of damage you did" — heal Iron Moth itself, not
      // the opponent's Active. Targeting effect.target healed the wrong Pokémon and, when the
      // attack KO'd the opponent's Active, resolved to undefined → `Cannot read 'player'` (500).
      // Heal the ACTUAL damage dealt (post-Weakness/Resistance), not the pre-Weakness base — e.g.
      // 30 base against a Fire-weak Active deals 60, so it heals 60.
      const applyWeakness = new ApplyWeaknessEffect(effect, effect.damage);
      store.reduceEffect(state, applyWeakness);
      const dealt = applyWeakness.damage;
      if (dealt > 0) {
        const healEffect = new HealEffect(player, player.active, dealt);
        state = store.reduceEffect(state, healEffect);
      }
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      player.active.marker.addMarker(this.WILD_REJECTOR_MARKER, this);
      opponent.marker.addMarker(this.CLEAR_WILD_REJECTOR_MARKER, this);
      return state;
    }

    if (
      effect instanceof PutDamageEffect &&
      effect.target.marker.hasMarker(this.WILD_REJECTOR_MARKER)
    ) {
      const card = effect.source.getPokemonCard();
      const ancientPokemon = card && card.hasTag(CardTag.ANCIENT);

      if (ancientPokemon) {
        effect.preventDefault = true;
      }

      return state;
    }

    if (effect instanceof EndTurnEffect) {
      if (effect.player.marker.hasMarker(this.CLEAR_WILD_REJECTOR_MARKER, this)) {
        effect.player.marker.removeMarker(this.CLEAR_WILD_REJECTOR_MARKER, this);
        const opponent = StateUtils.getOpponent(state, effect.player);
        opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList) => {
          cardList.marker.removeMarker(this.WILD_REJECTOR_MARKER, this);
        });
      }
    }

    return state;
  }
}
