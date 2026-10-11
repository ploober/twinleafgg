import { NeutralState, NeutralPlayerId, NeutralEvent, Location, TransitVisibility, PokemonInPlay } from './neutral-types';

/**
 * B.81 / CF-92 (contract 0.13.0): the `moved` event — one per card per physical pluck-and-place, `{owner, card,
 * origin, destination, visibility}`, derived from a before/after BOARD DIFF of two projected states.
 *
 * WHY A DIFF AND NOT THE ENGINE'S MOVE METHODS. The obvious emission point is `CardList.moveTo` /
 * `moveCardsTo`, but a census (2026-10-04, TA-591) found 181 direct `cards[]` mutations in `src/game` outside
 * card-list.ts and 76 more card files in `src/sets` that splice, push and reassign card arrays directly — the
 * move methods are not a choke point, and an emission there would be a partial record presented as a whole
 * one. A diff of the projected board sees every move that survives a dispatch whatever code path made it,
 * which is the same ground `damaged` / `ko` / `healed` stand on in events.ts. What it cannot see is a round
 * trip or an intermediate stop INSIDE one dispatch; that is the documented residual.
 *
 * Granularity: the driver calls this once per engine dispatch (dispatchAndCollect) and once more at a
 * mid-decision pause for the decomposer fix-up (the picks already made, projected in transit / at their
 * destination — driver.step), so the trace is exactly the sequence of boards the adapter can project, and the
 * harness's zone-replay law (initialState + legs = the response's board) holds by construction.
 */

/** One card's place on a board, keyed the way the harness keys it. */
interface Place {
  owner: NeutralPlayerId;
  loc: Location;
}

interface Board {
  at: Map<string, Place>;
  deck: Record<NeutralPlayerId, string[]>;
  transitVisibility: Map<string, TransitVisibility>;
  /** A lifted card's declared deck end (`destination: {deck, top|bottom}`), when its transit entry has one. */
  transitDeckEnd: Map<string, 'top' | 'bottom'>;
}

const PLAYERS: NeutralPlayerId[] = ['A', 'B'];

function stackPlaces(owner: NeutralPlayerId, section: 'active' | 'bench', pip: PokemonInPlay | null, at: Map<string, Place>): void {
  if (!pip || pip.stack.length === 0) { return; }
  const basic = pip.stack[0].iid;
  for (const c of pip.stack) { at.set(c.iid, { owner, loc: { zone: section, pokemon: basic, role: 'pokemon' } }); }
  for (const c of pip.energy) { at.set(c.iid, { owner, loc: { zone: section, pokemon: basic, role: 'energy' } }); }
  for (const c of pip.tools) { at.set(c.iid, { owner, loc: { zone: section, pokemon: basic, role: 'tool' } }); }
}

export function board(state: NeutralState): Board {
  const at = new Map<string, Place>();
  const deck: Record<NeutralPlayerId, string[]> = { A: [], B: [] };
  const transitVisibility = new Map<string, TransitVisibility>();
  const transitDeckEnd = new Map<string, 'top' | 'bottom'>();
  for (const owner of PLAYERS) {
    const p = state.players[owner];
    stackPlaces(owner, 'active', p.active, at);
    for (const b of p.bench) { stackPlaces(owner, 'bench', b, at); }
    for (const c of p.hand) { at.set(c.iid, { owner, loc: { zone: 'hand' } }); }
    for (const c of p.deck) { at.set(c.iid, { owner, loc: { zone: 'deck' } }); deck[owner].push(c.iid); }
    for (const c of p.discard) { at.set(c.iid, { owner, loc: { zone: 'discardPile' } }); }
    for (const c of p.lostZone) { at.set(c.iid, { owner, loc: { zone: 'lostZone' } }); }
    for (const c of p.prizes) { at.set(c.iid, { owner, loc: { zone: 'prizes' } }); }
    for (const c of p.resolving ?? []) { at.set(c.iid, { owner, loc: { zone: 'resolving' } }); }
    for (const c of p.transit ?? []) {
      at.set(c.iid, { owner, loc: { zone: 'transit' } });
      transitVisibility.set(c.iid, c.visibility);
      const end = c.destination?.zone === 'deck' ? c.destination.position : undefined;
      if (end === 'top' || end === 'bottom') { transitDeckEnd.set(c.iid, end); }
    }
  }
  if (state.stadium) {
    at.set(state.stadium.iid, { owner: state.stadium.owner, loc: { zone: 'stadium' } });
  }
  return { at, deck, transitVisibility, transitDeckEnd };
}

function samePlace(a: Place, b: Place): boolean {
  return a.owner === b.owner && a.loc.zone === b.loc.zone && a.loc.pokemon === b.loc.pokemon && a.loc.role === b.loc.role;
}

/** The zones whose cards lie face up on the table: a move into or out of one is seen by both players. */
const FACE_UP: ReadonlySet<string> = new Set(['discardPile', 'lostZone', 'active', 'bench', 'stadium', 'resolving']);

/**
 * Who could identify the card during the motion. A face-up end makes the motion public; a card revealed in this
 * dispatch is public; a transit end carries the transit entry's own visibility (the shuffle segment is hidden,
 * a look is owner-known); everything else — a draw, a Prize taken, a hand going under the deck — is known to
 * the owner. `hidden` is never guessed here: it comes only from a transit entry that says so (B.81 §4: a card
 * its owner has seen is never hidden).
 */
function visibilityOf(from: Place, to: Place, iid: string, before: Board, after: Board, revealed: ReadonlySet<string>): TransitVisibility {
  if (revealed.has(iid) || FACE_UP.has(from.loc.zone) || FACE_UP.has(to.loc.zone)) {
    return 'public';
  }
  if (to.loc.zone === 'transit') {
    return after.transitVisibility.get(iid) ?? 'owner';
  }
  if (from.loc.zone === 'transit') {
    return before.transitVisibility.get(iid) ?? 'owner';
  }
  return 'owner';
}

/**
 * The legs between two boards, in an order the harness's replay reproduces: for each player the cards that
 * landed on TOP of the deck are emitted deepest-first (each replayed `top` leg stacks above the previous), the
 * cards that landed at the BOTTOM in index order, everything else as encountered. A card that moved to a deck
 * position that is neither its contiguous top nor its contiguous bottom is `any` (shuffled in; the harness
 * holds that to a following `shuffled`). So is every card that landed in a deck whose WHOLE-deck shuffle is open
 * when the dispatch ends (`shuffledIn`): the engine puts the card on top or underneath and THEN raises the
 * shuffle, but the text shuffles it in (rotomancer's legs say `any` there too). A bottom-SEGMENT shuffle (Metal
 * Maker's remainder) is not in `shuffledIn`: those cards do go to the bottom.
 */
export function deriveMoved(beforeState: NeutralState, afterState: NeutralState, revealed: ReadonlySet<string> = new Set(),
    shuffledIn: ReadonlySet<NeutralPlayerId> = new Set(),
    declaredEnd: (iid: string) => 'top' | 'bottom' | undefined = () => undefined): NeutralEvent[] {
  const before = board(beforeState);
  const after = board(afterState);
  const moved: Array<{ iid: string; from: Place; to: Place }> = [];
  for (const [iid, to] of after.at) {
    const from = before.at.get(iid);
    if (from === undefined || samePlace(from, to)) { continue; }
    moved.push({ iid, from, to });
  }
  if (moved.length === 0) { return []; }

  // Deck destinations: classify by where the card sits in the after-deck.
  const toDeck: Record<NeutralPlayerId, Set<string>> = { A: new Set(), B: new Set() };
  for (const m of moved) {
    if (m.to.loc.zone === 'deck') { toDeck[m.to.owner].add(m.iid); }
  }
  const position = new Map<string, 'top' | 'bottom' | 'any'>();
  const topOrder: string[] = [];      // deepest first
  const bottomOrder: string[] = [];   // index order
  for (const owner of PLAYERS) {
    const deck = after.deck[owner];
    const landed = toDeck[owner];
    if (landed.size === 0) { continue; }
    if (shuffledIn.has(owner)) {
      for (const iid of landed) { position.set(iid, 'any'); }
      continue;
    }
    // The landed cards ARE the whole deck: top and bottom coincide. Their declared end decides (Iono's block, lifted
    // `-> {deck, bottom}`, under a deck its own draws then emptied: rotomancer cuts before the draws and says bottom).
    // TA-704: or the end the engine's placement declared (`toBottom`; CardList.deckEnd) — Energy Swatter por-073 puts
    // the chosen Energy "on the bottom of their deck" with no pause in transit.
    if (deck.length > 0 && deck.every(iid => landed.has(iid))
        && deck.every(iid => (before.transitDeckEnd.get(iid) ?? declaredEnd(iid)) === 'bottom')) {
      for (const iid of deck) { position.set(iid, 'bottom'); bottomOrder.push(iid); }
      continue;
    }
    let top = 0;
    while (top < deck.length && landed.has(deck[top])) { top++; }
    let bottom = deck.length;
    while (bottom > top && landed.has(deck[bottom - 1])) { bottom--; }
    for (let i = top - 1; i >= 0; i--) { position.set(deck[i], 'top'); topOrder.push(deck[i]); }
    for (let i = bottom; i < deck.length; i++) { position.set(deck[i], 'bottom'); bottomOrder.push(deck[i]); }
    for (const iid of landed) { if (!position.has(iid)) { position.set(iid, 'any'); } }
  }

  const byIid = new Map(moved.map(m => [m.iid, m] as const));
  const ordered: string[] = [];
  const seen = new Set<string>();
  const take = (iid: string) => { if (!seen.has(iid)) { seen.add(iid); ordered.push(iid); } };
  for (const m of moved) { if (m.to.loc.zone !== 'deck') { take(m.iid); } }
  for (const iid of bottomOrder) { take(iid); }
  for (const iid of topOrder) { take(iid); }
  for (const m of moved) { take(m.iid); }   // any remaining (position any)

  const out: NeutralEvent[] = [];
  for (const iid of ordered) {
    const m = byIid.get(iid)!;
    const destination: Location = { ...m.to.loc };
    if (destination.zone === 'deck') { destination.position = position.get(iid) ?? 'any'; }
    out.push({
      kind: 'moved', owner: m.to.owner, card: iid,
      origin: { ...m.from.loc }, destination,
      visibility: visibilityOf(m.from, m.to, iid, before, after, revealed),
    });
  }
  return out;
}
