import { supportedCards } from './capabilities';
import { projectCard } from './card-projection';
import { toPrinting } from './printing';
import { NeutralCard, NeutralCardList } from './neutral-types';

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
  for (const card of supportedCards()) {
    const code = card.set.toLowerCase();
    let byPrinting = groups.get(code);
    if (byPrinting === undefined) {
      byPrinting = new Map<string, NeutralCard>();
      groups.set(code, byPrinting);
    }
    const printing = toPrinting(card);
    if (!byPrinting.has(printing)) {
      byPrinting.set(printing, projectCard(card));
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
export function buildCardsForSet(setCode: string): NeutralCardList {
  const list = cardsBySet().get(setCode.toLowerCase());
  if (list === undefined) {
    throw new UnknownSetError(`no implemented cards in set "${setCode.toLowerCase()}"`);
  }
  return list;
}
