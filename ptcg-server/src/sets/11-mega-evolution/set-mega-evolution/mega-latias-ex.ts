import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State, ConfirmPrompt, GameMessage, Card } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { AfterAttackEffect } from '../../../game/store/effects/game-phase-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { DiscardCardsEffect } from '../../../game/store/effects/attack-effects';
import { SWITCH_ACTIVE_WITH_BENCHED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class MegaLatiasex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_SV_MEGA];
  public hp: number = 280;
  public cardType: CardType[] = [N];
  public retreat = [C];

  public attacks = [
    {
      name: 'Strafe',
      cost: [C],
      damage: 40,
      text: 'You may switch this Pokémon with 1 of your Benched Pokémon.',
    },
    {
      name: 'Illusory Impulse',
      cost: [R, P, C],
      damage: 300,
      text: 'Discard all Energy from this Pokémon.',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'MEG';
  public setNumber: string = '100';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Mega Latias ex';
  public fullName: string = 'Mega Latias ex M1S';

  public strafeUsed: boolean = false;

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      this.strafeUsed = true;
    }

    if (effect instanceof AfterAttackEffect && this.strafeUsed) {
      this.strafeUsed = false;
      const player = effect.player;
      // TA-200: `player.bench` is a fixed SLOT array (empty slots are still entries), so
      // `player.bench.length > 0` is ALWAYS true and this guard never fired -- Strafe pended a
      // WANT_TO_SWITCH_POKEMON confirm even with a completely empty Bench, where answering either
      // way does nothing. Measured live: twinleaf pended the confirm, rotomancer advanced the turn.
      // The occupancy test is `.some(b => b.cards.length > 0)`, which is what the rest of the
      // codebase uses. Compendium #622 ("if there are no Benched Pokemon you just do as much as you
      // can") and #428 (Morpeko V "stays in the Active Spot") confirm the switch simply does not
      // happen, and #389 confirms the damage still does -- so the RULES outcome already matched;
      // what diverged was surfacing a decision node with no decision behind it (CF-14).
      if (player.bench.some(b => b.cards.length > 0)) {
        store.prompt(state, new ConfirmPrompt(
          player.id,
          GameMessage.WANT_TO_SWITCH_POKEMON
        ), wantToSwitch => {
          if (wantToSwitch) {
            SWITCH_ACTIVE_WITH_BENCHED(store, state, player);
          }
        });
      }
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
      state = store.reduceEffect(state, checkProvidedEnergy);

      const cards: Card[] = checkProvidedEnergy.energyMap.map((e) => e.card);
      const discardEnergy = new DiscardCardsEffect(effect, cards);
      discardEnergy.target = player.active;
      store.reduceEffect(state, discardEnergy);
    }

    return state;
  }
}
