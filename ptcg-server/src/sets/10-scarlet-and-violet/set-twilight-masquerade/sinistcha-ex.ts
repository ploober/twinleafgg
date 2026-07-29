import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType, CardTag } from '../../../game/store/card/card-types';
import { Card, StoreLike, State, PlayerType, GameMessage, SlotType, ChoosePokemonPrompt, EnergyCard, ShuffleDeckPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { HealTargetEffect, PutCountersEffect } from '../../../game/store/effects/attack-effects';

import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Sinistchaex extends PokemonCard {
  public tags = [CardTag.POKEMON_ex];
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Poltchageist';
  public cardType: CardType = CardType.GRASS;
  public hp: number = 240;
  public weakness = [{ type: CardType.FIRE }];
  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Re-Brew',
      cost: [CardType.COLORLESS],
      damage: 0,
      text: 'Put 2 damage counters on 1 of your opponent\'s Pokémon for each Basic [G] Energy card in your discard pile. Then, shuffle those Energy cards into your deck.'
    },
    {
      name: 'Matcha Splash',
      cost: [CardType.GRASS, CardType.COLORLESS],
      damage: 120,
      text: 'Heal 30 damage from each of your Pokémon.'
    },
  ];

  public set: string = 'TWM';
  public name: string = 'Sinistcha ex';
  public fullName: string = 'Sinistcha ex TWM';
  public regulationMark = 'H';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '23';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Re-Brew
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-144: ONE predicate drives both the count and the shuffle-back. The printed text is *"for each
      // Basic [G] Energy card in your discard pile … shuffle THOSE Energy cards into your deck"* — the same
      // set both times. The count used to test `superType === ENERGY && name === 'Grass Energy'` while the
      // move tested `instanceof EnergyCard && energyType === BASIC && …`, so the two could disagree about
      // what qualified. No current printing separates them, so this is a latent inconsistency rather than a
      // live miscount, but the card says "Basic" and both halves must read the card the same way.
      const isBasicGrass = (c: Card): boolean =>
        c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.name === 'Grass Energy';
      const grassInDiscard = player.discard.cards.filter(isBasicGrass).length;
      if (grassInDiscard === 0) {
        return state;
      }

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { operation: 'placeCounters', allowCancel: false }
      ), targets => {
        // TA-144, the one that actually cost the game: this prompt's result used to be DISCARDED. The call
        // was not returned and the trailing ShuffleDeckPrompt's state was returned instead, so the
        // `PutCountersEffect` below landed on a state nobody kept — the attack placed NOTHING (measured: 0
        // damage where rotomancer did 40). Returning the prompt and nesting the rest inside its callback
        // fixes that and puts the steps in printed order at the same time.
        const damageEffect = new PutCountersEffect(effect, 20 * grassInDiscard);
        damageEffect.target = targets[0];
        state = store.reduceEffect(state, damageEffect);

        // "THEN, shuffle those Energy cards into your deck" — after the placement, not beside it.
        // Snapshot before moving: `moveCardTo` splices out of `player.discard.cards`, so iterating that
        // array live skipped every second match (2 Basic [G] in the discard moved only 1, permanently
        // costing the player the Energy recursion the card promises and leaving the deck count wrong).
        const toDeck = player.discard.cards.filter(isBasicGrass);
        toDeck.forEach(c => player.discard.moveCardTo(c, player.deck));

        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      });
    }

    // Matcha Splash
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      player.forEachPokemon(PlayerType.TOP_PLAYER, (cardList) => {
        const healTargetEffect = new HealTargetEffect(effect, 30);
        healTargetEffect.target = cardList;
        state = store.reduceEffect(state, healTargetEffect);
      });
    }

    return state;
  }

}