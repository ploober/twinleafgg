import { NeutralState, NeutralPlayerId, CardRef, PokemonInPlay, TransitRef, TransitVisibility, Location, StackRole } from './neutral-types';

/**
 * B.80 / CF-91 (contract 0.12.0): the wire shows a card where it PHYSICALLY is. A card a player has lifted
 * out of a zone and not yet placed is in `PlayerState.transit`, owned by the card's owner, ordered, with
 * `origin`, `visibility` and (when known) `destination`. A pick that itself places the card (a cost
 * discard, #916 "those go into the Discard Pile right away"; a moved Energy; a counter) is at its
 * destination at once.
 *
 * B.81 / CF-92 (contract 0.13.0): `origin` and `destination` are `Location` objects — zone, and for an
 * in-play place the stack (basic iid) and the role on it, for a deck destination the position.
 *
 * The engine's prompts resolve atomically and the adapter accumulates picks until the last one, so the
 * mid-decision board is PROJECTED here, by each decomposer's `fixupProjection`, from (native state, picks
 * so far). These helpers edit the projected NeutralState in place; they never touch the engine.
 */

/**
 * A settled-zone tag (CardList.zoneTag / fromZoneTag, or a card-text stamp) as a wire `Location`; undefined
 * when the tag is unknown or names a place this cannot resolve alone (`inPlay` / `play` need the stack —
 * callers that know it build the Location themselves; see `stackLocation`). A destination tag of `deck` is a
 * shuffle-in (`position: any`), `deckBottom` is `position: bottom`.
 */
export function locationOfTag(tag: string | undefined, asDestination = false): Location | undefined {
  switch (tag) {
    case 'hand': return { zone: 'hand' };
    case 'deck': return asDestination ? { zone: 'deck', position: 'any' } : { zone: 'deck' };
    case 'deckTop': return { zone: 'deck', position: 'top' };
    case 'deckBottom': return { zone: 'deck', position: 'bottom' };
    case 'discard': case 'discardPile': return { zone: 'discardPile' };
    case 'lostZone': return { zone: 'lostZone' };
    case 'prizes': return { zone: 'prizes' };
    case 'stadium': return { zone: 'stadium' };
    default: return undefined;
  }
}

/** The projected Pokémon whose stack bottom (basic) is `pokemonIid`, with its owner and section. */
export function findPip(projected: NeutralState, pokemonIid: string):
    { owner: NeutralPlayerId; pip: PokemonInPlay; section: 'active' | 'bench' } | undefined {
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = projected.players[who];
    if (p.active && p.active.stack.length > 0 && p.active.stack[0].iid === pokemonIid) {
      return { owner: who, pip: p.active, section: 'active' };
    }
    for (const pip of p.bench) {
      if (pip && pip.stack.length > 0 && pip.stack[0].iid === pokemonIid) {
        return { owner: who, pip, section: 'bench' };
      }
    }
  }
  return undefined;
}

/** The in-play Location of a card with `role` on the projected Pokémon `pokemonIid`; undefined when it is not in play. */
export function stackLocation(projected: NeutralState, pokemonIid: string, role: StackRole): Location | undefined {
  const found = findPip(projected, pokemonIid);
  return found === undefined ? undefined : { zone: found.section, pokemon: pokemonIid, role };
}

/**
 * Take `iid` out of whichever projected zone holds it (either player's hand / deck / discard / lostZone /
 * prizes / transit, or an in-play Pokémon's energy or tools). Returns where it was (as a Location), or
 * undefined when no projected zone holds it (a closure-local orphan the orphan pass will route). The Pokémon
 * stacks are never searched: a Pokémon in play is not lifted by a pick that names it as a target.
 */
export function removeFromProjection(projected: NeutralState, iid: string):
    { owner: NeutralPlayerId; location: Location; ref: CardRef; transit?: TransitRef } | undefined {
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = projected.players[who];
    for (const zone of ['hand', 'deck', 'discard', 'lostZone'] as const) {
      const at = p[zone].findIndex(c => c.iid === iid);
      if (at !== -1) {
        const [ref] = p[zone].splice(at, 1);
        return { owner: who, location: { zone: zone === 'discard' ? 'discardPile' : zone }, ref: { iid: ref.iid, printing: ref.printing } };
      }
    }
    const pz = p.prizes.findIndex(c => c.iid === iid);
    if (pz !== -1) {
      const [ref] = p.prizes.splice(pz, 1);
      return { owner: who, location: { zone: 'prizes' }, ref: { iid: ref.iid, printing: ref.printing } };
    }
    const tr = (p.transit ?? []).findIndex(c => c.iid === iid);
    if (tr !== -1) {
      const [t] = p.transit!.splice(tr, 1);
      return { owner: who, location: { zone: 'transit' }, ref: { iid: t.iid, printing: t.printing }, transit: t };
    }
    const slots: Array<{ pip: PokemonInPlay | null; section: 'active' | 'bench' }> =
      [{ pip: p.active, section: 'active' }, ...p.bench.map(b => ({ pip: b, section: 'bench' as const }))];
    for (const { pip, section } of slots) {
      if (!pip || pip.stack.length === 0) { continue; }
      for (const [list, role] of [[pip.energy, 'energy'], [pip.tools, 'tool']] as Array<[CardRef[], StackRole]>) {
        const i = list.findIndex(c => c.iid === iid);
        if (i !== -1) {
          const [ref] = list.splice(i, 1);
          return { owner: who, location: { zone: section, pokemon: pip.stack[0].iid, role }, ref: { iid: ref.iid, printing: ref.printing } };
        }
      }
    }
  }
  return undefined;
}

/**
 * Lift `iid` out of its projected zone into its OWNER's transit (appended: pick order). A card already in
 * transit keeps its place and its fields unless `fields` names new ones. A card no projected zone holds is
 * left to the orphan pass. Returns true when the card is now in transit. `origin` defaults to where the card
 * was taken from (the full in-play Location for an attached card).
 */
export function liftToTransit(projected: NeutralState, iid: string,
    fields: { visibility: TransitVisibility; origin?: Location; destination?: Location }): boolean {
  const taken = removeFromProjection(projected, iid);
  if (taken === undefined) {
    return false;
  }
  const p = projected.players[taken.owner];
  const prev = taken.transit;
  const origin = fields.origin ?? prev?.origin ?? (taken.location.zone === 'transit' ? undefined : taken.location);
  // TA-811: selecting a face-up card does not hide it while its destination is pending.
  // Infer this in the shared helper so both partial picks and completed selections agree.
  const publicOrigin = origin !== undefined && ['active', 'bench', 'discardPile', 'lostZone'].includes(origin.zone);
  const visibility = publicOrigin ? 'public' : fields.visibility;
  const entry: TransitRef = { iid: taken.ref.iid, printing: taken.ref.printing, visibility };
  if (origin !== undefined) { entry.origin = { ...origin }; }
  const destination = fields.destination ?? prev?.destination;
  if (destination !== undefined) { entry.destination = { ...destination }; }
  p.transit = [...(p.transit ?? []), entry];
  return true;
}

/** Place `iid` (from wherever it is projected) into `owner`'s discard pile — a cost or effect discard pick. */
export function placeInDiscard(projected: NeutralState, iid: string): boolean {
  const taken = removeFromProjection(projected, iid);
  if (taken === undefined) {
    return false;
  }
  projected.players[taken.owner].discard.push(taken.ref);
  return true;
}

/** Place `iid` (from wherever it is projected) onto the Pokémon `pokemonIid` as attached Energy. */
export function placeOnPokemon(projected: NeutralState, iid: string, pokemonIid: string): boolean {
  const target = findPip(projected, pokemonIid);
  if (target === undefined) {
    return false;
  }
  const taken = removeFromProjection(projected, iid);
  if (taken === undefined) {
    return false;
  }
  target.pip.energy.push(taken.ref);
  return true;
}

/** Add `delta` HP of damage to the Pokémon `pokemonIid` in the projection (never below 0). */
export function adjustDamage(projected: NeutralState, pokemonIid: string, delta: number): boolean {
  const target = findPip(projected, pokemonIid);
  if (target === undefined) {
    return false;
  }
  target.pip.damage = Math.max(0, target.pip.damage + delta);
  return true;
}
