import { YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_CONFUSED } from '../../../game/store/prefabs/attack-effects';
import { PokemonCard, Stage, CardType, CardTag, StoreLike, State, GameMessage, StateUtils, CardList, SuperType, ChooseAttackPrompt, Attack, GameLog, ShowCardsPrompt } from '../../../game';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { AFTER_ATTACK, SHUFFLE_DECK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

function* useHaughtyOrders(next: Function, store: StoreLike, state: State, effect: AttackEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  // TA-131: declarable even if the opponent's deck is empty (rulebook p.20) — the reveal whiffs.
  // TA-166 / CF-9 put-back boundary: with an empty deck nothing is revealed and nothing goes back,
  // so there is NO shuffle. #2377 (April 2026 rulebook update; #1022 and #1968 reversed the same
  // day): "you do not shuffle since you are not putting any cards back into the deck." CF-9's
  // unconditional shuffle governs a deck SEARCH (#2171) and does not reach a put-back. NOTE the
  // distinction that keeps this correct: zero CANDIDATES is not zero CARDS — revealing ten cards
  // none of which has a copyable attack still puts ten back, so that board DOES shuffle.
  const opponentTop10 = new CardList();
  opponent.deck.moveTo(opponentTop10, Math.min(10, opponent.deck.cards.length));
  const toppedPokemon = opponentTop10.cards.filter(card => card.superType === SuperType.POKEMON) as PokemonCard[];

  // showing the prompt to both players at the same time, although this is having a weird effect where if the user tries to use an attack before the opponent has confirmed their side of the prompt, the effect won't go through but the damage does
  store.prompt(state, [
    new ShowCardsPrompt(player.id, GameMessage.CARDS_SHOWED_BY_EFFECT, opponentTop10.cards, { allowCancel: false }),
    new ShowCardsPrompt(opponent.id, GameMessage.CARDS_SHOWED_BY_EFFECT, opponentTop10.cards, { allowCancel: false }),
  ], results => {
    const putBack = opponentTop10.cards.length;
    opponentTop10.moveTo(opponent.deck);
    if (putBack > 0) {
      SHUFFLE_DECK(store, state, opponent);
    }
  });

  // if there's no pokemon in the top ten cards, move on
  if (toppedPokemon.length === 0) {
    return state;
  }

  for (let retryCount = 0; retryCount < 3; retryCount++) {
    let selected: any;
    yield store.prompt(state, new ChooseAttackPrompt(
      player.id,
      GameMessage.CHOOSE_ATTACK_TO_COPY,
      toppedPokemon,
      { allowCancel: true }
    ), result => {
      selected = result;
      next();
    });

    const attack: Attack | null = selected;

    if (attack === null) {
      return state; // Player chose to cancel
    }

    try {
      store.log(state, GameLog.LOG_PLAYER_COPIES_ATTACK, {
        name: player.name,
        attack: attack.name
      });

      const attackEffect = new AttackEffect(player, opponent, attack);
      state = store.reduceEffect(state, attackEffect);

      if (store.hasPrompts()) {
        yield store.waitPrompt(state, () => next());
      }

      if (attackEffect.damage > 0) {
        const dealDamage = new DealDamageEffect(attackEffect, attackEffect.damage);
        state = store.reduceEffect(state, dealDamage);
      }

      return state; // Successfully executed attack, exit the function
    } catch (error) {
      console.log('Attack failed:', error);
      retryCount++;
      if (retryCount >= 3) {
        console.log('Max retries reached. Exiting loop.');
        return state;
      }
    }
  }
}

export class TeamRocketsPersianex extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Team Rocket\'s Meowth';
  public tags = [CardTag.TEAM_ROCKET, CardTag.POKEMON_ex];
  public cardType: CardType = C;
  public hp: number = 260;
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Haughty Order',
      cost: [C, C],
      damage: 0,
      text: 'Your opponent reveals the top 10 cards of their deck. You may choose an attack from a Pokemon you find there and use it as this attack. Your opponent shuffles the revealed cards back into their deck.'
    },
    {
      name: 'Cruel Slash',
      cost: [C, C, C],
      damage: 140,
      text: 'Your opponent\'s Active Pokemon is now Confused.'
    }
  ];

  public set: string = 'DRI';
  public regulationMark = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '150';
  public name: string = 'Team Rocket\'s Persian ex';
  public fullName: string = 'Team Rocket\'s Persian ex DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Haughty Order
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const generator = useHaughtyOrders(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    // Cruel Slash
    if (AFTER_ATTACK(effect, 1, this)) {
      YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_CONFUSED(store, state, effect);
    }

    return state;
  }
}
