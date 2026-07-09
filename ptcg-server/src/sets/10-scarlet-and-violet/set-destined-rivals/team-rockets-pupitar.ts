import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, SuperType } from '../../../game/store/card/card-types';
import { StoreLike, State, Card, ChooseCardsPrompt, GameMessage } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { SHUFFLE_DECK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';

function* useExplosiveAwakening(next: Function, store: StoreLike, state: State, effect: AttackEffect): IterableIterator<State> {
  const player = effect.player;

  if (player.deck.cards.length === 0) {
    // No search/shuffle happens on an empty deck — the framework deals the base 30 as usual.
    return state;
  }

  // Rulebook step F / compendium #543/#649: place the 30 on the Defending Pokémon BEFORE the deck
  // search prompt pauses (otherwise the Active read 0 at the search/shuffle pause — damage deferred
  // behind the effect). Same pattern as TA-66/TA-69.
  const damageEffect = new DealDamageEffect(effect, effect.damage);
  state = store.reduceEffect(state, damageEffect);
  effect.damage = 0;

  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_EVOLVE,
    player.deck,
    { superType: SuperType.POKEMON, stage: Stage.STAGE_2, evolvesFrom: 'Team Rocket\'s Pupitar' },
    // A deck search may find nothing — no Tyranitar present, or a voluntary fail (compendium #902/#903:
    // deck contents are private, so "search for a card that evolves from this" MAY be failed on purpose).
    // min:1 with zero eligible cards crashes the conformance decomposer instead of whiffing; min:0 lets
    // it resolve to "found nothing". The evolve is guarded on cards.length; the shuffle fires
    // unconditionally (compendium #2302: you still shuffle even on a failed search). Mirrors Dwebble TA-56.
    { min: 0, max: 1, allowCancel: true }
  ), selected => {
    cards = selected || [];
    next();
  });

  if (cards.length > 0) {
    // Evolve Pokemon
    player.deck.moveCardsTo(cards, player.active);
    player.active.clearEffects();
    player.active.pokemonPlayedTurn = state.turn;
  }

  SHUFFLE_DECK(store, state, player);
}

export class TeamRocketsPupitar extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Team Rocket\'s Larvitar';
  public tags = [CardTag.TEAM_ROCKET];
  public cardType: CardType = F;
  public hp: number = 100;
  public weakness = [{ type: G }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Explosive Ascension',
      cost: [C],
      damage: 30,
      text: 'Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.'
    }
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '95';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Team Rocket\'s Pupitar';
  public fullName: string = 'Team Rocket\'s Pupitar DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const generator = useExplosiveAwakening(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }
}
