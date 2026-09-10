import { AttachEnergyPrompt, GameMessage, PlayerType, PowerType, SlotType, State, StateUtils, StoreLike } from '../../../game';
import { CardTag, CardType, EnergyType, Stage, SuperType } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';
import { SHUFFLE_DECK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Cinderace extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = 'Raboot';
  protected _tags = [CardTag.PLAY_DURING_SETUP];
  public cardType: CardType[] = [R];
  public hp: number = 160;
  public weakness = [{ type: W }];
  public retreat = [];

  public powers = [
    {
      name: 'Explosiveness',
      powerType: PowerType.ABILITY,
      text: 'If this Pokémon is in your hand when you are setting up to play, you may put it face down as your Active Pokémon.',
    },
  ];

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
      // TA-250 / B.33: the two antecedents above are NOT the same question and were conflated into
      // one guard. An empty BENCH is RE-38/RE-32's case — no legal destination, so the search never
      // happens and neither does its shuffle; that stays. An empty DECK is not: *"Then, shuffle your
      // deck"* names an object that still exists, so the shuffle is owed (and this very method
      // already shuffles on the cancelled-transfer path, three lines below).
      // ORDER IS LOAD-BEARING: the DESTINATION test runs first. With no Bench there is no legal
      // attach target, so no search happens and no shuffle is owed (RE-38/RE-32, and rotomancer
      // agrees). Only once a destination exists does B.33 decide the empty-deck case. The first
      // version of this fix had the two the other way round and moved the divergence rather than
      // closing it.
      const hasBench = player.bench.some(b => b.cards.length > 0);
      if (!hasBench) {
        return state;
      }
      if (player.deck.cards.length === 0) {
        return SHUFFLE_DECK(store, state, player);
      }

      state = store.prompt(
        state,
        new AttachEnergyPrompt(
          player.id,
          GameMessage.ATTACH_ENERGY_TO_BENCH,
          player.deck,
          PlayerType.BOTTOM_PLAYER,
          [SlotType.BENCH],
          { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
          { allowCancel: false, min: 0, max: 3 },
        ),
        (transfers) => {
          transfers = transfers || [];
          for (const transfer of transfers) {
            const target = StateUtils.getTarget(state, player, transfer.to);
            player.deck.moveCardTo(transfer.card, target);
          }
          // TA-395: ONE shuffle, raised AFTER the attach has moved the cards. The zero-take branch
          // used to shuffle here AND a second SHUFFLE_DECK ran unconditionally after the prompt, so a
          // decline shuffled twice; the outer call also computed its choice-space before the attach.
          SHUFFLE_DECK(store, state, player);
          return state;
        },
      );
    }

    return state;
  }
}
