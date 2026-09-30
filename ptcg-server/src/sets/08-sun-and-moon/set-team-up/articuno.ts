import { AttachEnergyPrompt, GameMessage, PlayerType, PowerType, SlotType, State, StateUtils, StoreLike, pokemonHasCardType } from '../../../game';
import { CardType, Stage, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';

import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { IS_ABILITY_BLOCKED, WAS_ATTACK_USED, BLOCK_TRAINER_TARGET, IS_TRAINER_TARGET, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Articuno extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [W];

  public hp: number = 110;

  public weakness = [{ type: L }];

  public resistance = [{ type: F, value: -20 }];

  public retreat = [C, C];

  public powers = [{
    name: 'Blizzard Veil',
    powerType: PowerType.ABILITY,
    text: 'As long as this Pokémon is your Active Pokémon, whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to your Benched [W] Pokémon.'
  }];

  public attacks = [{
    name: 'Cold Cyclone',
    cost: [W, W],
    damage: 70,
    text: 'Move 2 [W] Energy from this Pokémon to 1 of your Benched Pokémon.'
  }];

  public set: string = 'TEU';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '32';

  public name: string = 'Articuno';

  public fullName: string = 'Articuno TEU';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const hasBench = player.bench.some(b => b.cards.length > 0);

      if (hasBench === false) {
        return state;
      }

      // A movable "[W] Energy" is any Energy that PROVIDES a valid [W]-ish type right now. Special Energy
      // (e.g. Splash Energy bkp-113) has a static provides:[] and yields [W] only DYNAMICALLY while it is
      // attached to a [W] Pokemon, so read the dynamic provided types via CheckProvidedEnergyEffect — a
      // static `provides` read omits it (F-026). Express the restriction as `blocked` (index list) rather
      // than `validCardTypes`, because the prompt's validate() AND the legalActions menu both filter
      // validCardTypes against the static `provides` array, which would drop the Splash Energy again.
      //
      // validTypes is upstream's post-9e6e302fd list: the WLFM/GRW pseudo-CardTypes are gone, and a blend
      // Energy now reports its REAL types in `provides`, so [WATER, ANY] still matches a WLFM blend.
      const validTypes = [CardType.WATER, CardType.ANY];
      const checkEnergy = new CheckProvidedEnergyEffect(player, player.active);
      store.reduceEffect(state, checkEnergy);
      const providesValidType = new Set(
        checkEnergy.energyMap
          .filter(em => em.provides.some(t => validTypes.includes(t)))
          .map(em => em.card)
      );
      const blocked: number[] = [];
      player.active.cards.forEach((card, index) => {
        if (card.superType === SuperType.ENERGY && !providesValidType.has(card)) {
          blocked.push(index);
        }
      });
      const numToMove = Math.min(2, providesValidType.size);
      if (numToMove === 0) {
        return state;
      }

      return store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        player.active,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { superType: SuperType.ENERGY },
        { allowCancel: false, min: numToMove, max: numToMove, blocked }
      ), transfers => {
        transfers = transfers || [];
        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          MOVE_CARDS(store, state, player.active, target, { cards: [transfer.card], sourceCard: this });
        }
      });
    }

    if (IS_TRAINER_TARGET(effect, { trainerType: TrainerType.SUPPORTER })) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (!opponent.active.cards.includes(this) || IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      const pokemonCard = effect.target.getPokemonCard && effect.target.getPokemonCard();
      if (pokemonCard) {
        const isWater = pokemonHasCardType(pokemonCard, CardType.WATER);
        if (isWater && opponent.bench.some(b => b === effect.target)) {
          BLOCK_TRAINER_TARGET(effect);
        }
      }
    }
    return state;
  }
}