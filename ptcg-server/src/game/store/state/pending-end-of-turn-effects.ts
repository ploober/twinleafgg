import { Attack } from '../card/pokemon-types';
import { SpecialCondition } from '../card/card-types';
import { PokemonCard } from '../card/pokemon-card';
import { PokemonCardList } from './pokemon-card-list';

export interface PendingEndOfTurnEffectBase {
  target: PokemonCardList;
  attack: Attack;
  sourceCard: PokemonCard;
  attackerPlayerId: number;
  /**
   * TA-366: true when the target was the DEFENDING (Active) Pokémon at schedule time. An effect on
   * the Defending Pokémon ends when it leaves the Active Spot (compendium: Amnesia/Daunt), so the
   * resolver skips a wasActive pending whose target has since moved to the Bench. Explicit
   * bench-targeted schedules are not Defending-Pokémon effects and are unaffected.
   */
  wasActive?: boolean;
}

export interface PendingEndOfTurnKnockOut extends PendingEndOfTurnEffectBase {
  type: 'knock_out';
}

export interface PendingEndOfTurnDiscard extends PendingEndOfTurnEffectBase {
  type: 'discard';
}

export interface PendingEndOfTurnDamageCounters extends PendingEndOfTurnEffectBase {
  type: 'damage_counters';
  damage: number;
}

export interface PendingEndOfTurnSpecialCondition extends PendingEndOfTurnEffectBase {
  type: 'special_condition';
  specialCondition: SpecialCondition;
}

export type PendingEndOfTurnEffect =
  | PendingEndOfTurnKnockOut
  | PendingEndOfTurnDiscard
  | PendingEndOfTurnDamageCounters
  | PendingEndOfTurnSpecialCondition;
