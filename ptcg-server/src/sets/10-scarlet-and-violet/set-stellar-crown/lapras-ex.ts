import { AttachEnergyPrompt, Card, CardList, CardTag, CardType, EnergyCard, GameMessage, PlayerType, PokemonCard, ShowCardsPrompt, ShuffleDeckPrompt, SlotType, Stage, State, StateUtils, StoreLike, SuperType } from '../../../game';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';

import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Laprasex extends PokemonCard {

  public cardType = CardType.WATER;

  public tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];

  public hp = 220;

  public stage = Stage.BASIC;

  public weakness = [{ type: CardType.METAL }];

  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    {
      name: 'Power Splash',
      cost: [CardType.WATER],
      damage: 40,
      damageCalculation: 'x',
      text: 'This attack does 40 damage for each Energy attached to this Pokémon.'
    },
    {
      name: 'Larimar Rain',
      cost: [CardType.WATER, CardType.PSYCHIC, CardType.METAL],
      damage: 0,
      text: 'Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.'
    }
  ];

  public regulationMark = 'H';

  public set: string = 'SCR';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '32';

  public name: string = 'Lapras ex';

  public fullName: string = 'Lapras ex SCR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {

      const player = effect.player;

      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
        if (cardList.getPokemonCard() === this) {
          const checkProvidedEnergy = new CheckProvidedEnergyEffect(player, cardList);
          store.reduceEffect(state, checkProvidedEnergy);

          const blockedCards: Card[] = [];

          checkProvidedEnergy.energyMap.forEach(em => {
            if (!em.provides.includes(CardType.ANY)) {
              blockedCards.push(em.card);
            }
          });

          const damagePerEnergy = 40;

          effect.damage = checkProvidedEnergy.energyMap.length * damagePerEnergy;
        }
      });

      return state;
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      // TA-251 / B.33: on an EMPTY deck this attack owes nothing. Its shuffle's printed object is
      // *"the other cards"* — the ones looked at and not attached — and a look that returned none
      // leaves no such cards, so the shuffle is suppressed (#1979: a prevented antecedent suppresses
      // the consequent). This is the OPPOSITE of TA-250, where the object is *"your deck"* and
      // survives. Twinleaf's own `tef-072`/`tef-171` Summoning Gate and `ssp-142` Cinnabar Lure print
      // the identical construction and already emit nothing; this card was the odd one out.
      // Without the guard the empty look also opened a degenerate ShowCardsPrompt over zero cards.
      if (player.deck.cards.length === 0) {
        return state;
      }

      const temp = new CardList();
      player.deck.moveTo(temp, 20); // look at the top 20 (or fewer)

      // "Shuffle the other cards back into your deck." — after the optional attach,
      // return every card still in `temp` (non-attached energy + all non-energy) to
      // the deck and shuffle ONCE. (The old code fired a ShuffleDeckPrompt per card,
      // which stranded most of them and left the deck/shuffle inconsistent.)
      const returnAndShuffle = (): void => {
        temp.moveTo(player.deck);
        store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      };

      const energyInTemp = temp.cards.filter(card => card instanceof EnergyCard);

      // No attachable Energy in the top 20: reveal them, then shuffle back.
      if (energyInTemp.length === 0) {
        return store.prompt(state, new ShowCardsPrompt(
          player.id,
          GameMessage.CARDS_SHOWED_BY_EFFECT,
          temp.cards
        ), () => { returnAndShuffle(); });
      }

      return store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_CARDS,
        temp,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH, SlotType.ACTIVE],
        { superType: SuperType.ENERGY },
        { min: 0, max: energyInTemp.length }
      ), transfers => {
        for (const transfer of (transfers || [])) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          temp.moveCardTo(transfer.card, target);
        }
        returnAndShuffle();
      });
    }

    if (effect instanceof PutDamageEffect && effect.target.cards.includes(this) && effect.target.getPokemonCard() === this) {
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
