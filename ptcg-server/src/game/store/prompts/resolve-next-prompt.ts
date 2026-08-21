import { GameMessage } from '../../game-message';
import { Card } from '../card/card';
import { Prompt } from './prompt';

/**
 * One candidate in a simultaneous batch — the thing the player is choosing to resolve NEXT.
 *
 * `ability` is present exactly when the effect is a NAMED Ability, and absent when it is the card's
 * own printed rules text (a Tool's reaction, a Special Energy's clause). That split is not cosmetic:
 * it is CF-38's `kind` discriminator — `abilityEffect` vs `cardTextEffect` — and the conformance
 * adapter reads it straight off this field rather than re-deriving it from the card's superType,
 * which would get the six Antique Fossils wrong (they are Trainers carrying a real Ability).
 */
export interface ResolveNextCandidate {
  /** The card the effect comes from — a Pokemon, a Tool, an Energy. Its iid identifies it on the wire. */
  card: Card;
  /** The Ability's name when the effect is a named Ability; undefined for printed rules text. */
  ability?: string;
}

/**
 * "Two of your effects are ready at once — which resolves first?" (CF-38, §B.40, TA-292.)
 *
 * WHY THIS EXISTS. `Store.propagateEffect` walks every card in play calling `reduceEffect`, sorted by
 * `superType`. That sort IS the order two simultaneous effects resolve in, and it is arbitrary with
 * respect to the rules. On `por-017` Turtonator holding `twm-150` Handheld Fan, Shell Spikes
 * (discard an Energy from the Attacker) and the Fan (move an Energy from the Attacker to a Bench)
 * both fire, and when the Attacker holds exactly ONE Energy the first to run consumes it and the
 * second silently finds nothing to act on. The order does not merely decide a zone — it decides
 * WHICH PRINTED EFFECT HAPPENS, and the player never saw the choice.
 *
 * THE DECIDER IS THE OWNER OF THE TRIGGERS, not the turn player. Compendium #1874 (Klawf ex
 * "Counterattacking Pincer" + Rugged Helmet, damaged by the opponent's attack): "The Counterattacking
 * Pincer ability and Rugged Helmet are triggered simultaneously, so YOU may choose the order in which
 * they are applied" — "you" being the defender, on the opponent's turn, over effects that touch the
 * attacker's Energy. It is the only record in the corpus that separates owner-of-triggers from both
 * turn-player and owner-of-affected at once.
 *
 * ONE PROMPT PER PICK, not one permutation. The batch re-prompts with the remainder after each
 * choice, so a three-effect batch asks twice and a two-effect batch asks once. That is CF-38's
 * spelling, and it also means the player sees the board as it actually is when making the second
 * choice.
 */
export class ResolveNextPrompt extends Prompt<number> {

  readonly type: string = 'ResolveNext';

  constructor(
    playerId: number,
    public candidates: ResolveNextCandidate[],
    public message: GameMessage = GameMessage.CHOOSE_OPTION
  ) {
    super(playerId);
  }

  public validate(result: number | null, state: any): boolean {
    // A batch is only raised with two or more candidates, and every one of them is selectable —
    // there is no "decline": the effects resolve either way, the player only chooses the order.
    return result !== null && Number.isInteger(result) && result >= 0 && result < this.candidates.length;
  }
}
