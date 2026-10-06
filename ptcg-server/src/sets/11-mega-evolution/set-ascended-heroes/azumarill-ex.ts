import { PokemonCard, Stage, CardTag, CardType, PowerType, StoreLike, State, MoveEnergyPrompt, GameMessage, PlayerType, SlotType, SuperType, StateUtils, GameError, CardTarget } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_POWER_USED, WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';

export class Azumarillex extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Marill';
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [P];
  public hp: number = 270;
  public weakness = [{ type: M }];
  public resistance = [];
  public retreat = [C, C];

  public powers = [{
    name: 'Bubble Gathering',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'As often as you like during your turn, you may use this Ability. Move an Energy from 1 of your other Pokémon to this Pokémon.'
  }];

  public attacks = [{
    name: 'Energized Balloon',
    cost: [C, C, C],
    damage: 60,
    damageCalculation: '+',
    text: 'This attack does 40 more damage for each [P] Energy attached to this Pokemon.'
  }];

  public regulationMark: string = 'J';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '84';
  public name: string = 'Azumarill ex';
  public fullName: string = 'Azumarill ex MC';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Bubble Bundle ability
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-213 / B.27: the Energy must come from 1 of your OTHER Pokemon, so with no other Pokemon
      // in play holding an Energy there is no legal source and the Ability may not be used
      // (#49/#75/#2109 -- public knowledge that the effect has no legal target). The existing
      // INVALID_TARGET throw below cannot cover this: it sits INSIDE the MoveEnergyPrompt callback,
      // which the throw-only dry run in legal-actions.ts never reaches, so it guards the resolution
      // and not the offer.
      const self = StateUtils.findCardList(state, this);
      let otherSources = 0;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        if (cardList !== self && cardList.cards.some(c => c.superType === SuperType.ENERGY)) {
          otherSources++;
        }
      });
      if (otherSources === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // TA-367: (1) the destination is "to THIS Pokémon" and the source "1 of your OTHER Pokémon" —
      // the unconstrained prompt enumerated reverse moves the callback's INVALID_TARGET guard then
      // rejected, so legalActions offered actions the dispatcher refuses (§10.3). Block them at the
      // OFFER (the lycanroc.ts TA-269/TA-332 idiom). (2) B.46: an activated may has no
      // post-activation decline — min 1, no cancel (the otherSources gate above guarantees a move).
      // (3) "As often as you like" — the old ABILITY_USED call consumed the WHOLE TURN after one
      // use (legal-actions filters ABILITY_USED slots), against the printed text; removed.
      const blockedTo: CardTarget[] = [];
      const blockedFrom: CardTarget[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
        if (card !== this) {
          blockedTo.push(target);
        } else {
          blockedFrom.push(target);
        }
      });
      return store.prompt(state, new MoveEnergyPrompt(
        player.id,
        GameMessage.MOVE_ENERGY_CARDS,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { superType: SuperType.ENERGY },
        { allowCancel: false, min: 1, max: 1, blockedTo, blockedFrom }
      ), transfers => {
        transfers = transfers || [];
        for (const transfer of transfers) {
          if (StateUtils.getTarget(state, player, transfer.to) !== StateUtils.findCardList(state, this)) {
            throw new GameError(GameMessage.INVALID_TARGET);
          }
          const source = StateUtils.getTarget(state, player, transfer.from);
          const target = StateUtils.getTarget(state, player, transfer.to);
          MOVE_CARDS(store, state, source, target, { cards: [transfer.card], sourceCard: this });
        }
      });
    }

    // Energized Balloon attack
    if (WAS_ATTACK_USED(effect, 0, this)) {
      // Golden (asc.json #84): "60+, does 40 more damage for each [P] Energy attached to this Pokemon."
      // The prior string scan (`energyType === 'P'`, `provides.includes('P')`) NEVER matched: `provides`
      // holds numeric CardType enum values (CardType.PSYCHIC), not the letter 'P', and EnergyCard has no
      // `energyType` string field -- so the bonus was always 0 (60 vs rotomancer/golden 180 on 3 [P]).
      // Count [P] via CheckProvidedEnergyEffect on the Active, the kyogre.ts idiom.
      const checkEnergy = new CheckProvidedEnergyEffect(effect.player);
      store.reduceEffect(state, checkEnergy);
      const psychicCount = checkEnergy.energyMap.reduce((sum, em) =>
        sum + em.provides.filter(t => t === CardType.PSYCHIC || t === CardType.ANY).length, 0);
      effect.damage += 40 * psychicCount;
    }

    return state;
  }
}