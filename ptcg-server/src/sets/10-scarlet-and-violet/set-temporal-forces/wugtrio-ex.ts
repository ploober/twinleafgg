import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, SuperType } from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  GameMessage,
  ChooseCardsPrompt,
  ChoosePokemonPrompt,
  PlayerType,
  SlotType,
} from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Card } from '../../../game/store/card/card';
import {DAMAGE_OPPONENT_POKEMON, TERA_RULE, WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { BLOCK_RETREAT } from '../../../game/store/prefabs/effect-of-attack-prefabs';

/**
 * "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon
 * for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)"
 *
 * The damage is 60 for each Energy discarded, so with 0 discarded ("up to 3" is 0..3, compendium #2301) the
 * attack does no damage and there is nothing to choose a target for: the target pick is asked only when at
 * least one Energy was discarded (the Flareon ex PRE Burning Charge pattern).
 */
function* useTricolorPump(
  next: Function,
  store: StoreLike,
  state: State,
  effect: AttackEffect,
  self: Wugtrioex,
): IterableIterator<State> {
  const player = effect.player;
  let cards: Card[] = [];

  yield store.prompt(
    state,
    new ChooseCardsPrompt(
      player,
      GameMessage.CHOOSE_CARD_TO_DISCARD,
      player.hand,
      { superType: SuperType.ENERGY },
      { allowCancel: false, min: 0, max: 3 },
    ),
    (selected) => {
      cards = selected || [];
      MOVE_CARDS(store, state, player.hand, player.discard, { cards: cards, sourceCard: self });
      next();
    },
  );

  if (cards.length === 0) {
    return state;
  }

  return store.prompt(
    state,
    new ChoosePokemonPrompt(
      player.id,
      GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
      PlayerType.TOP_PLAYER,
      [SlotType.ACTIVE, SlotType.BENCH],
      { allowCancel: false },
    ),
    (selected) => {
      const targets = selected || [];
      DAMAGE_OPPONENT_POKEMON(store, state, effect, 60 * cards.length, targets);
    },
  );
}

export class Wugtrioex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Wiglett';
  public cardType: CardType[] = [L];
  public hp: number = 250;
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Tricolor Pump',
      cost: [W],
      damage: 0,
      text: "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    },
    {
      name: 'Numbing Hold',
      cost: [W, W],
      damage: 120,
      text: "During your opponent's next turn, the Defending Pokémon can't retreat.",
    },
  ];

  public set: string = 'TEF';
  public name: string = 'Wugtrio ex';
  public fullName: string = 'Wugtrio ex TEF';
  public regulationMark = 'H';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '60';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Tricolor Pump
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const generator = useTricolorPump(() => generator.next(), store, state, effect as AttackEffect, this);
      return generator.next().value;
    }

    // Numbing Hold
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return BLOCK_RETREAT(store, state, effect, this);
    }
    TERA_RULE(effect, state, this);

    return state;
  }
}
