import { PokemonCard } from '../../../game/store/card/pokemon-card';
import {
  Stage,
  CardType,
  CardTag,
  SuperType,
  EnergyType,
} from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  PlayerType,
  SlotType,
  AttachEnergyPrompt,
  ChoosePokemonPrompt,
  CardTarget,
  PokemonCardList,
  StateUtils,
} from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { GameMessage } from '../../../game/game-message';
import { AFTER_ATTACK, MOVE_CARDS, SHUFFLE_DECK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { Player } from '../../../game/store/state/player';

// TA-472: the rider runs AFTER_ATTACK, so the 100 base damage lands first (#649 / #543).
// TA-478: two printed decisions - the recipients (up to 3 Benched, a CF-4 aggregate), then for each recipient
// its own search with the target fixed (min 0: the search may fail to find). B.44: zero recipients = no search =
// no shuffle; any performed search owes the one closing shuffle.
function* flameSurge(next: Function, store: StoreLike, state: State, player: Player, self: ChiYuex): IterableIterator<State> {
  let recipients: PokemonCardList[] = [];
  yield store.prompt(state, new ChoosePokemonPrompt(
    player.id,
    GameMessage.ATTACH_ENERGY_TO_BENCH,
    PlayerType.BOTTOM_PLAYER,
    [SlotType.BENCH],
    { min: 0, max: 3, allowCancel: false },
  ), selected => {
    recipients = selected || [];
    next();
  });

  if (recipients.length === 0) {
    return state;
  }

  for (const recipient of recipients) {
    const blockedTo: CardTarget[] = [];
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
      if (list !== recipient) {
        blockedTo.push(target);
      }
    });
    yield store.prompt(state, new AttachEnergyPrompt(
      player.id,
      GameMessage.ATTACH_ENERGY_TO_BENCH,
      player.deck,
      PlayerType.BOTTOM_PLAYER,
      [SlotType.BENCH],
      { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Fire Energy' },
      { allowCancel: false, min: 0, max: 1, blockedTo },
    ), transfers => {
      for (const transfer of transfers || []) {
        MOVE_CARDS(store, state, player.deck, recipient, { cards: [transfer.card], sourceCard: self });
      }
      next();
    });
  }

  return SHUFFLE_DECK(store, state, player);
}

export class ChiYuex extends PokemonCard {
  public regulationMark = 'G';

  protected _tags = [CardTag.POKEMON_ex];

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.FIRE];

  public hp: number = 190;

  public weakness = [{ type: CardType.WATER }];

  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Jealously Singe',
      cost: [CardType.FIRE],
      damage: 0,
      text: "Discard the top 2 cards of your opponent's deck.",
    },
    {
      name: 'Flame Surge',
      cost: [CardType.FIRE, CardType.FIRE],
      damage: 100,
      text: 'Choose up to 3 of your Benched Pokémon. For each of those Pokémon, search your deck for a Basic [R] Energy card and attach it to that Pokémon. Then, shuffle your deck.',
    },
  ];

  public set: string = 'PAL';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '40';

  public name: string = 'Chi-Yu ex';

  public fullName: string = 'Chi-Yu ex PAL';

  // Implement power
  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Discard 1 card from opponent's deck
      MOVE_CARDS(store, state, opponent.deck, opponent.discard, {
        count: 2,
        sourceCard: this,
        sourceEffect: this.attacks[0],
      });
    }

    if (AFTER_ATTACK(effect, 1, this)) {
      const player = effect.player;
      if (!player.bench.some(b => b.cards.length > 0)) {
        return state;
      }
      const generator = flameSurge(() => generator.next(), store, state, player, this);
      return generator.next().value;
    }
    return state;
  }
}
