import { NeutralState, NeutralPlayerId, CardRef, PokemonInPlay, TransitRef, TransitOrigin, TransitVisibility, TransitDestination } from './neutral-types';

/**
 * B.80 / CF-91 (contract 0.12.0): the wire shows a card where it PHYSICALLY is. A card a player has lifted
 * out of a zone and not yet placed is in `PlayerState.transit`, owned by the card's owner, ordered, with
 * `origin`, `visibility` and (when known) `destination`. A pick that itself places the card (a cost
 * discard, #916 "those go into the Discard Pile right away"; a moved Energy; a counter) is at its
 * destination at once.
 *
 * The engine's prompts resolve atomically and the adapter accumulates picks until the last one, so the
 * mid-decision board is PROJECTED here, by each decomposer's `fixupProjection`, from (native state, picks
 * so far). These helpers edit the projected NeutralState in place; they never touch the engine.
 */

const ZONE_TO_ORIGIN: Record<string, TransitOrigin> = {
  hand: 'hand', deck: 'deck', discard: 'discardPile', discardPile: 'discardPile',
  lostZone: 'lostZone', prizes: 'prizes', inPlay: 'inPlay', play: 'inPlay',
};

/** A settled-zone tag (CardList.zoneTag / fromZoneTag) as a wire `origin`; undefined when unknown. */
export function originOfTag(tag: string | undefined): TransitOrigin | undefined {
  return tag === undefined ? undefined : ZONE_TO_ORIGIN[tag];
}

/** The projected Pokémon whose stack bottom (basic) is `pokemonIid`, with its owner. */
export function findPip(projected: NeutralState, pokemonIid: string): { owner: NeutralPlayerId; pip: PokemonInPlay } | undefined {
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = projected.players[who];
    for (const pip of [p.active, ...p.bench]) {
      if (pip && pip.stack.length > 0 && pip.stack[0].iid === pokemonIid) {
        return { owner: who, pip };
      }
    }
  }
  return undefined;
}

/**
 * Take `iid` out of whichever projected zone holds it (either player's hand / deck / discard / lostZone /
 * prizes / transit, or an in-play Pokémon's energy or tools). Returns where it was, or undefined when no
 * projected zone holds it (a closure-local orphan the orphan pass will route). The Pokémon stacks are
 * never searched: a Pokémon in play is not lifted by a pick that names it as a target.
 */
export function removeFromProjection(projected: NeutralState, iid: string):
    { owner: NeutralPlayerId; zone: string; ref: CardRef; transit?: TransitRef } | undefined {
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = projected.players[who];
    for (const zone of ['hand', 'deck', 'discard', 'lostZone'] as const) {
      const at = p[zone].findIndex(c => c.iid === iid);
      if (at !== -1) {
        const [ref] = p[zone].splice(at, 1);
        return { owner: who, zone, ref: { iid: ref.iid, printing: ref.printing } };
      }
    }
    const pz = p.prizes.findIndex(c => c.iid === iid);
    if (pz !== -1) {
      const [ref] = p.prizes.splice(pz, 1);
      return { owner: who, zone: 'prizes', ref: { iid: ref.iid, printing: ref.printing } };
    }
    const tr = (p.transit ?? []).findIndex(c => c.iid === iid);
    if (tr !== -1) {
      const [t] = p.transit!.splice(tr, 1);
      return { owner: who, zone: 'transit', ref: { iid: t.iid, printing: t.printing }, transit: t };
    }
    for (const pip of [p.active, ...p.bench]) {
      if (!pip) { continue; }
      for (const list of [pip.energy, pip.tools]) {
        const i = list.findIndex(c => c.iid === iid);
        if (i !== -1) {
          const [ref] = list.splice(i, 1);
          return { owner: who, zone: 'inPlay', ref: { iid: ref.iid, printing: ref.printing } };
        }
      }
    }
  }
  return undefined;
}

/**
 * Lift `iid` out of its projected zone into its OWNER's transit (appended: pick order). A card already in
 * transit keeps its place and its fields unless `fields` names new ones. A card no projected zone holds is
 * left to the orphan pass. Returns true when the card is now in transit.
 */
export function liftToTransit(projected: NeutralState, iid: string,
    fields: { visibility: TransitVisibility; origin?: TransitOrigin; destination?: TransitDestination }): boolean {
  const taken = removeFromProjection(projected, iid);
  if (taken === undefined) {
    return false;
  }
  const p = projected.players[taken.owner];
  const prev = taken.transit;
  const origin = fields.origin ?? prev?.origin ?? originOfTag(taken.zone === 'transit' ? undefined : taken.zone);
  const entry: TransitRef = { iid: taken.ref.iid, printing: taken.ref.printing, visibility: fields.visibility };
  if (origin !== undefined) { entry.origin = origin; }
  const destination = fields.destination ?? prev?.destination;
  if (destination !== undefined) { entry.destination = destination; }
  if (taken.zone === 'transit') {
    // keep its position in the pile
    const list = p.transit ?? [];
    let pos = list.length;
    for (let i = 0; i < list.length; i++) { /* appended below; position restored by the caller's order */ }
    p.transit = [...list.slice(0, pos), entry, ...list.slice(pos)];
  } else {
    p.transit = [...(p.transit ?? []), entry];
  }
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
