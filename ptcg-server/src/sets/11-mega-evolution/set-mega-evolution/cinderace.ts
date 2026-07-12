import { AttachEnergyPrompt, GameMessage, PlayerType, PowerType, SlotType, State, StateUtils, StoreLike } from '../../../game';
import { CardTag, CardType, EnergyType, Stage, SuperType } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';
import { SHUFFLE_DECK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Cinderace extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = 'Raboot';
  public tags = [CardTag.PLAY_DURING_SETUP];
  public cardType: CardType = R;
  public hp: number = 160;
  public weakness = [{ type: W }];
  public retreat = [];

  public powers = [{
    name: 'Explosiveness',
    powerType: PowerType.ABILITY,
    text: 'If this Pokémon is in your hand when you are setting up to play, you may put it face down as your Active Pokémon.'
  }];

  public attacks = [{
    name: 'Turbo Flare',
    cost: [C],
    damage: 50,
    text: 'Search your deck for up to 3 Basic Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.'
  }];

  public set: string = 'MEG';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '28';
  public name: string = 'Cinderace';
  public fullName: string = 'Cinderace M1L';
  public regulationMark = 'I';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // Rulebook attack step F: the base damage lands in the damage step, BEFORE the search/attach
      // effect pauses (the deck-search prompt below suspends the attack). Deal it now and zero the
      // declared damage so the engine doesn't re-apply it at the end. (Mirrors Miraidon tef-121.)
      const damageEffect = new DealDamageEffect(effect, effect.damage);
      state = store.reduceEffect(state, damageEffect);
      effect.damage = 0;

      // TA-97 / RE-38: the energy attaches to "your Benched Pokémon". With an empty deck (nothing to
      // find) or NO Benched Pokémon (no legal destination, compendium #1108) there is no search — and
      // therefore no shuffle. Deal the 50 and stop; do NOT block the attack (was: throw
      // CANNOT_USE_ATTACK before the damage even landed).
      const hasBench = player.bench.some(b => b.cards.length > 0);
      if (player.deck.cards.length === 0 || !hasBench) {
        return state;
      }

      state = store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        player.deck,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { allowCancel: false, min: 0, max: 3 },
      ), transfers => {
        transfers = transfers || [];
        // cancelled by user
        if (transfers.length === 0) {
          SHUFFLE_DECK(store, state, player);
          return state;
        }
        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          player.deck.moveCardTo(transfer.card, target);
        }
      });

      SHUFFLE_DECK(store, state, player);
    }

    return state;
  }
} 