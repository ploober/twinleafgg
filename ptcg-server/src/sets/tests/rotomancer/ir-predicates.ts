import { State } from '../../../game/store/state/state';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Player } from '../../../game/store/state/player';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { SpecialCondition } from '../../../game/store/card/card-types';
import { StateUtils } from '../../../game/store/state-utils';
import { resolveV2Single, resolveV2Selector, V2Selector } from './ir-selectors';
import { matchesCardPredicate } from './ir-cards';

/**
 * Evaluates a Rotomancer IR **v2** predicate against live Twinleaf state. v2 predicates are a
 * single-discriminator sum type ({ kind, … }) instead of the v1 god-record. Supports the
 * deterministic leaves that appear in attack conditionals: and/or/not, isa (intrinsic, on a
 * contextual subject), damageState, conditionOn, stadiumInPlay, energyAttachedCount, boardCount,
 * hpRemaining, prize, handSize, deckSize, cardInZone, and compare. Non-deterministic / history
 * leaves (turn, history, movedToActive, hasTool, nameTag, resistanceType, …) throw, so the
 * differential simply skips that card rather than guessing.
 */

const CONDITIONS: Record<string, SpecialCondition> = {
  POISONED: SpecialCondition.POISONED, BURNED: SpecialCondition.BURNED, ASLEEP: SpecialCondition.ASLEEP,
  PARALYZED: SpecialCondition.PARALYZED, CONFUSED: SpecialCondition.CONFUSED,
};

function playerOf(effect: AttackEffect, who?: string): Player {
  return who === 'opponent' ? effect.opponent : effect.player;
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
    case 'damageState': {
      const dmg = listOf(pred.selector).damage;
      if (pred.hasAny !== undefined) return pred.hasAny ? dmg > 0 : dmg === 0;
      if (pred.full !== undefined) return pred.full ? dmg === 0 : dmg > 0;
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

    default:
      throw new Error(`[ir-predicates] unsupported predicate kind "${pred.kind}"`);
  }
}

/** Used by op `target.where`: keep a resolved target only if the predicate holds with it as subject. */
export function matchesV2Where(state: State, effect: AttackEffect, list: PokemonCardList, where: any): boolean {
  if (!where) return true;
  return evalPredicate(state, effect, where, list);
}
