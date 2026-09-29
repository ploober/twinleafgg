import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardTag, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State, GamePhase } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { AfterDamageEffect, PutCountersEffect } from '../../../game/store/effects/attack-effects';
import { StateUtils } from '../../../game/store/state-utils';
import { ToolEffect } from '../../../game/store/effects/play-card-effects';

export class DeluxeBomb extends TrainerCard {
  public regulationMark = 'H';
  protected _tags = [CardTag.ACE_SPEC];
  public trainerType: TrainerType = TrainerType.TOOL;
  public set: string = 'SCR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '134';
  public name = 'Deluxe Bomb';
  public fullName = 'Deluxe Bomb SCR';

  public text: string =
    "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 12 damage counters on the Attacking Pokémon. If you placed any damage counters in this way, discard this card.";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof AfterDamageEffect && effect.target.tools.includes(this)) {
      const player = effect.player;
      const targetPlayer = StateUtils.findOwner(state, effect.target);

      // Try to reduce ToolEffect, to check if something is blocking the tool from working
      try {
        const stub = new ToolEffect(effect.player, this);
        store.reduceEffect(state, stub);
      } catch {
        return state;
      }

      if (effect.damage <= 0 || player === targetPlayer || targetPlayer.active !== effect.target) {
        return state;
      }

      if (state.phase === GamePhase.ATTACK) {
        // TA-187, half 1: this was `effect.source.damage += 120` — a raw mutation of the attacker's
        // damage total. The damage DID land (the knock-out still happened), but no `damaged` event was
        // ever emitted and nothing downstream could see or prevent the placement, so on the wire the
        // reaction was invisible. `PutCountersEffect` is the established idiom for this shape
        // (cf. `set-chaos-rising/chesnaught.ts`): 12 damage counters = 120, placed as COUNTERS so
        // Weakness/Resistance correctly do not apply.
        const damageBefore = effect.source.damage;

        const putCounters = new PutCountersEffect(effect.attackEffect, 120);
        putCounters.target = effect.source;
        store.reduceEffect(state, putCounters);

        // "If you placed any damage counters in this way, discard this card." The discard is
        // CONDITIONAL on the placement actually happening, so a prevented placement must leave the
        // Tool attached — which is why this reads the attacker's damage rather than assuming.
        if (effect.source.damage > damageBefore) {
          // TA-187, half 2: this iterated `effect.target.cards` — the Pokémon stack — looking for
          // `this`, so the test never matched and the Tool was NEVER discarded. A Tool lives in
          // `.tools`, not in `.cards`.
          effect.target.moveCardTo(this, targetPlayer.discard);
        }
      }
    }

    return state;
  }
}
