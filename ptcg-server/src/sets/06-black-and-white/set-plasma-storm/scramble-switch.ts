import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardTag, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { ChoosePokemonPrompt } from '../../../game/store/prompts/choose-pokemon-prompt';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { PlayerType, SlotType, GameError, PokemonCardList, MoveEnergyPrompt, CardTarget, StateUtils } from '../../../game';
import { GameMessage } from '../../../game/game-message';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

function* playCard(
  next: Function,
  store: StoreLike,
  state: State,
  effect: TrainerEffect,
): IterableIterator<State> {
  const player = effect.player;
  const hasBench = player.bench.some((b) => b.cards.length > 0);

  if (hasBench === false) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  // Do not discard the card yet
  MOVE_CARDS(store, state, player.hand, player.supporter, { cards: [effect.trainerCard], sourceCard: effect.trainerCard });
  effect.preventDefault = true;

  let targets: PokemonCardList[] = [];
  yield store.prompt(
    state,
    new ChoosePokemonPrompt(
      player.id,
      GameMessage.CHOOSE_POKEMON_TO_SWITCH,
      PlayerType.BOTTOM_PLAYER,
      [SlotType.BENCH],
      { allowCancel: true },
    ),
    (results) => {
      targets = results || [];
      next();
    },
  );

  if (targets.length === 0) {
    return state;
  }

  const target = targets[0];

  // TA-700 / B.80 / B.81: the text switches FIRST ("Switch your Active Pokémon with 1 of your Benched Pokémon. If you
  // do, you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon"). The
  // old code raised the Energy prompt over the still-Active old Pokémon and switched only at its close, so the wire
  // projected the PRE-switch board at the Energy-move pending (the Energy addressed on A.active, no `moved` legs).
  // Switch, then offer the move from the Benched old Active to the new Active as a MoveEnergyPrompt — a relocation
  // is `moveEnergy` (CF-34), which is what rotomancer offers; the old ChooseCardsPrompt surfaced as `choose`.
  const oldActive = player.active;
  player.switchPokemon(target);
  const benchIndex = player.bench.indexOf(oldActive);
  const hasEnergies = oldActive.cards.some((c) => c.superType === SuperType.ENERGY);

  if (hasEnergies && benchIndex !== -1) {
    const at = (slot: SlotType, index: number): CardTarget => ({ player: PlayerType.BOTTOM_PLAYER, slot, index });
    // Source: only the Pokémon that was just moved to the Bench. Destination: only the new Active.
    const blockedFrom: CardTarget[] = [at(SlotType.ACTIVE, 0), ...player.bench.map((_, i) => i).filter(i => i !== benchIndex).map(i => at(SlotType.BENCH, i))];
    const blockedTo: CardTarget[] = player.bench.map((_, i) => at(SlotType.BENCH, i));
    yield store.prompt(
      state,
      new MoveEnergyPrompt(
        player.id,
        GameMessage.MOVE_ENERGY_TO_ACTIVE,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { superType: SuperType.ENERGY },
        { allowCancel: false, min: 0, blockedFrom, blockedTo },
      ),
      (transfers) => {
        for (const transfer of transfers || []) {
          const from = StateUtils.getTarget(state, player, transfer.from);
          MOVE_CARDS(store, state, from, player.active, { cards: [transfer.card], sourceCard: effect.trainerCard });
        }
        next();
      },
    );
  }

  return state;
}

export class ScrambleSwitch extends TrainerCard {
  protected _tags = [CardTag.ACE_SPEC];

  protected _trainerType: TrainerType = TrainerType.ITEM;

  public set: string = 'PLS';

  public name: string = 'Scramble Switch';

  public fullName: string = 'Scramble Switch PLS';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '129';

  public text: string =
    'Switch your Active Pokemon with 1 of your Benched Pokemon. ' +
    'Then, you may move as many Energy attached to the old Active Pokemon ' +
    'to the new Active Pokemon as you like.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, effect);
      return generator.next().value;
    }
    return state;
  }
}
