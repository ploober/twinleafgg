import { CardTag, CardType, PokemonCard, Stage, State, StoreLike } from "../../../game";
import { Effect } from "../../../game/store/effects/effect";
import { WAS_ATTACK_USED } from "../../../game/store/prefabs/prefabs";

export class Koraidon extends PokemonCard {
  protected _tags = [CardTag.ANCIENT];
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [F];
  public hp: number = 130;
  public retreat = [C, C];
  public weakness = [{ type: P }];

  public attacks = [
    {
      name: 'Unrelenting Onslaught',
      cost: [C, C],
      damage: 30,
      damageCalculator: '+',
      text: 'If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.',
    },
    {
      name: 'Hammer In',
      cost: [F, F, C],
      damage: 110,
      text: '',
    },
  ];

  public regulationMark = 'H';
  public set: string = 'SSP';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '116';
  public name: string = 'Koraidon';
  public fullName: string = 'Koraidon SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Unrelenting Onslaught
    if (WAS_ATTACK_USED(effect, 0, this)) {
      // Re-applied after 2026-08-01 upstream merge: restored the explicit turn-timing guard.
      // The BOOST_IF_OTHER_ANCIENT_ATTACKED_LAST_TURN prefab relies on a never-cleared flag and
      // wrongly fires after an attackless intervening own-turn. "1 of your OTHER Ancient Pokémon
      // used an attack during your last turn": the previous attack must be from the player's
      // immediately preceding turn, by an Ancient Pokémon that is not this one.
      const player = effect.player;
      const playerLastAttackInfo = state.playerLastAttack?.[player.id];
      const originalCard = playerLastAttackInfo ? playerLastAttackInfo.sourceCard : null;

      if (originalCard && originalCard !== this
        && originalCard.hasTag(CardTag.ANCIENT)
        && playerLastAttackInfo?.turn === state.turn - 2) {
        effect.damage += 150;
      }
    }
    return state;
  }
}
