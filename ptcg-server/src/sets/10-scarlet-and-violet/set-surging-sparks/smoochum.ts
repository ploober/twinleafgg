import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType, SuperType } from '../../../game/store/card/card-types';
import { State } from '../../../game/store/state/state';

import { StoreLike } from '../../../game/store/store-like';
import { Effect } from '../../../game/store/effects/effect';
import { AttachEnergyPrompt, GameMessage, PlayerType, ShuffleDeckPrompt, SlotType, StateUtils } from '../../../game';
import { WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Smoochum extends PokemonCard {

  public regulationMark = 'H';

  public stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.PSYCHIC];

  public hp = 30;

  public weakness = [{ type: CardType.DARK }];

  public resistance = [{ type: CardType.FIGHTING, value: -30 }];

  public retreat = [];

  public attacks = [
    {
      name: 'Delightful Kiss',
      cost: [],
      damage: 0,
      text: 'Search your deck for up to 2 Basic [P] Energy cards and attach them to your Benched Pokemon in any way you like. Then, shuffle your deck.'
    }
  ];

  public set: string = 'SSP';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '75';

  public name: string = 'Smoochum';

  public fullName: string = 'Smoochum SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-131: an attack is declarable even when its effect can't be carried out (rulebook p.20).
      // An empty deck is not a refusal — the search whiffs and the trailing shuffle (CF-9/TA-126)
      // still fires. The AttachEnergyPrompt over an empty deck auto-resolves to zero transfers.
      state = store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        player.deck,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Psychic Energy' },
        { allowCancel: false, min: 0, max: 2 },
      ), transfers => {
        transfers = transfers || [];
        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          MOVE_CARDS(store, state, player.deck, target, { cards: [transfer.card], sourceCard: this });
        }
      });

      // Single trailing shuffle for every branch (attach, decline, or empty-deck whiff) — CF-9/TA-126.
      return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
        player.deck.applyOrder(order);
        return state;
      });
    }
    return state;
  }
}