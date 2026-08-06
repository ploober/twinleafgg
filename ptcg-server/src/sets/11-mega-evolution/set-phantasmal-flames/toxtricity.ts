import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType, EnergyType } from '../../../game/store/card/card-types';
import { PowerType, GameMessage, PlayerType, SlotType, AttachEnergyPrompt, StateUtils, State, StoreLike, GameError, CardTarget } from '../../../game';

import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { Effect } from '../../../game/store/effects/effect';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { ABILITY_USED, SHUFFLE_DECK, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class Toxtricity extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Toxel';
  public cardType: CardType = D;
  public hp: number = 140;
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public powers = [{
    name: 'Sinister Surge',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    // SD-11 round 2 / TA-198: this text had dropped "Benched" from the attach target. Restored from
    // the UNANIMOUS authoritative record; rotomancer matches.
    text: 'Once during your turn, you may use this Ability. Search your deck for a Basic Darkness Energy card and attach it to 1 of your Benched Darkness Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, place 2 damage counters on that Pokémon.'
  }];

  public attacks = [{
    name: 'Gentle Slap',
    cost: [D, D, C],
    damage: 100,
    text: ''
  }];

  public regulationMark = 'I';
  public set: string = 'PFL';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '68';
  public name: string = 'Toxtricity';
  public fullName: string = 'Toxtricity M2';

  public readonly BAD_BOOST_MARKER = 'BAD_BOOST_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      player.marker.removeMarker(this.BAD_BOOST_MARKER, this);
    }

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      if (player.marker.hasMarker(this.BAD_BOOST_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      // TA-213 / B.27: the Energy is attached to "1 of your BENCHED Darkness Pokemon", so with no
      // benched Darkness Pokemon there is no legal destination and the Ability may not be used
      // (#49/#75/#2109). Note this is NOT the #127 fruitless-search case that made blk-067 a
      // rotomancer defect: there the deck search itself was performable and merely found nothing,
      // whereas here the search would SUCCEED and the ATTACHMENT is what is impossible. #1661 has
      // the Rules Team skipping a deck search outright "since you know there won't be any effect".
      //
      // `player.bench` is a fixed-length slot array, so its .length is always the bench size and
      // never a measure of occupancy (TA-200/SD-12) -- occupancy has to come from getPokemonCard().
      const hasBenchedDarkness = player.bench.some(b => {
        const benched = b.getPokemonCard();
        return benched !== undefined && benched.cardType === CardType.DARK;
      });
      if (!hasBenchedDarkness) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      const blocked2: CardTarget[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
        if (card.cardType !== CardType.DARK) {
          blocked2.push(target);
        }
      });

      state = store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        player.deck,
        PlayerType.BOTTOM_PLAYER,
        // TA-198: the target is "1 of your BENCHED Darkness Pokémon", so SlotType.ACTIVE does not
        // belong here -- with it, the Active was offered as a legal attach target. Measured live on
        // a board whose Active was Okidogi ex sfa-036 (Darkness) and whose only Bench slot was
        // Toxtricity itself: twinleaf offered TWO attach targets (a1 and ab1) where rotomancer
        // correctly offered ONE (ab1). Note the prompt message directly above is already
        // ATTACH_ENERGY_TO_BENCH -- the slot list was contradicting the card's own prompt.
        [SlotType.BENCH],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Darkness Energy' },
        { allowCancel: true, min: 0, max: 1, blockedTo: blocked2 }
      ), transfers => {
        transfers = transfers || [];
        ABILITY_USED(player, this);
        player.marker.addMarker(this.BAD_BOOST_MARKER, this);

        // cancelled by user
        if (transfers.length === 0) {
          SHUFFLE_DECK(store, state, player);
          return;
        }

        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          player.deck.moveCardTo(transfer.card, target);
          SHUFFLE_DECK(store, state, player);
          target.damage += 20;
        }
      });
      return state;
    }

    if (effect instanceof EndTurnEffect && effect.player.marker.hasMarker(this.BAD_BOOST_MARKER, this)) {
      effect.player.marker.removeMarker(this.BAD_BOOST_MARKER, this);
    }

    return state;
  }
}
