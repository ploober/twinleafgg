import { PokemonCard, Stage, CardType, State, StoreLike, PowerType, GameError, GameMessage, SuperType, CardTag } from '../../../game';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';

import { HAS_MARKER, ABILITY_USED, ADD_MARKER, REMOVE_MARKER_AT_END_OF_TURN, SEARCH_DECK_FOR_CARDS_TO_HAND, WAS_ATTACK_USED, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class Genesectex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public tags = [CardTag.POKEMON_ex];
  public cardType: CardType = M;
  public hp: number = 220;
  public weakness = [{ type: R }];
  public resistance = [{ type: G, value: -30 }];
  public retreat = [C, C];

  public powers = [{
    name: 'Metallic Signal',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, you may search your deck for up to 2 [M] Evolution Pokemon, reveal them, and put them into your hand. Then, shuffle your deck.'
  }];

  public attacks = [{
    name: 'Protect Charge',
    cost: [M, M, C],
    damage: 150,
    text: 'During your opponent\'s next turn, this Pokemon takes 30 less damage from attacks (after applying Weakness and Resistance).'
  }];

  public regulationMark = 'I';
  public set: string = 'BLK';
  public setNumber: string = '67';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Genesect ex';
  public fullName: string = 'Genesect ex SV11B';

  public readonly METAL_SIGNAL_MARKER = 'METAL_SIGNAL_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: any): State {
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      player.marker.removeMarker(this.METAL_SIGNAL_MARKER, this);
    }

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      if (HAS_MARKER(this.METAL_SIGNAL_MARKER, player, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      // TA-216 / B.29 rule 1: an EMPTY deck cannot be searched, so the action cannot be performed
      // and the Ability may not be used (#13). Deliberately `=== 0` and NOT a check for a matching
      // card: a search of a stocked deck that finds nothing is a legal use (#127, Floral Path), and
      // gating on a match would additionally leak deck contents through the legal-action set.
      //
      // This is the cell that RE-95 got backwards. That finding claimed rotomancer wrongly withheld
      // a fruitless search; rotomancer could not reproduce it and guessed our board's deck was empty
      // at the decision point. It was -- the scenario's endTurn actions drew all 4 cards -- so the
      // cell was measuring the empty-deck arm and convicting the wrong engine. Measured on a
      // genuinely non-empty deck holding no [M] Evolution, BOTH engines offer it.
      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      const blocked: number[] = [];
      player.deck.cards.forEach((card, index) => {
        if (!(card instanceof PokemonCard && card.cardType === CardType.METAL && card.evolvesFrom !== '' && card.stage !== Stage.LV_X)) {
          blocked.push(index);
        }
      });

      SEARCH_DECK_FOR_CARDS_TO_HAND(store, state, player, this, { superType: SuperType.POKEMON }, { min: 0, max: 2, allowCancel: false, blocked }, this.powers[0]);
      ABILITY_USED(player, this);
      ADD_MARKER(this.METAL_SIGNAL_MARKER, player, this);
    }

    REMOVE_MARKER_AT_END_OF_TURN(effect, this.METAL_SIGNAL_MARKER, this);

    if (WAS_ATTACK_USED(effect, 0, this)) {
      effect.player.active.damageReductionNextTurn = 30;
    }

    return state;
  }
}