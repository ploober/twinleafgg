import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike, State, PokemonCardList, GameMessage, CardTarget, ChoosePokemonPrompt, PlayerType, SlotType, StateUtils, ChooseCardsPrompt } from '../../../game';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';


function* useCleaningUp(next: Function, store: StoreLike, state: State,
  effect: AttackEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  let pokemonsWithTool = 0;
  const blocked: CardTarget[] = [];
  opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card, target) => {
    if (cardList.tools.length > 0) {
      pokemonsWithTool += 1;
    } else {
      blocked.push(target);
    }
  });

  // "Discard up to 2 Pokémon Tools" is a whiff: with no Tools in play there is nothing to discard,
  // but the attack is still legal to use — it just does nothing. Do not reject it (an offer-then-reject
  // would hide the attack from the menu). Same whiff-is-a-no-op class as regice-ex / slowpoke (TA-46/52).
  if (pokemonsWithTool === 0) {
    return state;
  }

  // We will discard this card after prompt confirmation
  effect.preventDefault = true;

  // TA-155 / compendium #6242: for ATTACK effects, "up to X" means any number between 0 and X —
  // the player may discard nothing. min:1+allowCancel expressed the 0 option only through the UI's
  // cancel, which the wire cannot see (the declared range IS the wire contract, and a 1..1 range
  // auto-resolves as decisionless per CF-14). min:0 declares the real range. Note the ruling's
  // asymmetry: Trainer/Ability "up to X" is 1..X, so min:1 stays correct on those (Blowtorch, Ruffian).
  const max = Math.min(2, pokemonsWithTool);
  let targets: PokemonCardList[] = [];
  yield store.prompt(state, new ChoosePokemonPrompt(
    player.id,
    GameMessage.CHOOSE_POKEMON_TO_DISCARD_CARDS,
    PlayerType.TOP_PLAYER,
    [SlotType.ACTIVE, SlotType.BENCH],
    { min: 0, max: max, allowCancel: true, blocked }
  ), results => {
    targets = results || [];
    next();
  });

  if (targets.length === 0) {
    return state;
  }

  targets.forEach(target => {
    const owner = StateUtils.findOwner(state, target);
    if (target.tools.length > 0) {
      if (target.tools.length > 1) {
        // Prompt to choose up to 2 tools
        store.prompt(state, new ChooseCardsPrompt(
          player,
          GameMessage.CHOOSE_CARD_TO_DISCARD,
          target,
          { superType: SuperType.TRAINER, trainerType: TrainerType.TOOL },
          { min: 1, max: 2, allowCancel: false }
        ), selected => {
          if (selected && selected.length > 0) {
            target.moveCardsTo(selected, owner.discard);
          }
        });
      } else {
        target.moveCardTo(target.tools[0], owner.discard);
      }
    }
  });

  return state;
}

export class Minccino extends PokemonCard {

  public regulationMark = 'H';

  public stage: Stage = Stage.BASIC;

  public cardType: CardType = CardType.COLORLESS;

  public hp: number = 70;

  public weakness = [{ type: CardType.FIGHTING }];

  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Beat',
      cost: [CardType.COLORLESS],
      damage: 10,
      text: ''
    },
    {
      name: 'Cleaning Up',
      cost: [CardType.COLORLESS, CardType.COLORLESS],
      damage: 0,
      text: 'Discard up to 2 Pokémon Tools from your opponent\'s Pokémon.'
    }
  ];

  public set: string = 'TEF';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '136';

  public name: string = 'Minccino';

  public fullName: string = 'Minccino TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // "Cleaning Up" is attack index 1 (index 0 is "Beat", a vanilla 10-damage attack with no
    // reduceEffect). Binding this handler to index 0 made declaring "Beat" run the tool-discard —
    // which throws CANNOT_PLAY_THIS_CARD when the opponent has no tools, so the attack menu hid
    // "Beat" entirely and offered only "Cleaning Up". (Wrong-attack-index class, cf. TA-49/TA-58.)
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const generator = useCleaningUp(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }

}
