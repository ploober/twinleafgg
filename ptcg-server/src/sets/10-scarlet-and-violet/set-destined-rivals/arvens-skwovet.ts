import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { State, StateUtils, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class ArvensSkwovet extends PokemonCard {
  public regulationMark = 'I';
  protected _tags = [CardTag.ARVENS];
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [C];
  public hp: number = 60;
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Gnaw Through',
      cost: [C],
      damage: 10,
      text: "Before doing damage, discard all Pokémon Tool cards from your opponent's Active Pokémon.",
    },
  ];

  public set: string = 'DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '158';
  public name: string = "Arven's Skwovet";
  public fullName: string = "Arven's Skwovet DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-230: this whole method was commented out, so the attack dealt its 10 damage and the Tool
    // stayed attached. The disabled draft called `REMOVE_TOOL`, which is itself commented out in
    // prefabs.ts — so the card was switched off to follow a prefab that had been switched off, and
    // nothing pointed at the live idiom five sibling cards already use.
    //
    // Ref: set-lost-thunder/pikipek.ts (Peck Off) — same clause, same shape, and verified discarding
    // correctly on this engine. Also set-team-up/farfetchd.ts (Tool Buster).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const activePokemon = opponent.active;

      if (activePokemon.tools.length > 0) {
        activePokemon.moveCardsTo([...activePokemon.tools], opponent.discard);
      }
    }

    return state;
  }
}
