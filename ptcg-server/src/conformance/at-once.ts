import { TrainerCard } from '../game/store/card/trainer-card';
import { Card } from '../game/store/card/card';

/**
 * CF-55 — "you must/may play N <card> cards at once".
 *
 * A printing whose printed text carries an at-once clause is played by ONE action naming N cards,
 * and it counts as N plays. The wire shape is an answering `cards: [iid…]` against a menu template
 * carrying `candidates` (the pool) and `counts` (the legal lengths) — never one template per
 * combination, because an at-once play is ATOMIC by rule: you cannot play one copy and then decide.
 *
 * ## Why this is derived from PRINTED TEXT rather than declared on the card class
 *
 * The alternative is a `playAtOnce` property on `TrainerCard` plus an edit to each of the 8 card
 * files. That would put the conformance contract's vocabulary into `src/game`/`src/sets` — engine
 * surface, subject to the fix-ledger and to upstream merge conflicts — to express something the
 * printed text already states unambiguously. Deriving keeps the whole mechanism inside
 * `src/conformance`, where the rest of the wire adapter lives.
 *
 * ⚠️ The cost, stated: a card whose text is WRONG in the card DB gets the wrong template, and the
 * error is silent. That is a real exposure and the reason `atOnceSpec` is exported and directly
 * tested against all 8 printings rather than only through the menu.
 */
export interface AtOnceSpec {
  /** The printed N — the maximum number of copies one action may name. */
  max: number;
  /** Every legal `cards` length, ascending. The LENGTH is the branch selector. */
  counts: number[];
  /** True for "must play N", false for "may play N" (which also permits a lone copy). */
  mandatory: boolean;
}

/**
 * "You must play 2 Transformation Tome cards at once" / "You may use 4 Quad Stone cards at once".
 * Both verbs appear (Quad Stone is the lone "use"), and both are the same wire shape.
 */
const AT_ONCE = /You\s+(must|may)\s+(?:play|use)\s+(\d+)\s+[^.]*?\s+cards?\s+at\s+once/i;

/**
 * "• If you played 1 card, …" / "• If you used 4 cards, …" — the branch bullets that tell us a
 * "may" printing has more than one legal count. Read rather than assumed: the counts are NOT always
 * {1, N} contiguous — Missing Clover is [1, 4] and Puzzle of Time is [1, 2], and nothing legal sits
 * between 1 and 4 for the former.
 */
const BRANCH = /If\s+you\s+(?:played|used)\s+(\d+)\s+cards?/gi;

/** The at-once spec for a card, or null if its text carries no at-once clause. */
export function atOnceSpec(card: Card): AtOnceSpec | null {
  if (!(card instanceof TrainerCard)) { return null; }
  const text = card.text ?? '';
  const m = AT_ONCE.exec(text);
  if (m === null) { return null; }
  const mandatory = m[1].toLowerCase() === 'must';
  const max = parseInt(m[2], 10);
  if (!Number.isFinite(max) || max < 1) { return null; }

  if (mandatory) {
    // "This effect works one time for 2 cards" — one branch, exactly N.
    return { max, counts: [max], mandatory };
  }
  const found = new Set<number>();
  BRANCH.lastIndex = 0;   // module-level /g regex: reset or a second call resumes mid-string
  let b: RegExpExecArray | null;
  while ((b = BRANCH.exec(text)) !== null) {
    const n = parseInt(b[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= max) { found.add(n); }
  }
  // A "may" printing always permits its own full count even if the bullets are phrased oddly.
  found.add(max);
  return { max, counts: [...found].sort((a, b) => a - b), mandatory };
}

/** Does this card's printed text carry an at-once clause at all? (CF-55 rows 1 and 2.) */
export function isAtOnce(card: Card): boolean {
  return atOnceSpec(card) !== null;
}

/**
 * The at-once spec THIS ADAPTER CAN HONOUR ON THE WIRE — `atOnceSpec` narrowed to the printings
 * whose count gate the engine underneath actually enforces. Both the menu and the dispatcher read
 * this, never `atOnceSpec`, so the offer and the gate can never disagree.
 *
 * ## Why "may play 1 or N" is excluded, measured 2026-08-18 rather than assumed
 *
 * For the MANDATORY printings ("You must play 2 …") there is one branch and the count is real:
 * naming 2 cards spends 2 cards, and there is no second question.
 *
 * For the OPTIONAL ones ("You may play 2 … • If you played 1 card, … • If you played 2 cards, …")
 * twinleaf models the branch as a **SelectOptionPrompt raised AFTER the play**, not as the number of
 * cards named. Driven on `bkp-109` Puzzle of Time with two copies in hand:
 *
 * ```
 * cards:[A-p0]         -> SelectOption: CHOOSE_OPTION   legal: [selectOption 0, selectOption 1]
 * cards:[A-p0, A-p1]   -> SelectOption: CHOOSE_OPTION   legal: [selectOption 0, selectOption 1]
 * ```
 *
 * The length is **ignored**. Both counts reach the identical prompt offering both branches, so a
 * client could name ONE card and still take the two-card effect — the gate CF-55 exists to close,
 * wide open one step further in.
 *
 * Emitting a `counts: [1, 2]` template for those printings would therefore advertise a gate that
 * does not exist: the menu would assert a constraint nothing enforces, which is worse than not
 * offering the shape at all. Closing it properly means moving the branch out of the prompt and into
 * the play for 7 printings in `src/sets` — engine surface, fix-ledger, upstream merge risk — and
 * ALL of them are outside the engine intersection, so the change would have zero cross-engine reach.
 * Deferred and registered as TA-278 rather than half-shipped.
 *
 * The excluded printings keep their pre-existing singular-`card` path unchanged. That path is
 * CF-55 row 2 non-conformant, which is exactly what TA-278 records.
 */
export function atOnceWireSpec(card: Card): AtOnceSpec | null {
  const spec = atOnceSpec(card);
  return spec !== null && spec.mandatory ? spec : null;
}
