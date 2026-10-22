import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType, SuperType, CardTag } from '../../../game/store/card/card-types';
import { PowerType, StoreLike, State, StateUtils, GameMessage, PlayerType, SlotType, GameError, pokemonHasCardType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AttachEnergyPrompt } from '../../../game/store/prompts/attach-energy-prompt';
import { RemoveSpecialConditionsEffect } from '../../../game/store/effects/attack-effects';
import { CheckHpEffect } from '../../../game/store/effects/check-effects';
import { PlaceDamageCountersEffect } from '../../../game/store/effects/game-effects';
import { IS_ABILITY_BLOCKED, MOVE_CARDS, WAS_ATTACK_USED, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';
import { CardTarget } from '../../../game';
import { EnergyCard } from '../../../game/store/card/energy-card';

export class Gardevoirex extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Kirlia';
  protected _tags = [CardTag.POKEMON_ex];
  public hp: number = 310;
  public cardType: CardType[] = [P];
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C, C];

  public powers = [{
    name: 'Psychic Embrace',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: "As often as you like during your turn, you may attach a Basic [P] Energy card from your discard pile to 1 of your [P] Pokémon. If you attached Energy to a Pokémon in this way, put 2 damage counters on that Pokémon. You can't use this Ability on a Pokémon that would be Knocked Out.",
  }];

  public attacks = [{
    name: 'Miracle Force',
    cost: [P, P, C],
    damage: 190,
    text: 'This Pokémon recovers from all Special Conditions.',
  }];

  public regulationMark = 'G';
  public set: string = 'SVI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '86';
  public name: string = 'Gardevoir ex';
  public fullName: string = 'Gardevoir ex SVI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Psychic Embrace
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
      }

      // TA-487: needs a Basic [P] Energy in the discard pile and a [P] Pokémon that 2 damage counters would not
      // Knock Out; otherwise nothing can be attached (B.29 rule 1).
      const hasEnergy = player.discard.cards.some(c => c instanceof EnergyCard
        && c.energyType === EnergyType.BASIC && c.name === 'Psychic Energy');
      let hasRecipient = false;
      // TA-488: every other Pokémon is blocked as a recipient, so a single legal one collapses (CF-14).
      const blockedTo: CardTarget[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
        const checkHpEffect = new CheckHpEffect(player, list);
        store.reduceEffect(state, checkHpEffect);
        if (pokemonHasCardType(card, CardType.PSYCHIC) && list.damage + 20 < checkHpEffect.hp) {
          hasRecipient = true;
        } else {
          blockedTo.push(target);
        }
      });
      if (!hasEnergy || !hasRecipient) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      state = store.prompt(
        state,
        new AttachEnergyPrompt(
          player.id,
          GameMessage.ATTACH_ENERGY_TO_BENCH,
          player.discard,
          PlayerType.BOTTOM_PLAYER,
          [SlotType.BENCH, SlotType.ACTIVE],
          { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Psychic Energy' },
          { allowCancel: false, min: 1, max: 1, blockedTo },
        ),
        (transfers) => {
          transfers = transfers || [];
          if (transfers.length === 0) {
            return state;
          }
          for (const transfer of transfers) {
            const target = StateUtils.getTarget(state, player, transfer.to);
            const checkHpEffect = new CheckHpEffect(player, target);
            store.reduceEffect(state, checkHpEffect);

            if (
              target.getPokemonCard() instanceof PokemonCard &&
              !pokemonHasCardType(target.getPokemonCard()!, CardType.PSYCHIC)
            ) {
              throw new GameError(GameMessage.CAN_ONLY_ATTACH_TO_PSYCHIC);
            }

            const damageAfterTransfer = target.damage + 20;
            if (damageAfterTransfer >= checkHpEffect.hp) {
              throw new GameError(GameMessage.CANNOT_USE_POWER);
            }
            MOVE_CARDS(store, state, player.discard, target, { cards: [transfer.card], sourceCard: this });
            store.reduceEffect(
              state,
              new PlaceDamageCountersEffect(player, target, 20, this, this.powers[0]),
            );
          }
        },
      );
    }

    // Miracle Force
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      const removeSpecialCondition = new RemoveSpecialConditionsEffect(effect, undefined);
      removeSpecialCondition.target = player.active;
      state = store.reduceEffect(state, removeSpecialCondition);
      return state;
    }

    return state;
  }
}
