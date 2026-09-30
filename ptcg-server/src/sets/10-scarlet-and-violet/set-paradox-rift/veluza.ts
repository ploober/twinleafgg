import { AttachEnergyPrompt, EnergyCard, GameMessage, PlayerType, PokemonCardList, PowerType, SlotType, State, StateUtils, StoreLike } from '../../../game';
import { CardType, Stage, SuperType } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { IS_ABILITY_BLOCKED, MOVE_CARDS, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Veluza extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.WATER];

  public hp: number = 120;

  public weakness = [{ type: CardType.LIGHTNING }];

  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public powers = [{
    name: 'Fillet Memento',
    powerType: PowerType.ABILITY,
    text: 'If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent\'s Pokémon, move up to 2 [W] Energy cards from this Pokémon to 1 of your Benched Pokémon.'
  }];

  public attacks = [
    {
      name: 'Hydro Pump',
      cost: [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS],
      damage: 60,
      damageCalculation: '+',
      text: 'This attack does 20 more damage times the amount of [W] Energy attached to this Pokémon.'
    }
  ];

  public set: string = 'PAR';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '54';

  public name: string = 'Veluza';

  public fullName: string = 'Veluza PAR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof KnockOutEffect && effect.target.cards.includes(this) &&
      effect.player.marker.hasMarker(effect.player.DAMAGE_DEALT_MARKER)) {
      const player = effect.player;

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      // Make a copy of the active's cards before they are discarded (like Exp. Share)
      const activeCopy = new PokemonCardList();
      activeCopy.cards = effect.target.cards.slice();

      // TA-474 / B.18 (#2301): an Ability's "move up to 2" is 1..2 -- no decline while a [W] Energy and a
      // bencher exist; with nothing to move the floor stays 0 (the miraidon.ts minMove pattern, TA-446).
      const waterCount = activeCopy.cards.filter(c => c instanceof EnergyCard
        && c.provides.some(t => t === CardType.WATER || t === CardType.ANY)).length;
      const benchCount = player.bench.filter(b => b.cards.length > 0).length;
      const minMove = waterCount > 0 && benchCount > 0 ? 1 : 0;

      return store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        activeCopy,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { superType: SuperType.ENERGY },
        { allowCancel: false, min: minMove, max: 2, validCardTypes: [CardType.WATER, CardType.ANY] }
      ), transfers => {
        transfers = transfers || [];
        for (const transfer of transfers) {
          // TA-445: move the Energy FROM WHEREVER IT IS. This read `player.discard`
          // unconditionally, which was correct only while the Knock Out discard ran BEFORE this
          // prompt was answered. TA-441 ordered the KO window properly, so the Energy is still
          // attached to the dying holder when the player answers: the discard read matched
          // nothing and the decision resolved to nothing.
          const from = effect.target.cards.includes(transfer.card) ? effect.target : player.discard;
          const target = StateUtils.getTarget(state, player, transfer.to);
          state = MOVE_CARDS(store, state, from, target, { cards: [transfer.card] });
        }
      });
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      const checkProvidedEnergyEffect = new CheckProvidedEnergyEffect(player);
      store.reduceEffect(state, checkProvidedEnergyEffect);

      let energyCount = 0;
      checkProvidedEnergyEffect.energyMap.forEach(em => {
        energyCount += em.provides.filter(cardType =>
          cardType === CardType.WATER || cardType === CardType.ANY
        ).length;
      });
      effect.damage += energyCount * 20;
    }
    return state;
  }
}
