import { Card } from './card';

/**
 * Match a card against a `Partial<Card>`-style filter (the shape every ChooseCardsPrompt, CardList
 * query and search prefab takes).
 *
 * TA-335 (2026-08-31, at the upstream 7a35128f0 merge): upstream turned `PokemonCard.cardType` into
 * a `CardType[]` and rewrote 65 card files to filter with `{ cardType: [CardType.X] }`, but left
 * every matcher comparing with `!==`. Two arrays are never `===`, so every typed deck search
 * ("search your deck for a [G] Pokémon") matched NOTHING and self-resolved straight to the shuffle
 * — a whiff on a stocked deck, on every such card, silently.
 *
 * Semantics: a scalar filter value must be strictly equal (unchanged). An ARRAY filter value matches
 * when the card's value is an array that CONTAINS every filter element — for `cardType` that is
 * "is a Pokémon of that type" (a dual-type [G][M] card matches `[G]`), for `tags` "has that tag".
 * Before this change an array filter could never match anything, so no previously-matching card
 * stops matching; the change is strictly a widening.
 */
export function matchesCardFilter(card: Card, filter: object): boolean {
  for (const key in filter) {
    if (!Object.prototype.hasOwnProperty.call(filter, key)) { continue; }
    const expected: any = (filter as any)[key];
    const value: any = (card as any)[key];
    if (Array.isArray(expected)) {
      if (!Array.isArray(value)) { return false; }
      for (const e of expected) {
        if (!value.includes(e)) { return false; }
      }
      continue;
    }
    if (value !== expected) { return false; }
  }
  return true;
}
