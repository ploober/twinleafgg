import {
  PokemonCard,
  Stage,
  CardTag,
  CardType,
  StoreLike,
  State,
  SpecialCondition,
  StateUtils,
  SuperType,
  DiscardEnergyPrompt,
  GameMessage,
  PlayerType,
  SlotType,
  ChoosePokemonPrompt,
} from '../../../game';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';
import {WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class LarrysStaraptor extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = "Larry's Staravia";
  protected _tags = [CardTag.LARRYS];
  public cardType: CardType[] = [C];
  public hp: number = 150;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Facade',
      cost: [C],
      damage: 60,
      damageCalculation: '+',
      text: 'If this Pokémon is Burned or Poisoned, this attack does 100 more damage.',
    },
    {
      name: 'Feathery Strike',
      cost: [C, C, C],
      damage: 150,
      text: "Discard 2 Energy from this Pokémon, and this attack also does 50 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    },
  ];

  public regulationMark = 'J';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '170';
  public name: string = "Larry's Staraptor";
  public fullName: string = "Larry's Staraptor MC";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // First attack - bonus damage if Poisoned or Burned
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const isPoisoned = player.active.specialConditions.includes(SpecialCondition.POISONED);
      const isBurned = player.active.specialConditions.includes(SpecialCondition.BURNED);

      if (isPoisoned || isBurned) {
        effect.damage += 100;
      }
    }

    // Feather Strike attack
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const benchTargets = opponent.bench.filter((b) => b.cards.length > 0);

      // Discard 2 Energy from the Active. Rulebook step F / #649: the base 150 lands before this rider.
      const discardTwo = (s: State): State => {
        const energyCount = player.active.cards.filter((c) => c.superType === SuperType.ENERGY).length;
        if (energyCount < 2) {
          return s;
        }
        return store.prompt(
          s,
          new DiscardEnergyPrompt(
            player.id,
            GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
            PlayerType.BOTTOM_PLAYER,
            [SlotType.ACTIVE],
            { superType: SuperType.ENERGY },
            { allowCancel: false, min: 2, max: 2 },
          ),
          (transfers) => {
            transfers = transfers || [];
            for (const transfer of transfers) {
              const source = StateUtils.getTarget(state, player, transfer.from);
              MOVE_CARDS(store, state, source, player.discard, { cards: [transfer.card], sourceCard: this });
            }
          },
        );
      };

      const applyBaseBenchDiscard = (s: State, benchTarget?: typeof opponent.bench[number]): State => {
        // B.82 (#1834, #2002): the choices are made first (the Bench target, then the Energy), then the damage (the
        // Active's 150, then the Bench 50), then the chosen Energy moves. TA-635: the Bench 50 is queued on
        // afterDamageMoves ahead of the Energy discard (queued by its own pick), so it lands after the base damage and
        // before the discard, not when the Bench target is chosen.
        if (benchTarget) {
          effect.afterDamageMoves.push(() => {
            const dealDamage = new DealDamageEffect(effect, 50);
            dealDamage.target = benchTarget;
            dealDamage.attackEffect.ignoreWeakness = true;
            dealDamage.attackEffect.ignoreResistance = true;
            state = store.reduceEffect(state, dealDamage);
          });
        }
        return discardTwo(s);
      };

      if (benchTargets.length === 0) {
        state = applyBaseBenchDiscard(state);
      } else {
        // TA-434: the Bench target is a Step-D choice ("you would make that choice now"), so it is pended
        // FIRST — before the base damage and the discard. At that pending the Active is still at 0
        // (rotomancer's shape); the base damage, Bench snipe, and discard follow the choice.
        state = store.prompt(
          state,
          new ChoosePokemonPrompt(
            player.id,
            GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
            PlayerType.TOP_PLAYER,
            [SlotType.BENCH],
            { allowCancel: false, min: 1, max: 1 },
          ),
          (targets) => {
            targets = targets || [];
            if (targets.length > 0) {
              applyBaseBenchDiscard(state, targets[0]);
            }
          },
        );
      }
    }

    return state;
  }
}
