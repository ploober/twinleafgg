import { State } from '../state/state';

/**
 * What a target pick DOES to the Pokémon it picks.
 *
 * Several prompts are generic pickers reused across unrelated effects — `ChoosePokemonPrompt` picks a
 * target for anything, and `PutDamagePrompt` distributes an amount that is sometimes damage counters
 * and sometimes real damage. The prompt type therefore does not identify the operation, and neither
 * does `GameMessage.CHOOSE_POKEMON_TO_DAMAGE`, which both families use. Only the constructing card
 * knows, because it is the thing that will build a `PutCountersEffect` or a `PutDamageEffect` once the
 * pick comes back.
 *
 * Declaring it on the prompt moves that already-existing distinction earlier — to prompt time, where
 * anything reading the prompt (notably the conformance adapter, which must name the operation on the
 * wire per CF-32) can see it. Each prompt documents its own default; a card only declares the value
 * when it differs from that default.
 */
export type TargetOperation = 'placeCounters' | 'dealDamage';

export abstract class Prompt<T> {

  readonly abstract type: string;
  public id: number;
  public result: T | undefined;

  /**
   * When set, CardTarget BOTTOM/TOP and deck/prize ownership resolve relative to
   * this player instead of playerId. Used when one player answers prompts for
   * another player's effect (e.g. Hypno Hand Control).
   */
  public perspectivePlayerId?: number;

  constructor(public playerId: number) {
    this.id = 0;
  }

  /** Board / resource owner for this prompt (defaults to the answering player). */
  public getPerspectivePlayerId(): number {
    return this.perspectivePlayerId ?? this.playerId;
  }

  public decode(result: any, state: State): T | null {
    return result;
  }

  public validate(result: T | null, state: State): boolean {
    return true;
  }

}
