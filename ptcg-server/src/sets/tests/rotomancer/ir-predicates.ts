import { State } from '../../../game/store/state/state';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Player } from '../../../game/store/state/player';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { SpecialCondition, CardType } from '../../../game/store/card/card-types';
import { StateUtils } from '../../../game/store/state-utils';
import { resolveV2Single, resolveV2Selector, V2Selector } from './ir-selectors';
import { matchesCardPredicate } from './ir-cards';

/**
 * Evaluates a Rotomancer IR **v2** predicate against live Twinleaf state. v2 predicates are a
 * single-discriminator sum type ({ kind, … }) instead of the v1 god-record. Supports the
 * deterministic leaves that appear in attack conditionals: and/or/not, isa (intrinsic, on a
 * contextual subject), damageState, conditionOn, stadiumInPlay, energyAttachedCount, boardCount,
 * hpRemaining, prize, handSize, deckSize, cardInZone, compare, plus the turn-state leaves read from
 * engine signals: turn (went-first / own-first-turn via state.turn), movedToActive (switched-in this
 * turn via player.movedToActiveThisTurn), history event:'evolved' (via pokemonPlayedTurn), and hasTool
 * (via the per-Pokémon `tools` array). The remaining history events (attackUsed/healed) and other
 * leaves (nameTag, resistanceType, …) throw, so the differential simply skips that card rather than guessing.
 */

const CONDITIONS: Record<string, SpecialCondition> = {
  POISONED: SpecialCondition.POISONED, BURNED: SpecialCondition.BURNED, ASLEEP: SpecialCondition.ASLEEP,
  PARALYZED: SpecialCondition.PARALYZED, CONFUSED: SpecialCondition.CONFUSED,
};

function playerOf(effect: AttackEffect, who?: string): Player {
  return who === 'opponent' ? effect.opponent : effect.player;
}

// Going-first / first-turn game attribute, read from the same engine state native cards read
// (state.turn + state.activePlayer). Convention (sets/AGENTS.md): turn 1 is the first player's first
// turn, turn 2 the second player's first turn — so the active player went first iff state.turn is odd,
// and "your first turn" is state.turn <= 2. Native and the interpreter read the identical state.turn,
// so they always agree; only the boundary of which branch fires varies with the turn the game is on.
function turnAspect(state: State, player: Player, aspect: string): boolean {
  const pActive = state.players.indexOf(player) === state.activePlayer;
  const activeWentFirst = state.turn % 2 === 1;
  const wentFirst = pActive ? activeWentFirst : !activeWentFirst;
  switch (aspect) {
    case 'wentFirst': return wentFirst;
    case 'wentSecond': return !wentFirst;
    case 'isFirstTurn': return state.turn === 1;             // the game's very first turn
    case 'isOwnFirstTurn': return pActive && state.turn <= 2; // the acting player's own first turn
    default: throw new Error(`[ir-predicates] turn aspect "${aspect}" not modeled`);
  }
}

function compareOp(op: string, l: number, r: number): boolean {
  switch (op) {
    case 'eq': return l === r;
    case 'ne': return l !== r;
    case 'gt': return l > r;
    case 'ge': return l >= r;
    case 'lt': return l < r;
    case 'le': return l <= r;
    default: throw new Error(`[ir-predicates] unsupported compare op "${op}"`);
  }
}

// energyAttachedCount / energy attr: count energy cards on a list, optionally filtered by an isa.
function energyCount(list: PokemonCardList, pred: any): number {
  return list.cards.filter(c => c instanceof EnergyCard && (!pred || matchesCardPredicate(c, pred))).length;
}

function evalAttr(effect: AttackEffect, ref: any): number {
  const list = () => resolveV2Single(effect, ref.selector);
  switch (ref?.attr) {
    case 'energyAttached': return list().energies.cards.length;
    case 'damageCounters': return list().damage / 10;
    case 'prizeRemaining': return playerOf(effect, ref.who).getPrizeLeft();
    default: throw new Error(`[ir-predicates] unsupported attr "${ref?.attr}"`);
  }
}

// Count Pokémon in play (for `who`) matching a card predicate.
function boardCount(effect: AttackEffect, who: string | undefined, pred: any): number {
  const p = playerOf(effect, who);
  const lists = [p.active, ...p.bench.filter(b => b.getPokemonCard() !== undefined)];
  return lists.filter(l => { const c = l.getPokemonCard(); return c && (!pred || matchesCardPredicate(c, pred)); }).length;
}

// Count cards in a zone (optionally predicate-filtered). bench counts benched Pokémon.
function zoneCardCount(effect: AttackEffect, owner: string | undefined, zone: string, pred: any): number {
  const p = playerOf(effect, owner === 'opponent' ? 'opponent' : undefined);
  const match = (c: any) => !pred || matchesCardPredicate(c, pred);
  switch (zone) {
    case 'hand': return p.hand.cards.filter(match).length;
    case 'deck': return p.deck.cards.filter(match).length;
    case 'discard': return p.discard.cards.filter(match).length;
    case 'bench': return p.bench.filter(b => { const c = b.getPokemonCard(); return c && match(c); }).length;
    default: throw new Error(`[ir-predicates] unsupported zone "${zone}"`);
  }
}

/**
 * @param subject the contextual Pokémon list for selector-less leaves (isa/hpRemaining). Defaults
 * to the opponent's active (the defender) — the implicit subject of an attack's plusIf riders.
 */
export function evalPredicate(state: State, effect: AttackEffect, pred: any, subject?: PokemonCardList): boolean {
  if (!pred || typeof pred !== 'object' || !pred.kind) {
    throw new Error('[ir-predicates] malformed predicate');
  }
  const subj = () => subject ?? effect.opponent.active;
  const listOf = (sel?: V2Selector) => sel ? resolveV2Single(effect, sel) : subj();
  switch (pred.kind) {
    case 'and': return pred.operands.every((p: any) => evalPredicate(state, effect, p, subject));
    case 'or': return pred.operands.some((p: any) => evalPredicate(state, effect, p, subject));
    case 'not': return !evalPredicate(state, effect, pred.operand, subject);

    case 'isa': {
      const card = subj().getPokemonCard();
      return !!card && matchesCardPredicate(card, pred);
    }
    case 'stadiumInPlay':
      return StateUtils.getStadiumCard(state) !== undefined;
    case 'sharedTypeInPlay': {
      // "If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play, +N damage"
      // (Enamorus Love Resonance) — do the two sides' in-play Pokémon type sets intersect? Reads cardType plus
      // additionalCardTypes (dual-type / Tera), exactly like the native card.
      const typesOf = (p: Player): Set<CardType> => {
        const set = new Set<CardType>();
        for (const list of [p.active, ...p.bench]) {
          const c = list.getPokemonCard() as PokemonCard | undefined;
          if (!c) { continue; }
          c.cardType.forEach(t => set.add(t));   // upstream 7a35128f0: cardType is the full type array
        }
        return set;
      };
      const theirs = typesOf(effect.opponent);
      for (const t of typesOf(effect.player)) { if (theirs.has(t)) { return true; } }
      return false;
    }
    case 'damageState': {
      const dmg = listOf(pred.selector).damage;
      if (pred.hasAny !== undefined) return pred.hasAny ? dmg > 0 : dmg === 0;
      if (pred.full !== undefined) return pred.full ? dmg === 0 : dmg > 0;
      // `{cmp, n}`: compare damage COUNTERS (n is in counters, 10 dmg each) — e.g. "a Pokémon with exactly
      // 6 damage counters" (Glaceon ex Euclase). The subject is the contextual candidate (where-filter).
      if (pred.cmp !== undefined && pred.n !== undefined) { return compareOp(pred.cmp, dmg / 10, pred.n); }
      throw new Error('[ir-predicates] damageState needs hasAny/full');
    }
    case 'conditionOn': {
      const cond = CONDITIONS[String(pred.condition).toUpperCase()];
      if (cond === undefined) throw new Error(`[ir-predicates] unknown condition "${pred.condition}"`);
      return listOf(pred.selector).specialConditions.includes(cond);
    }
    case 'hpRemaining': {
      const list = listOf(pred.selector);
      const card = list.getPokemonCard() as PokemonCard | undefined;
      if (!card) return false;
      return compareOp(pred.cmp, card.hp - list.damage, pred.n);
    }
    case 'energyAttachedCount': {
      // Sum across EVERY Pokémon the selector resolves to (e.g. spot:'anywhere' → active + bench),
      // not just the first — "≥N [type] Energy attached to your Pokémon" counts all of them.
      const lists = pred.selector ? resolveV2Selector(effect, pred.selector).map(t => t.list) : [subj()];
      const total = lists.reduce((sum, l) => sum + energyCount(l, pred.predicate), 0);
      return compareOp(pred.cmp, total, pred.n);
    }
    case 'boardCount':
      return compareOp(pred.cmp, boardCount(effect, pred.who, pred.predicate), pred.n);
    case 'prize':
      return compareOp(pred.cmp, playerOf(effect, pred.who).getPrizeLeft(), pred.n);
    case 'handSize':
      return compareOp(pred.cmp, playerOf(effect, pred.who).hand.cards.length, pred.n);
    case 'deckSize':
      return compareOp(pred.cmp, playerOf(effect, pred.who).deck.cards.length, pred.n);
    case 'cardInZone': {
      const n = zoneCardCount(effect, pred.owner, pred.zone, pred.predicate);
      return pred.cmp ? compareOp(pred.cmp, n, pred.n) : n > 0;
    }
    case 'compare':
      return compareOp(pred.op, evalAttr(effect, pred.lhs), evalAttr(effect, pred.rhs));

    case 'turn':
      // "went first/second" / "is your first turn" — a game attribute, read from state.turn (§ helper).
      return turnAspect(state, playerOf(effect, pred.who), pred.aspect);

    case 'movedToActive': {
      // "this Pokémon switched into the Active this turn" — the engine tracks it on
      // player.movedToActiveThisTurn (set on a switch, cleared at turn start); read it directly, the
      // same signal native cards read via IS_POKEMON_MOVED_TO_ACTIVE_THIS_TURN. In the single-turn
      // differential the attacker is placed (not switched), so this is false unless a test switches it.
      return resolveV2Selector(effect, pred.selector).some(({ player, list }) => {
        const card = list.getPokemonCard();
        return !!card && player.movedToActiveThisTurn.includes(card.id);
      });
    }
    case 'hasTool':
      // "this / the Defending Pokémon has a Pokémon Tool attached" — read the engine's per-Pokémon
      // `tools` array (the same list native cards check via `list.tools.length`). Observable on the
      // tools-loaded board variant; a non-vacuity assertion exercises the true branch.
      return listOf(pred.selector).tools.length > 0;
    case 'history': {
      // Only "evolved this turn" is engine-observable: a Pokémon's pokemonPlayedTurn equals the current
      // turn when it was played/evolved this turn — exactly what native evolution-bonus cards check
      // (e.g. Mothim, Accelgor). `fromName` is inert: in a mirror the evolved card's own pre-evo IS the
      // fromName, and native doesn't re-verify it. `attackUsed`/`healed` need cross-turn / heal history
      // the engine doesn't expose, so they throw → counted skip (and "yourLastTurn" can't be exercised
      // in a single-turn differential anyway).
      if (pred.event === 'evolved' && (pred.window === undefined || pred.window === 'thisTurn')) {
        const list = pred.subject ? resolveV2Single(effect, pred.subject) : subj();
        return list.pokemonPlayedTurn === state.turn;
      }
      throw new Error(`[ir-predicates] history event "${pred.event}" (window "${pred.window}") not modeled`);
    }

    default:
      throw new Error(`[ir-predicates] unsupported predicate kind "${pred.kind}"`);
  }
}

/** Used by op `target.where`: keep a resolved target only if the predicate holds with it as subject. */
export function matchesV2Where(state: State, effect: AttackEffect, list: PokemonCardList, where: any): boolean {
  if (!where) return true;
  return evalPredicate(state, effect, where, list);
}
