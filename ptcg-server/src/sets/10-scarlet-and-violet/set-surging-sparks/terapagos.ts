import { PokemonCard, Stage, CardType, StoreLike, State, GameMessage, StateUtils, AttachEnergyPrompt, CardTag, CardTarget, EnergyType, PlayerType, SlotType, SuperType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import {SHUFFLE_DECK, WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Terapagos extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [C];
  public hp: number = 120;
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Prism Charge',
      cost: [C],
      damage: 0,
      text: 'Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.',
    },
    {
      name: 'Hard Tackle',
      cost: [C, C, C],
      damage: 100,
      text: '',
    },
  ];

  public regulationMark = 'H';
  public set: string = 'SSP';
  public setNumber: string = '161';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Terapagos';
  public fullName: string = 'Terapagos SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      let teraPokemonInPlay = false;

      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card) => {
        if (card.hasTag(CardTag.POKEMON_TERA)) {
          teraPokemonInPlay = true;
        }
      });

      // Compendium #361: a conditional-target attach ("to your Tera Pokémon") is still a legal
      // attack with no valid target — the effect simply does nothing (a whiff). Terapagos itself is
      // a Basic (not Tera), so with no Tera Pokémon in play this is a no-op, NOT a rejection. [TA-52]
      if (!teraPokemonInPlay) {
        return state;
      }

      const blocked2: CardTarget[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
        if (!card.hasTag(CardTag.POKEMON_TERA)) {
          blocked2.push(target);
        }
      });

      // return store.prompt(state, new ChoosePokemonPrompt(
      //   player.id,
      //   GameMessage.ATTACH_ENERGY_TO_BENCH,
      //   PlayerType.BOTTOM_PLAYER,
      //   [SlotType.BENCH, SlotType.ACTIVE],
      //   { min: 0, max: 2, blocked: blocked2 }
      // ), chosen => {

      //   chosen.forEach(target => {

      state = store.prompt(
        state,
        new AttachEnergyPrompt(
          player.id,
          GameMessage.ATTACH_ENERGY_TO_ACTIVE,
          player.deck,
          PlayerType.BOTTOM_PLAYER,
          [SlotType.BENCH, SlotType.ACTIVE],
          { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
          { allowCancel: false, min: 0, max: 3, blockedTo: blocked2 },
        ),
        (transfers) => {
          transfers = transfers || [];

        // "Then, shuffle your deck." — searching your deck ALWAYS requires a shuffle afterward,
        // whether 0 or up-to-3 Energy were attached (B.33 / compendium #2171 "up to X"; TA-330).
        // The prior code shuffled ONLY on the zero-attach branch (and discarded SHUFFLE_DECK's
        // returned state via a bare `return;`); the >=1-attach branch moved the searched cards but
        // never re-shuffled the now-revealed deck, so twinleaf skipped the mandated shuffle whenever
        // any Energy was attached (rotomancer shuffles on both branches).
        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          MOVE_CARDS(store, state, player.deck, target, { cards: [transfer.card], sourceCard: this });
        }
        return SHUFFLE_DECK(store, state, player);
      });
    }
    return state;
  }
}
