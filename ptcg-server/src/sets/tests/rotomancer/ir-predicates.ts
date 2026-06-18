import { State } from '../../../game/store/state/state';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Player } from '../../../game/store/state/player';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardTag, Stage } from '../../../game/store/card/card-types';
import { StateUtils } from '../../../game/store/state-utils';

/**
 * Evaluates a Rotomancer IR predicate against live Twinleaf state. Supports the deterministic
 * leaves that appear in sv-era conditional attacks: and/or/not, compare (energyAttached /
 * prizeRemaining / damageCounters), subtype (ex + stage), stadiumInPlay, and damageState.full.
 * Non-deterministic or unimplemented leaves (history, energyAttachedCount, …) throw, so the
 * differential simply skips that card rather than guessing.
 */

type Sel = { selector?: string } | undefined;

function selectorPlayer(effect: AttackEffect, who?: string): Player {
  return who === 'opponent' ? effect.opponent : effect.player;
}

function singleList(effect: AttackEffect, sel: Sel): PokemonCardList {
  switch (sel?.selector) {
    case undefined:
    case 'self':
    case 'ownActive': return effect.player.active;
    case 'opponentActive':
    case 'defendingPokemon': return effect.opponent.active;
    default: throw new Error(`[ir-predicates] unsupported selector "${sel?.selector}"`);
  }
}

function multiLists(effect: AttackEffect, sel: Sel): PokemonCardList[] {
  switch (sel?.selector) {
    case 'eachOwnBench':
    case 'ownBench': return effect.player.bench.filter(b => b.getPokemonCard() !== undefined);
    case 'eachOpponentBench':
    case 'opponentBench': return effect.opponent.bench.filter(b => b.getPokemonCard() !== undefined);
    default: return [singleList(effect, sel)];
  }
}

function evalAttr(effect: AttackEffect, ref: any): number {
  switch (ref?.attr) {
    case 'energyAttached': return singleList(effect, ref.selector).energies.cards.length;
    case 'damageCounters': return singleList(effect, ref.selector).damage / 10;
    case 'prizeRemaining': return selectorPlayer(effect, ref.who ?? ref.selector?.selector).getPrizeLeft();
    default: throw new Error(`[ir-predicates] unsupported attr "${ref?.attr}"`);
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

function cardHasSubtype(card: PokemonCard | undefined, subtype: string): boolean {
  if (!card) return false;
  switch (subtype) {
    case 'ex': return card.tags.includes(CardTag.POKEMON_ex);
    case 'Basic': return card.stage === Stage.BASIC;
    case 'Stage 1': return card.stage === Stage.STAGE_1;
    case 'Stage 2': return card.stage === Stage.STAGE_2;
    default: throw new Error(`[ir-predicates] unsupported subtype "${subtype}"`);
  }
}

export function evalPredicate(state: State, effect: AttackEffect, pred: any): boolean {
  if (!pred || typeof pred !== 'object') {
    throw new Error('[ir-predicates] malformed predicate');
  }
  if (Array.isArray(pred.and)) return pred.and.every((p: any) => evalPredicate(state, effect, p));
  if (Array.isArray(pred.or)) return pred.or.some((p: any) => evalPredicate(state, effect, p));
  if (pred.not !== undefined) return !evalPredicate(state, effect, pred.not);

  if (pred.compare) {
    const c = pred.compare;
    return compareOp(c.op, evalAttr(effect, c.lhs), evalAttr(effect, c.rhs));
  }
  if (pred.subtype !== undefined) {
    const list = singleList(effect, pred.selector ?? { selector: 'opponentActive' });
    return cardHasSubtype(list.getPokemonCard(), pred.subtype);
  }
  if (pred.stadiumInPlay !== undefined) {
    const has = StateUtils.getStadiumCard(state) !== undefined;
    return pred.stadiumInPlay ? has : !has;
  }
  if (pred.damageState) {
    const ds = pred.damageState;
    const lists = multiLists(effect, ds.selector);
    const allFull = lists.every(l => l.damage === 0);
    return ds.full ? allFull : !allFull;
  }
  throw new Error(`[ir-predicates] unsupported predicate "${Object.keys(pred).join(',')}"`);
}
