import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike, State, PowerType, GameMessage, PlayerType, SlotType, AttachEnergyPrompt, StateUtils, CardTarget, pokemonHasCardType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class Magneton extends PokemonCard {

  public regulationMark = 'H';
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Magnemite';
  public cardType: CardType[] = [L];
  public hp: number = 100;
  public weakness = [{ type: F }];
  public retreat = [C];

  public powers = [{
    name: 'Overvolt Discharge',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    knocksOutSelf: true,
    text: 'Once during your turn, you may attach up to 3 Basic Energy cards from your discard pile to your [L] Pokémon in any way you like. If you use this Ability, this Pokémon is Knocked Out.'
  }];

  public attacks = [
    {
      name: 'Electric Ball',
      cost: [L, C],
      damage: 40,
      text: ''
    }
  ];

  public set: string = 'SSP';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '59';
  public name: string = 'Magneton';
  public fullName: string = 'Magneton SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-214 (offer half), CLOSED 2026-08-06: an empty-discard throw used to live here, keeping
      // "Overvolt Discharge" out of the menu when nothing could be attached. That was wrong.
      // "If you use this Ability, this Pokémon is Knocked Out" fires whatever the discard holds, so
      // the Ability is never used for no effect (#13, whose test is whether the game state changes,
      // not who benefits -- cost versus drawback is about desirability and desirability is not the
      // test).
      //
      // We held this open on #2301, whose 1..max floor for a non-attack "up to N" seemed to forbid a
      // zero-attach. Two things closed it. #1011 (Flower Shop Lady) and #423 (Dual Draw) show that
      // even a MANDATORY count degrades to "as many as you can" on short supply -- and a floor of 1
      // under an "up to 3" cannot be a HARDER gate than the mandatory form the compendium explicitly
      // calls harder. And decisively: if #2301's floor were a usability precondition it would
      // withhold twm-095 Munkidori and this card ALIKE -- both are "up to N", non-attack, over an
      // empty pool -- which is the one answer TA-214 says is wrong. #2301 bounds what a player may
      // CHOOSE, so it presupposes a choice; with an empty pool there is none for it to bite on.
      //
      // The two cards are separated by #13, not #2301: Munkidori's body is only the counter-move
      // (RE-96, correctly withheld), while this body is [iterate(attach), knockOut] and the KO is a
      // real state change. Do NOT re-add an emptiness guard here without also explaining why
      // Munkidori and Magneton should resolve the same way.

      const blocked2: CardTarget[] = [];
      let lightningTargets = 0;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
        if (!pokemonHasCardType(card, CardType.LIGHTNING)) {
          blocked2.push(target);
        } else {
          lightningTargets += 1;
        }
      });

      // TA-400: #2301 makes a non-attack "up to 3" 1..3 — a STOP at zero picks is not offered while
      // there is something to attach. The floor clamps to the capacity (the note above: an empty
      // discard has no choice for it to bite on), so `min` is 1 exactly when a pick exists.
      const basicInDiscard = player.discard.cards.filter(c =>
        c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC).length;
      const capacity = lightningTargets > 0 ? Math.min(3, basicInDiscard) : 0;

      return store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_CARDS,
        player.discard,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH, SlotType.ACTIVE],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { allowCancel: false, min: Math.min(1, capacity), max: 3, blockedTo: blocked2 },
      ), transfers => {
        transfers = transfers || [];
        // TA-214: the self-KO used to sit BELOW an `if (transfers.length === 0) { return state; }`
        // early return, so attaching zero Energy from a STOCKED discard skipped it -- driven live,
        // Magneton survived at 0 damage and the Ability was offered again the same turn. The card
        // conditions the KO on *using* the Ability ("If you use this Ability, this Pokémon is
        // Knocked Out"), not on attaching, so the early return is simply wrong and the loop below
        // is already a no-op for zero transfers.
        //
        // Still open, and deliberately untouched: the KO is applied as a raw
        // `cardList.damage += 999`, an SD-13 site.
        //
        // `min: 0` on the prompt above is now CORRECT and should stay. #2301's 1..max floor for a
        // non-attack "up to N" bounds what the player may CHOOSE; on an empty discard the capacity
        // is 0 and the floor has no choice to bite on, so it clamps to the capacity rather than
        // making the card unusable (#1011/#423: even a MANDATORY count degrades to "as many as you
        // can"). Raising it to 1 would make this Ability unusable on an empty discard and re-open
        // the offer question the comment above just closed.
        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          player.discard.moveCardTo(transfer.card, target);
        }
        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
          if (cardList.getPokemonCard() === this) {
            cardList.damage += 999;
          }
        });
      });
    }
    return state;
  }
}