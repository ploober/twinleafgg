import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, SuperType } from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  PlayerType,
  AttachEnergyPrompt,
  GameMessage,
  SlotType,
  StateUtils,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { CONFIRMATION_PROMPT, WAS_ATTACK_USED, APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class TeamRocketsZapdos extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.TEAM_ROCKET];
  public cardType: CardType[] = [L];
  public hp: number = 120;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Jamming Wing',
      cost: [C, C],
      damage: 30,
      text: "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.",
    },
    {
      name: 'Wicked Thunder',
      cost: [L, C, C],
      damage: 60,
      damageCalculation: '+',
      text: 'If this Pokémon has Team Rocket Energy attached, this attack does 60 more damage.',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '70';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Team Rocket's Zapdos";
  public fullName: string = "Team Rocket's Zapdos DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Jamming Wave
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = effect.opponent;

      // Rulebook step F / compendium #543/#649: apply damage before the move-Energy rider.
      state = APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS(store, state, effect);

      // TA-149 / CF-33: these two eligibility guards used to sit INSIDE the confirm callback, so the
      // "you may" gate was offered first and only then discovered it could achieve nothing. CF-33 (pinned
      // 2026-07-29): a `may` whose effect can achieve NOTHING presents NO decision — both branches leave
      // an identical board, so by CF-14 it has exactly one resolution and collapses. Rotomancer suppresses
      // the gate on these boards; twinleaf offered a phantom `confirm{true,false}`.
      //
      // Both conditions read zones OPEN to the acting player (the opponent's Active's attached Energy and
      // their Bench are public), so suppressing on them does not leak hidden information — CF-33's
      // Boundary 1, adopted from rotomancer. A `may` gated on a hidden zone must still be offered.
      const opponentHasBench = opponent.bench.some(b => b.cards.length > 0);
      const opponentActiveHasEnergy = opponent.active.cards.some(c => c.superType === SuperType.ENERGY);
      if (!opponentHasBench || !opponentActiveHasEnergy) {
        return state;
      }

      CONFIRMATION_PROMPT(store, state, player, result => {
        if (result) {

          return store.prompt(state, new AttachEnergyPrompt(
            player.id,
            GameMessage.ATTACH_ENERGY_TO_BENCH,
            opponent.active,
            PlayerType.TOP_PLAYER,
            [SlotType.BENCH],
            { superType: SuperType.ENERGY },
            { allowCancel: false, min: 1, max: 1 }
          ), transfers => {
            transfers = transfers || [];
            for (const transfer of transfers) {
              // TA-147 (wrong perspective): resolve the destination in the PROMPT's frame — `player` —
              // not `opponent`. `StateUtils.getTarget(state, frame, target)` flips to
              // `getOpponent(frame)` when `target.player === TOP_PLAYER`, and this prompt was built with
              // `player.id` + `PlayerType.TOP_PLAYER`, so every `transfer.to` carries TOP_PLAYER meaning
              // "the opponent's side, as seen by the attacker". Passing `opponent` as the frame flipped
              // that a second time and landed the Energy on the ATTACKER's Bench — i.e. the attacker
              // STOLE the Energy, where the card says *"...to 1 of THEIR Benched Pokémon."*
              //
              // This was masked until 2026-07-29: the harness never got past the 1-option `moveEnergy`
              // pending (TA-124/CF-14), so the differential compared boards before the move applied.
              // Collapsing the phantom node exposed it. Same class as TA-121 (Croconaw "Crunch"
              // wrong-perspective discard).
              const target = StateUtils.getTarget(state, player, transfer.to);
              MOVE_CARDS(store, state, opponent.active, target, { cards: [transfer.card], sourceCard: this });
            }
          });

        }
      });
    }

    // Bad Thunder
    if (WAS_ATTACK_USED(effect, 1, this)) {
      if (
        effect.player.active.cards.some(
          (c) => c.superType === SuperType.ENERGY && c.name === 'Team Rocket Energy',
        )
      ) {
        effect.damage += 60;
      }
    }

    return state;
  }
}
