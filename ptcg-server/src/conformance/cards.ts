import { catalogCards, isNondeterministic } from './capabilities';
import { projectCard } from './card-projection';
import { toPrinting } from './printing';
import { NeutralCard, NeutralCardList } from './neutral-types';
import { isLegalIn, ServedFormat } from './formats';

/**
 * A `GET /v1/cards/{setCode}` request for a set this engine implements no cards in. The HTTP binding
 * maps it to a 404 `unknownSet` (a set the runner never asked for — its `sets` map lists only sets
 * with ≥1 card — but modelled explicitly so a bad request is a clean 404, not an empty 200).
 */
export class UnknownSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownSetError';
  }
}

let bySetCache: Map<string, NeutralCardList> | undefined;

/** Project the whole registry once, grouped by set code, deduped by `printing`, sorted. Memoized so
 * a run that pages every set (the harness catalog build) projects each card exactly once. */
function cardsBySet(): Map<string, NeutralCardList> {
  if (bySetCache !== undefined) {
    return bySetCache;
  }
  const groups = new Map<string, Map<string, NeutralCard>>();
  for (const card of catalogCards()) {
    const code = card.set.toLowerCase();
    let byPrinting = groups.get(code);
    if (byPrinting === undefined) {
      byPrinting = new Map<string, NeutralCard>();
      groups.set(code, byPrinting);
    }
    const printing = toPrinting(card);
    if (!byPrinting.has(printing)) {
      const projected = projectCard(card);
      // CF-23: mark cards with an inline-random effect path (e.g. asr-146's Math.random prize shuffle).
      // They stay in the catalog (instantiable, deterministically testable up to the random branch),
      // but the marker tells the harness / a scenario author the random branch is single-engine only.
      if (isNondeterministic(card)) {
        projected.nondeterministic = true;
      }
      byPrinting.set(printing, projected);
    }
  }
  bySetCache = new Map<string, NeutralCardList>();
  for (const [code, byPrinting] of groups) {
    const cards = Array.from(byPrinting.values()).sort((a, b) => a.printing.localeCompare(b.printing));
    bySetCache.set(code, { setCode: code, cards });
  }
  return bySetCache;
}

/**
 * The `GET /v1/cards/{setCode}` payload: every implemented card in `setCode`, projected to the
 * neutral printed-data shape and sorted by `printing`. Deduped by `printing` so the list length
 * equals the `Capabilities.sets[setCode]` count. Uses the same `supportedCards()` filter as
 * capabilities, so the two are guaranteed consistent. Throws `UnknownSetError` when the set has no
 * implemented cards.
 */
export function buildCardsForSet(setCode: string, format?: ServedFormat): NeutralCardList {
  const list = cardsBySet().get(setCode.toLowerCase());
  if (list === undefined) {
    throw new UnknownSetError(`no implemented cards in set "${setCode.toLowerCase()}"`);
  }
  // No format = the whole implemented catalog for the set (what `capabilities.sets` counts). The HTTP
  // endpoint always passes one (CF-85), so the wire only ever serves a per-format legality claim.
  return format === undefined ? list : legalIn(list, format);
}

const legalCache = new Map<string, NeutralCardList>();

/**
 * CF-85: the set's cards that twinleaf's own deck validator calls legal in `format` — the engine's legality
 * CLAIM, which the harness verifies. A set with none answers an empty list (200), not a 404: the set is
 * implemented, just not legal in this format.
 */
function legalIn(list: NeutralCardList, format: ServedFormat): NeutralCardList {
  const key = `${format}:${list.setCode}`;
  const hit = legalCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const legal = new Set<string>();
  for (const card of catalogCards()) {
    if (card.set.toLowerCase() === list.setCode && isLegalIn(card, format)) {
      legal.add(toPrinting(card));
    }
  }
  const out = { setCode: list.setCode, cards: list.cards.filter(c => legal.has(c.printing)) };
  legalCache.set(key, out);
  return out;
}
