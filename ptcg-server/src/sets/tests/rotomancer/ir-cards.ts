import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Card } from '../../../game/store/card/card';
import { CardList } from '../../../game/store/state/card-list';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { SuperType, EnergyType, CardType, CardTag, Stage } from '../../../game/store/card/card-types';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

/**
 * Executes the deterministic subset of the IR `cards.move` op (and the card-predicate vocabulary
 * it shares with other selectors). Supports zones hand/deck/discard/lostzone, select modes
 * `None` (top-N) and `auto` (predicate-filtered), and counts exactly/all. Anything that needs a
 * player choice, deck search, or randomness throws — the differential then skips that card rather
 * than risk a choice-alignment false positive.
 */

const ENERGY_TYPE_BY_NAME: Record<string, CardType> = {
  Grass: CardType.GRASS, Fire: CardType.FIRE, Water: CardType.WATER, Lightning: CardType.LIGHTNING,
  Psychic: CardType.PSYCHIC, Fighting: CardType.FIGHTING, Darkness: CardType.DARK, Metal: CardType.METAL,
  Dragon: CardType.DRAGON, Fairy: CardType.FAIRY, Colorless: CardType.COLORLESS,
};

// Matches a card against a Rotomancer IR **v2** card predicate. v2 fuses the printing-intrinsic
// attributes (supertype/subtype/energyType/name) into a single `isa` leaf, and combines with
// kind-tagged and/or/not. A bare object without `kind` is treated as an isa body (the `predicate`
// field of energy.* / cards.move carries the isa attributes directly).
export function matchesCardPredicate(card: Card, pred: any): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case 'and': return pred.operands.every((p: any) => matchesCardPredicate(card, p));
    case 'or': return pred.operands.some((p: any) => matchesCardPredicate(card, p));
    case 'not': return !matchesCardPredicate(card, pred.operand);
    case 'nameTag': {
      // Substring / owner-prefix match on the card's printed name (e.g. "Nidoking",
      // "Team Rocket's Energy"). Both fields, when present, must be contained in the name.
      const name = card.name ?? '';
      if (pred.substring !== undefined && !name.includes(pred.substring)) return false;
      if (pred.owner !== undefined && !name.includes(pred.owner)) return false;
      return true;
    }
    case 'isa':
    case undefined:
      break; // fall through to the intrinsic-attribute checks below
    default:
      throw new Error(`[ir-cards] unsupported card predicate kind "${pred.kind}"`);
  }
  // isa (kind:'isa' or a bare attribute object)
  if (pred.supertype !== undefined) {
    const want = pred.supertype === 'Trainer' ? SuperType.TRAINER
      : pred.supertype === 'Energy' ? SuperType.ENERGY : SuperType.POKEMON;
    if (card.superType !== want) return false;
  }
  if (pred.name !== undefined && card.name !== pred.name) return false;
  if (pred.evolvesFrom !== undefined && (card as PokemonCard).evolvesFrom !== pred.evolvesFrom) return false;
  if (pred.energyType !== undefined) {
    const type = ENERGY_TYPE_BY_NAME[pred.energyType];
    if (!(card instanceof EnergyCard) || type === undefined || !card.provides.includes(type)) return false;
  }
  if (pred.subtype !== undefined) {
    switch (pred.subtype) {
      case 'Basic':
        if (card instanceof EnergyCard) { if (card.energyType !== EnergyType.BASIC) return false; }
        else if ((card as PokemonCard).stage !== Stage.BASIC) return false;
        break;
      case 'Special': if (!(card instanceof EnergyCard) || card.energyType !== EnergyType.SPECIAL) return false; break;
      case 'Stage 1': if ((card as PokemonCard).stage !== Stage.STAGE_1) return false; break;
      case 'Stage 2': if ((card as PokemonCard).stage !== Stage.STAGE_2) return false; break;
      case 'ex': if (!card.tags.includes(CardTag.POKEMON_ex)) return false; break;
      case 'Tera': if (!card.tags.includes(CardTag.POKEMON_TERA)) return false; break;
      default: throw new Error(`[ir-cards] unsupported card subtype "${pred.subtype}"`);
    }
  }
  return true;
}

function resolveZone(effect: AttackEffect, ref: any): CardList {
  const owner = ref?.owner === 'opponent' ? effect.opponent : effect.player;
  switch (ref?.zone) {
    case 'hand': return owner.hand;
    case 'deck': return owner.deck;
    case 'discard': return owner.discard;
    case 'lostzone': return owner.lostzone;
    default: throw new Error(`[ir-cards] unsupported zone "${ref?.zone}"`);
  }
}

export function executeCardsMove(store: StoreLike, state: State, effect: AttackEffect, op: any): State {
  // v2: select.chooser (player/opponent/auto) + select.where (predicate). `auto`/`player` resolve to
  // the first-N matching cards (the harness's first-eligible policy); when the native choice was
  // ambiguous the differential's guard skips the attack, so a wrong guess never false-mismatches.
  // `opponent`/`random` choosers stay unsupported.
  const chooser = op.select?.chooser;
  if (chooser !== undefined && chooser !== 'auto' && chooser !== 'player') {
    throw new Error(`[ir-cards] unsupported cards.move chooser "${chooser}"`);
  }
  if (op.visibility === 'search' || op.count?.searchTyped) {
    throw new Error('[ir-cards] cards.move deck search not supported');
  }

  const from = resolveZone(effect, op.from);
  const to = resolveZone(effect, op.to);

  const countKind = op.count?.kind;
  let candidates: Card[] = from.cards.slice();
  if (chooser === 'auto' || chooser === 'player') {
    candidates = candidates.filter(c => matchesCardPredicate(c, op.select.where));
  }

  let cards: Card[];
  if (countKind === 'all') {
    cards = candidates;
  } else if (countKind === 'exactly') {
    cards = candidates.slice(0, op.count.n);
  } else if (countKind === 'upTo') {
    cards = candidates.slice(0, op.count.max);
  } else {
    throw new Error(`[ir-cards] unsupported cards.move count "${countKind}"`);
  }

  if (cards.length === 0) {
    return state;
  }
  return MOVE_CARDS(store, state, from, to, { cards });
}
