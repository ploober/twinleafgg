import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK, SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_INTO_HAND, ATTACK_SEARCH_WHIFFS, SHUFFLE_DECK } from '../../../game/store/prefabs/prefabs';

export class Purrloin extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [D];
  public hp: number = 60;
  public weakness = [{ type: G }];
  public retreat = [C];

  public attacks = [{
    name: 'Invite Evil',
    cost: [D],
    damage: 0,
    text: 'Search your deck for up to 3 [D] Pokémon, reveal them, and put them into your hand. Shuffle your deck afterward.'
  }];

  public set: string = 'WHT';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '55';
  public name: string = 'Purrloin';
  public fullName: string = 'Purrloin WHT';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (AFTER_ATTACK(effect, 0, this)) {
      // TA-249: an empty deck makes the search WHIFF; it does not make the attack illegal. The
      // prefab opens with BLOCK_IF_DECK_EMPTY, which throws NO_CARDS_IN_DECK — right for a Trainer,
      // whose entire play would then have no effect (#924, and #840 specifically: "you cannot search
      // through an empty deck"), but wrong here. An attack is always declarable and you do as much as
      // you can (#578 Roost, #622 Surprise Punch), and #2301 puts "up to 3" at 0..max on an ATTACK.
      // Thrown from AFTER_ATTACK the GameError rolled the whole declaration back to invalidAction —
      // an attack twinleaf had just OFFERED. Rotomancer resolves it.
      //
      // Guarded here rather than in the prefab: 46 of its 58 callers pass `min: 0`, and they include
      // Trainers whose empty-deck refusal is correct — Professor Elm's Training Method is the literal
      // subject of #840 — so `min` does NOT discriminate attack from Trainer and a prefab-level fix
      // keyed on it would make those Trainers playable on an empty deck. SD-20.
      if (ATTACK_SEARCH_WHIFFS(effect.player)) {
        return SHUFFLE_DECK(store, state, effect.player);
      }
      SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_INTO_HAND(store, state, effect.player, { cardType: [CardType.DARK] }, { min: 0, max: 3 });
    }

    return state;
  }
}