import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardTag, CardType, Stage, SuperType } from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  GameMessage,
  ChooseCardsPrompt,
  PowerType,
  GameLog,
  StateUtils,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PlayPokemonFromDeckEffect } from '../../../game/store/effects/play-card-effects';
import { IS_ABILITY_BLOCKED, SHUFFLE_DECK } from '../../../game/store/prefabs/prefabs';
import { AfterDamageEffect } from '../../../game/store/effects/attack-effects';

export class TeamRocketsKoffing extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.TEAM_ROCKET];
  public cardType: CardType[] = [D];
  public hp: number = 70;
  public weakness = [{ type: F }];
  public retreat = [C];

  public powers = [{
    name: 'Smog Signals',
    powerType: PowerType.ABILITY,
    text: 'If this Pokémon is in the Active Spot and is damaged by an attack from your opponent\'s Pokémon (even if this Pokémon is Knocked Out), search your deck for up to 2 Pokémon with Koffing in their name and put them onto your Bench. Then, shuffle your deck.'
  }];

  public attacks = [
    {
      name: 'Leaking Gas',
      cost: [D, C],
      damage: 30,
      text: '',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '125';
  public name: string = "Team Rocket's Koffing";
  public fullName: string = "Team Rocket's Koffing DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof AfterDamageEffect && effect.target.getPokemonCard() === this) {
      const player = StateUtils.findOwner(state, effect.target);

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      const openSlots = player.bench.filter((b) => b.cards.length === 0);

      // #2171's own carve-out: no Bench space -> no search at all (and so no shuffle).
      if (openSlots.length === 0) {
        return state;
      }

      store.log(state, GameLog.LOG_PLAYER_USES_ABILITY, { name: player.name, ability: this.name });

      // TA-396(d): with Bench space the search is MANDATORY even over an empty deck (#2171: "you must
      // search your deck and shuffle it afterwards"), and the shuffle it owes is still owed — the old
      // early return skipped both. A 0-card shuffle is atomic on the wire (CF-11), so nothing pends.
      if (player.deck.cards.length === 0) {
        return SHUFFLE_DECK(store, state, player);
      }

      // 🚨 NO CONFIRMATION PROMPT. Smog Signals is MANDATORY -- compendium #2171, on this exact
      // Ability: "The use of the Ability is not optional, so if you have bench space available you
      // must search your deck and shuffle it afterwards. Of course you can voluntarily fail the deck
      // search, but you must search and shuffle your deck." The card prints no "you may".
      //
      // The opt-out the player is entitled to is the VOLUNTARY FAIL, and it already exists one level
      // down as `min: 0` on the pick. Wrapping the whole Ability in a confirm added a SECOND opt-out
      // that the rules do not grant, and declining it skipped the mandated shuffle entirely -- which
      // is not cosmetic, since an unshuffled deck leaves a known order in the player's favour.
      // (#2171's bench-full case is the early return above: no space, so no search at all.)
      const maxPokemons = Math.min(openSlots.length, 2);

      const blocked: number[] = [];
      player.deck.cards.forEach((card, index) => {
        if (!card.name.includes('Koffing')) {
          blocked.push(index);
        }
      });

      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_PUT_ONTO_BENCH,
        player.deck,
        { superType: SuperType.POKEMON },
        { min: 0, max: Math.min(2, maxPokemons), allowCancel: false, blocked }
      ), selectedCards => {
        const cards = selectedCards || [];

        cards.forEach((card, index) => {
          store.reduceEffect(state, new PlayPokemonFromDeckEffect(player, card as PokemonCard, openSlots[index]));
        });

        SHUFFLE_DECK(store, state, player);
      });
    }

    return state;
  }
}
