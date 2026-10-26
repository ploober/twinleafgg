import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, Card, State, ChoosePokemonPrompt, PlayerType, SlotType, StateUtils } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { DiscardCardsEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { GameMessage } from '../../../game/game-message';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { ChooseEnergyPrompt } from '../../../game/store/prompts/choose-energy-prompt';
import { DAMAGE_OPPONENT_POKEMON, WAS_ATTACK_USED, MAY_SEARCH_YOUR_DECK, SEARCH_YOUR_DECK_TO_HAND_THEN_SHUFFLE } from '../../../game/store/prefabs/prefabs';

export class Greninjaex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public regulationMark = 'H';
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Frogadier';
  public cardType: CardType[] = [F];
  public hp: number = 310;
  public weakness = [{ type: P }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Shinobi Blade',
      cost: [W],
      damage: 170,
      text: 'You may search your deck for a card and put it into your hand. Then, shuffle your deck.',
    },
    {
      name: 'Mirage Barrage',
      cost: [W, C, C],
      damage: 0,
      text: "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    },
  ];

  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '106';
  public name: string = 'Greninja ex';
  public fullName: string = 'Greninja ex TWM';

  public usedMirageBarrage: boolean = false;

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-784 (B.131, owner 2026-10-25; B.129): "You may search" is a confirm asked first, before the 170; declining
      // searches, looks at and shuffles nothing (this reverses TA-145's single decision, the pick with a stop). On yes
      // the search runs after the damage, and a search for "a card" must take one (#1980: "You don't have to search,
      // but if you do you must take a card and put it into your hand"). TA-126 / CF-9: the shuffle still fires on an
      // empty deck.
      return MAY_SEARCH_YOUR_DECK(store, state, effect, () => SEARCH_YOUR_DECK_TO_HAND_THEN_SHUFFLE(store, state, player, 1, 1));
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
      state = store.reduceEffect(state, checkProvidedEnergy);

      // B.82 / #2002: "You first CHOOSE the energy you're going to discard, then do the damage ..., and THEN discard
      // the energy." The chosen Energy stay attached through the target pick and the 120s (TA-610).
      const energyPrompt = new ChooseEnergyPrompt(
        player.id,
        GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
        checkProvidedEnergy.energyMap,
        [CardType.COLORLESS, CardType.COLORLESS],
        { allowCancel: false },
      );
      energyPrompt.deferredMove = true;
      state = store.prompt(
        state,
        energyPrompt,
        (energy) => {
          // TA-390: "2 of your opponent's Pokemon" is a FIXED count, not "up to 2" — `min: 1` offered a
          // stop after the first target (halving the attack) and left the forced second pick surfaced.
          // Pin min === max === min(2, available); the adapter collapses the forced set (CF-14, TA-317 idiom).
          const opponent = StateUtils.getOpponent(state, player);
          let available = 0;
          opponent.forEachPokemon(PlayerType.TOP_PLAYER, () => { available++; });
          const count = Math.min(2, available);
          return store.prompt(
            state,
            new ChoosePokemonPrompt(
              player.id,
              GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
              PlayerType.TOP_PLAYER,
              [SlotType.ACTIVE, SlotType.BENCH],
              { min: count, max: count, allowCancel: false },
            ),
            (selected) => {
              const targets = selected || [];
              DAMAGE_OPPONENT_POKEMON(store, state, effect, 120, targets);
              const cards: Card[] = (energy || []).map((e) => e.card);
              const discardEnergy = new DiscardCardsEffect(effect, cards);
              discardEnergy.target = player.active;
              store.reduceEffect(state, discardEnergy);
            },
          );
        },
      );
    }

    if (
      effect instanceof PutDamageEffect &&
      effect.target.cards.includes(this) &&
      effect.target.getPokemonCard() === this
    ) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Target is not Active
      if (effect.target === player.active || effect.target === opponent.active) {
        return state;
      }

      effect.preventDefault = true;
    }
    return state;
  }
}
