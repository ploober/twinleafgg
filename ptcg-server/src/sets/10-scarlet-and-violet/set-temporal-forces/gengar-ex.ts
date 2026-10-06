import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State, GameMessage, PlayerType, SlotType, StateUtils, PowerType, AttachEnergyPrompt } from '../../../game';
import { Effect, PlaceDamageCountersEffect } from '../../../game/store/effects/game-effects';
import { AttachEnergyEffect } from '../../../game/store/effects/play-card-effects';
import { AFTER_ATTACK, CONFIRMATION_PROMPT, IS_ABILITY_BLOCKED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Gengarex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex];
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Haunter';
  public cardType: CardType[] = [CardType.DARK];
  public hp: number = 310;
  public weakness = [{ type: CardType.FIGHTING }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public powers = [
    {
      name: 'Gnawing Curse',
      powerType: PowerType.ABILITY,
      text: 'Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.',
    },
  ];

  public attacks = [
    {
      name: 'Tricky Steps',
      cost: [CardType.DARK, CardType.DARK],
      damage: 160,
      text: "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.",
    },
  ];

  public regulationMark = 'H';
  public set: string = 'TEF';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '104';
  public name: string = 'Gengar ex';
  public fullName: string = 'Gengar ex TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (AFTER_ATTACK(effect, 0, this)) {
      // TA-307 / TA-128 family A. Rulebook attack step F, compendium #543 ("Do damage first,
      // then apply effects") and #649 ("Like all attacks that don't explicitly say otherwise, the
      // effects of attacks are not applied until after damage is done", TPCi Rules Team 2015-05-07):
      // this rider PAUSES, so the base damage must already be on the board when it does. Written on
      // WAS_ATTACK_USED the rider ran inside the pre-damage block and the game paused showing the
      // defender at dmg=0 -- a mid-resolution divergence the end board never shows, which is why
      // nothing downstream reported it. AFTER_ATTACK is dispatched by the attack pipeline AFTER
      // DealDamage and BEFORE the KO sweep (game-effect.ts), which is exactly step F's order --
      // so this does not trade TA-79 (damage deferred) for TA-123 (rider dropped past the KO).
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      // CF-32 second class (PINNED 2026-07-28), the count-1 arm. This card prints the SAME rider as
      // `dri-070` Jamming Wing, which the pin names as its worked example -- *"a fixed count-1, the gate
      // is the only decline… which is exactly why BOTH engines already externalise it there"* -- and
      // which is already written this way in this repo. This card was not, so twinleaf inlined the
      // decline as a `confirm{false}` inside a flat min:0 pick while rotomancer externalised the gate.
      //
      // ⚠️ The Energy guard is NEW, and its absence was a latent CF-33 defect independent of the shape:
      // this card checked only `hasBench`, so on an opposing Active with NO Energy attached it offered a
      // `may` that could achieve nothing. `dri-070` and `cri-037` both check BOTH conditions. With the
      // gate externalised the inner pick is min:1, so the guard is also load-bearing here. Both zones are
      // public to the acting player, so suppressing on them leaks nothing -- CF-33 Boundary 1.
      const hasBench = opponent.bench.some(b => b.cards.length > 0);
      const hasEnergy = opponent.active.cards.some(c => c.superType === SuperType.ENERGY);

      if (!hasBench || !hasEnergy) {
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
              // TA-147: resolve the destination in the PROMPT's frame (`player`), not `opponent` --
              // the prompt is built player.id + TOP_PLAYER, so a second flip steals the Energy.
              const target = StateUtils.getTarget(state, player, transfer.to);
              MOVE_CARDS(store, state, opponent.active, target, { cards: [transfer.card], sourceCard: this });
            }
          });
        }
      });
    }

    // TA-641: "attaches an Energy card from their hand" -- an attach from the discard (Eelektrik asc-060 Dynamotor)
    // or the deck does not trigger it.
    if (effect instanceof AttachEnergyEffect && effect.fromHand) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      // Find the owner of this Gengar-EX
      let isGengarInPlay = false;
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card) => {
        if (card === this) {
          isGengarInPlay = true;
        }
      });

      if (!isGengarInPlay) {
        return state;
      }

      // Try to reduce PowerEffect, to check if something is blocking our ability
      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }
      // TA-254 / SD-13 (same fix as TA-253): route through PlaceDamageCountersEffect, not a raw
      // `.damage +=`. The raw write bypasses prevention effects AND leaves no placement log, so the
      // LETHAL tick produced a `ko` whose `damaged` the projection could not reconstruct (TA-132 —
      // twinleaf emitted 2 damaged events to rotomancer's 3, dropping exactly the one that KO'd).
      // The counters are placed by Gengar's OWNER (`opponent` of the attaching player).
      const placeCounters = new PlaceDamageCountersEffect(opponent, effect.target, 20, this);
      state = store.reduceEffect(state, placeCounters);
    }
    return state;
  }
}
