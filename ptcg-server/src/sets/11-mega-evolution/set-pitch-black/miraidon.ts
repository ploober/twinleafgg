import {
  AttachEnergyPrompt,
  GameMessage,
  PlayerType,
  PowerType,
  PokemonCardList,
  SlotType,
  StateUtils,
  StoreLike,
  State,
} from '../../../game';
import { Card } from '../../../game/store/card/card';
import { GamePhase } from '../../../game/store/state/state';
import { CardType, EnergyType, Stage, SuperType } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { Effect } from '../../../game/store/effects/effect';
import { EnergyCard } from '../../../game/store/card/energy-card';
import {
  IS_ABILITY_BLOCKED,
  MOVE_CARDS,
  THIS_POKEMON_DOES_DAMAGE_TO_ITSELF,
  WAS_ATTACK_USED,
} from '../../../game/store/prefabs/prefabs';

export class Miraidon extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [L];
  public hp: number = 120;
  public weakness = [{ type: F }];
  public retreat = [C];

  public powers = [
    {
      name: 'Photon Cord',
      powerType: PowerType.ABILITY,
      text: "If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, move up to 2 Basic [L] Energy cards from this Pokémon to 1 of your Benched Pokémon.",
    },
  ];

  public attacks = [
    {
      name: 'Thunder',
      cost: [L, L],
      damage: 90,
      text: 'This Pokémon also does 30 damage to itself.',
    },
  ];

  public set: string = 'PBL';
  public setNumber: string = '28';
  public regulationMark: string = 'J';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Miraidon';
  public fullName: string = 'Miraidon M5';

  private isEligibleBasicLightningEnergy(card: Card): card is EnergyCard {
    return (
      card instanceof EnergyCard &&
      card.energyType === EnergyType.BASIC &&
      card.provides.some(
        (p) => p === CardType.LIGHTNING || p === CardType.ANY,
      )
    );
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Ref: set-paradox-rift/veluza.ts (Filet Memento)
    if (effect instanceof KnockOutEffect && effect.target.cards.includes(this)) {
      const player = effect.player;

      // TA-797 / #2400: "in the Active Spot" is where the attack's damage found it. Push Down switches the damaged
      // Miraidon to the Bench before the Knock Out, and Photon Cord still applies.
      if (effect.target !== player.active && effect.target.attackDamagedWhileActiveOnTurn !== state.turn) {
        return state;
      }

      // TA-695: "Knocked Out by damage from an attack from your OPPONENT's Pokémon". This read the player-level
      // DAMAGE_DEALT_MARKER alone, which this Pokémon's own recoil sets too (Thunder: "This Pokémon also does 30
      // damage to itself", during its owner's attack), so Photon Cord fired on a self Knock Out. The engine's own
      // per-Pokémon KO cause (TA-573, game-effect.ts): the opponent is the attacker, and THIS Pokémon took the
      // attack's damage this turn.
      const opponent = StateUtils.getOpponent(state, player);
      const byOpponentsAttackDamage = state.phase === GamePhase.ATTACK
        && state.players[state.activePlayer] === opponent
        && effect.target.attackDamagedOnTurn === state.turn;
      if (!byOpponentsAttackDamage) {
        return state;
      }

      if (!IS_ABILITY_BLOCKED(store, state, player, this)) {
        const activeCopy = new PokemonCardList();
        activeCopy.cards = effect.target.cards.slice();

        const blocked = activeCopy.cards
          .map((c, idx) => (this.isEligibleBasicLightningEnergy(c) ? -1 : idx))
          .filter((idx) => idx >= 0);

        // TA-446: Photon Cord is an Ability's "up to 2", so #2301 floors it at 1 — no decline at zero —
        // whenever a move is actually possible (an eligible Energy AND a Benched Pokémon to receive it).
        // With nothing to move, the floor stays 0 (the effect provably does nothing; do not deadlock).
        const eligibleCount = activeCopy.cards.length - blocked.length;
        const benchCount = player.bench.filter((b) => b.cards.length > 0 && b !== effect.target).length;
        const minMove = eligibleCount > 0 && benchCount > 0 ? 1 : 0;

        return store.prompt(
          state,
          new AttachEnergyPrompt(
            player.id,
            GameMessage.ATTACH_ENERGY_TO_BENCH,
            activeCopy,
            PlayerType.BOTTOM_PLAYER,
            [SlotType.BENCH],
            { superType: SuperType.ENERGY },
            {
              blocked,
              validCardTypes: [CardType.LIGHTNING, CardType.ANY],
              allowCancel: false,
              min: minMove,
              max: 2,
              sameTarget: true,   // TA-776 (B.120): "to 1 of your Benched Pokémon" - both Energy go to the same one
              // TA-797 / #2400: "you cannot move the Energy onto itself" — Miraidon may be on the Bench after Push Down.
              blockedTo: player.bench
                .map((b, index) => (b === effect.target ? { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index } : undefined))
                .filter((t): t is { player: PlayerType; slot: SlotType; index: number } => t !== undefined),
            },
          ),
          (transfers) => {
            transfers = transfers || [];
            let moved = 0;
            for (const transfer of transfers) {
              if (!transfer || !this.isEligibleBasicLightningEnergy(transfer.card)) {
                continue;
              }
              if (moved >= 2) {
                break;
              }
              // TA-445: move the Energy FROM WHEREVER IT IS. This read `player.discard`
              // unconditionally, which was correct only while the Knock Out discard ran BEFORE this
              // prompt was answered. TA-441 ordered the KO window properly, so the Energy is still
              // attached to the dying holder when the player answers: the discard read matched
              // nothing and the decision resolved to nothing.
              const from = effect.target.cards.includes(transfer.card) ? effect.target : player.discard;
              const target = StateUtils.getTarget(state, player, transfer.to);
              state = MOVE_CARDS(store, state, from, target, { cards: [transfer.card] });
              moved += 1;
            }
          },
        );
      }
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {
      THIS_POKEMON_DOES_DAMAGE_TO_ITSELF(store, state, effect, 30);
    }

    return state;
  }
}
