import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType, EnergyType } from '../../../game/store/card/card-types';

import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { Effect } from '../../../game/store/effects/effect';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { PowerType, StoreLike, State, GameError, GameMessage, AttachEnergyPrompt, PlayerType, SlotType, StateUtils, CardTarget, pokemonHasCardType } from '../../../game';
import { ABILITY_USED, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class Barbaracle extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Binacle';
  public cardType: CardType[] = [F];
  public hp: number = 130;
  public weakness = [{ type: G }];
  public retreat = [C, C];

  public powers = [{
    name: 'Stone Arms',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, you may use this Ability. Attach a Basic [F] Energy from your hand to 1 of your [F] Pokémon.'
  }];

  public attacks = [{
    name: 'Hammer In',
    cost: [F, F, C],
    damage: 80,
    text: ''
  }];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '43';
  public name: string = 'Barbaracle';
  public fullName: string = 'Barbaracle M3';

  public readonly STONE_ARMS_MARKER = 'STONE_ARMS_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      player.marker.removeMarker(this.STONE_ARMS_MARKER, this);
    }

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      if (player.marker.hasMarker(this.STONE_ARMS_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      // TA-218 / B.29 rule 1: the Energy comes from HAND and must be a Basic [F], so a non-empty
      // hand holding no Basic Fighting Energy is still an empty operand set -- the attach cannot be
      // performed and the Ability must not be offered (#49/#75/#2109). Measured live on a hand of
      // one Basic Water Energy: twinleaf offered Stone Arms, rotomancer withheld it.
      //
      // The predicate mirrors the AttachEnergyPrompt filter below exactly, so the guard and the
      // prompt cannot disagree about what counts as a legal source.
      const hasBasicFighting = player.hand.cards.some((c: any) =>
        c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC
        && c.name === 'Fighting Energy');
      if (!hasBasicFighting) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      const blocked2: CardTarget[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
        if (!pokemonHasCardType(card, CardType.FIGHTING)) {
          blocked2.push(target);
        }
      });

      state = store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        player.hand,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH, SlotType.ACTIVE],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Fighting Energy' },
        { allowCancel: false, min: 0, max: 1, blockedTo: blocked2 }
      ), transfers => {
        transfers = transfers || [];
        ABILITY_USED(player, this);
        player.marker.addMarker(this.STONE_ARMS_MARKER, this);
        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          player.hand.moveCardTo(transfer.card, target);
        }
      });
      return state;
    }

    if (effect instanceof EndTurnEffect && effect.player.marker.hasMarker(this.STONE_ARMS_MARKER, this)) {
      effect.player.marker.removeMarker(this.STONE_ARMS_MARKER, this);
    }

    return state;
  }
}
