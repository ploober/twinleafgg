import { GamePhase, PlayerType, PowerType, State, StoreLike, pokemonHasCardTypeOptional } from '../../../game';
import { CardType, EnergyType, Stage, SuperType } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { CONFIRMATION_PROMPT, IS_ABILITY_BLOCKED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Huntail extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Clamperl';
  public cardType: CardType[] = [W];
  public hp: number = 110;
  public weakness = [{ type: L }];
  public retreat = [C];

  public powers = [
    {
      name: 'Diver\'s Catch',
      powerType: PowerType.ABILITY,
      text: 'You may use this Ability whenever 1 of your [W] Pokémon is Knocked Out by damage from an opponent\'s Pokémon\'s attack. Return all Basic [W] Energy attached to the Knocked Out Pokémon to your hand instead of discarding them.'
    }
  ];

  public attacks = [{
    name: 'Wave Splash',
    cost: [W, C, C],
    damage: 80,
    text: ''
  }];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '55';
  public name: string = 'Huntail';
  public fullName: string = 'Huntail DRI';


  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Diver's Catch — ONE firing PER Knocked Out [W] Pokémon (the printed "that Pokémon"), asked AT the
    // KO, not between turns (TA-432). Before this, the KO handler only MARKED the Energy and a between-
    // turns handler raised one confirm for every victim at once and rescued the cards from the discard —
    // two per-Pokémon "you may"s folded into one all-or-nothing decision, offered after the opponent's
    // Prize picks. As a candidate of the CF-38 KO batch (`Store.resolveKnockOutReactions`) this runs
    // BEFORE the core KO, so the answer lands while the victim is still in play and the Energy goes to
    // hand INSTEAD OF the discard pile; on the single-reactor legacy path the core KO has already
    // discarded it by the time the answer arrives, so the rescue is by card identity wherever the cards
    // now sit. Either way it is this victim's Energy and nobody else's.
    if (effect instanceof KnockOutEffect) {
      const player = effect.player;

      // Do not activate between turns, or when it's not opponents turn.
      if (state.phase !== GamePhase.ATTACK) {
        return state;
      }
      if (IS_ABILITY_BLOCKED(store, state, player, this)) { return state; }
      if (!pokemonHasCardTypeOptional(effect.target.getPokemonCard(), CardType.WATER)) { return state; }

      let isThisInPlay = false;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, card => {
        if (card.getPokemonCard() === this) {
          isThisInPlay = true;
        }
      });
      if (!isThisInPlay) { return state; }

      const target = effect.target;
      const rescued = target.cards.filter(card => card.superType === SuperType.ENERGY && card.energyType === EnergyType.BASIC && card.name === 'Water Energy');
      if (rescued.length === 0) { return state; }

      CONFIRMATION_PROMPT(store, state, player, result => {
        if (!result) {
          return;
        }
        const stillAttached = rescued.filter(c => target.cards.includes(c));
        const inDiscard = rescued.filter(c => player.discard.cards.includes(c));
        if (stillAttached.length > 0) {
          MOVE_CARDS(store, state, target, player.hand, { cards: stillAttached });
        }
        if (inDiscard.length > 0) {
          MOVE_CARDS(store, state, player.discard, player.hand, { cards: inDiscard });
        }
      });
    }

    return state;
  }
}