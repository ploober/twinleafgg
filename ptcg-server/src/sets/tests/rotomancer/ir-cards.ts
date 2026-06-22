import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Card } from '../../../game/store/card/card';
import { CardList } from '../../../game/store/state/card-list';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { SuperType, EnergyType, CardType, CardTag, Stage } from '../../../game/store/card/card-types';
import { MOVE_CARDS, TAKE_X_PRIZES } from '../../../game/store/prefabs/prefabs';
import { ChoosePokemonPrompt } from '../../../game/store/prompts/choose-pokemon-prompt';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { PlayerType, SlotType } from '../../../game/store/actions/play-card-action';
import { GameMessage } from '../../../game/game-message';
import { resolveV2Selector } from './ir-selectors';

/**
 * Executes the deterministic subset of the IR `cards.move` op (and the card-predicate vocabulary
 * it shares with other selectors). Supports zones hand/deck/discard/lostzone, the bench→active
 * switch, attached → hand/discard (move a card off a Pokémon via PokemonCardList.moveCardsTo), and
 * prize → hand (the native TAKE_X_PRIZES prefab); select modes `None` (top-N), `auto`
 * (predicate-filtered), and `player` (a ChooseCardsPrompt); counts exactly/all/upTo. Anything that
 * needs a deck search or randomness throws — the differential then skips that card rather than risk a
 * choice-alignment false positive.
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
    // `energyType` denotes an Energy card's provided type, but for a Pokémon it denotes the
    // Pokémon's own type (cardType) — e.g. "Basic non-[C] Pokémon" → cardType !== COLORLESS.
    const type = ENERGY_TYPE_BY_NAME[pred.energyType];
    if (type === undefined) return false;
    if (card instanceof EnergyCard) {
      if (!card.provides.includes(type)) return false;
    } else if (card instanceof PokemonCard) {
      if (card.cardType !== type) return false;
    } else {
      return false; // Trainers have no type
    }
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

// A bench→active "move" of the same owner is a Pokémon SWITCH (promote / gust-up), not a card-zone
// move — the engine does it with player.switchPokemon, exactly like native switch attacks (e.g.
// Honchkrow). `chooser:'player'` → emit the same ChoosePokemonPrompt over the Bench native does, so
// the harness picks the identical first-eligible benched Pokémon on both runs. No legal target → no-op.
function executeSwitch(store: StoreLike, state: State, effect: AttackEffect, op: any, cont: (state: State) => State): State {
  const owner = op.from?.owner === 'opponent' ? effect.opponent : effect.player;
  const ownerType = op.from?.owner === 'opponent' ? PlayerType.TOP_PLAYER : PlayerType.BOTTOM_PLAYER;
  if (!owner.bench.some(b => b.getPokemonCard() !== undefined)) {
    return cont(state); // nothing on the Bench to switch in — snapshot-neutral, as native guards
  }
  const prompt = new ChoosePokemonPrompt(
    effect.player.id, GameMessage.CHOOSE_POKEMON_TO_SWITCH, ownerType, [SlotType.BENCH],
    { min: 1, max: 1, allowCancel: false }
  );
  return store.prompt(state, prompt, (chosen: PokemonCardList[] | null) => {
    const target = chosen && chosen[0];
    if (target) { owner.switchPokemon(target); }
    return cont(state);
  });
}

export function executeCardsMove(store: StoreLike, state: State, effect: AttackEffect, op: any, cont: (state: State) => State): State {
  // v2: select.chooser (player/opponent/auto) + select.where (predicate).
  const chooser = op.select?.chooser;
  if (chooser !== undefined && chooser !== 'auto' && chooser !== 'player') {
    throw new Error(`[ir-cards] unsupported cards.move chooser "${chooser}"`);
  }
  if (op.visibility === 'search' || op.count?.searchTyped) {
    throw new Error('[ir-cards] cards.move deck search not supported');
  }

  // bench → active (same owner) = a switch, handled via switchPokemon + a Bench ChoosePokemonPrompt.
  if (op.from?.zone === 'bench' && op.to?.zone === 'active' && op.from?.owner === op.to?.owner) {
    return executeSwitch(store, state, effect, op, cont);
  }
  // attached → hand/discard (move a card OFF a Pokémon) and prize → hand ("take a Prize card") need
  // Pokémon-/pile-aware handling, not the flat-CardList resolveZone path.
  if (op.from?.zone === 'attached') {
    return executeAttachedMove(store, state, effect, op, cont);
  }
  if (op.from?.zone === 'prize') {
    return executePrizeMove(store, state, effect, op, cont);
  }

  const from = resolveZone(effect, op.from);   // throws on bench/active → counted skip
  const to = resolveZone(effect, op.to);

  // `chooser:'player'` → emit the same ChooseCardsPrompt native does (predicate → `blocked`, so the
  // now-filter-aware harness picks the identical first-N matching cards), aligning the ambiguity guard.
  if (chooser === 'player') {
    return executeCardsMoveChoice(store, state, effect, op, from, to, cont);
  }

  // `auto` / absent: deterministic first-N (no choice, no prompt).
  const countKind = op.count?.kind;
  let candidates: Card[] = from.cards.slice();
  if (chooser === 'auto') {
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
    return cont(state);
  }
  return cont(MOVE_CARDS(store, state, from, to, { cards }));
}

// Map an IR count quantifier to ChooseCardsPrompt min/max (the eligible set is the predicate-matching
// cards; non-matching are `blocked`). `exactly` clamps min to what's available so a short zone doesn't
// throw on the interp side — native's strict min then skips that scenario, never false-matches.
function countToMinMax(count: any, eligible: number): { min: number; max: number } {
  switch (count?.kind) {
    case 'exactly': return { min: Math.min(count.n ?? 0, eligible), max: count.n ?? 0 };
    case 'upTo': return { min: 0, max: count.max ?? 0 };
    case 'all': return { min: eligible, max: eligible };
    default: throw new Error(`[ir-cards] unsupported cards.move count "${count?.kind}"`);
  }
}

function executeCardsMoveChoice(
  store: StoreLike, state: State, effect: AttackEffect, op: any,
  from: CardList, to: CardList, cont: (state: State) => State
): State {
  const where = op.select?.where;
  const blocked: number[] = [];
  from.cards.forEach((c, i) => { if (!matchesCardPredicate(c, where)) { blocked.push(i); } });
  const eligible = from.cards.length - blocked.length;
  if (eligible === 0) { return cont(state); } // nothing matches → snapshot-neutral no-op
  const { min, max } = countToMinMax(op.count, eligible);
  const prompt = new ChooseCardsPrompt(
    effect.player, GameMessage.CHOOSE_CARD_TO_HAND, from, {}, { min, max, allowCancel: false, blocked }
  );
  return store.prompt(state, prompt, (selected: Card[] | null) => {
    const cards = selected ?? [];
    return cont(cards.length ? MOVE_CARDS(store, state, from, to, { cards }) : state);
  });
}

// "Take a Prize card" (prize → hand). player.prizes is a CardList[] (face-down piles), not a single
// CardList, so this can't go through MOVE_CARDS — reproduce native exactly with the engine prefab
// TAKE_X_PRIZES (the same ChoosePrizePrompt the harness auto-resolves first-eligible, with no
// divergence-guard bump), so native and interp take the identical count to hand. The corpus shape is
// prize → hand, count exactly; anything else is a counted skip.
function executePrizeMove(store: StoreLike, state: State, effect: AttackEffect, op: any, cont: (state: State) => State): State {
  if (op.to?.zone !== 'hand') {
    throw new Error(`[ir-cards] cards.move prize → ${op.to?.zone} not supported`);
  }
  if (op.count?.kind !== 'exactly') {
    throw new Error(`[ir-cards] cards.move prize count "${op.count?.kind}" not supported`);
  }
  const player = op.from?.owner === 'opponent' ? effect.opponent : effect.player;
  return cont(TAKE_X_PRIZES(store, state, player, op.count.n ?? 0));
}

// cards.move from a Pokémon's attached cards (Energy / Tool) to hand/discard. The `from` carries a
// selector (op.from.of) naming the source Pokémon, like energy.discard — resolve it, then move the
// attached cards matching `select.where`. The move MUST go through PokemonCardList.moveCardsTo (which
// keeps the `.energies`/`.tools` sub-lists the snapshot reads in sync), never MOVE_CARDS. `chooser:
// 'player'` emits the same ChooseCardsPrompt native does (the filter-aware harness picks the identical
// first-N matching); `auto`/absent moves the first-N deterministically. (Tool predicates throw in
// matchesCardPredicate → counted skip; multi-Pokémon sources aren't in the corpus → first source.)
function executeAttachedMove(store: StoreLike, state: State, effect: AttackEffect, op: any, cont: (state: State) => State): State {
  const to = resolveZone(effect, op.to);   // hand / discard, owner-aware
  const where = op.select?.where;
  const sources = resolveV2Selector(effect, op.from?.of).filter(t => t.list.getPokemonCard() !== undefined);
  if (sources.length === 0) { return cont(state); }   // no source Pokémon → snapshot-neutral no-op
  const source = sources[0].list;
  const eligibleIdx: number[] = [];
  source.cards.forEach((c, i) => { if (matchesCardPredicate(c, where)) { eligibleIdx.push(i); } });
  if (eligibleIdx.length === 0) { return cont(state); } // nothing attached matches → no-op (as native guards)

  if (op.select?.chooser === 'player') {
    const blocked: number[] = [];
    source.cards.forEach((_, i) => { if (eligibleIdx.indexOf(i) === -1) { blocked.push(i); } });
    const { min, max } = countToMinMax(op.count, eligibleIdx.length);
    const prompt = new ChooseCardsPrompt(
      effect.player, GameMessage.CHOOSE_CARD_TO_HAND, source, {}, { min, max, allowCancel: false, blocked }
    );
    return store.prompt(state, prompt, (selected: Card[] | null) => {
      const cards = selected ?? [];
      if (cards.length) { source.moveCardsTo(cards, to); }
      return cont(state);
    });
  }

  // auto / absent: deterministic first-N of the matching attached cards.
  const eligible = eligibleIdx.map(i => source.cards[i]);
  const countKind = op.count?.kind;
  let cards: Card[];
  if (countKind === 'all') { cards = eligible; }
  else if (countKind === 'exactly') { cards = eligible.slice(0, op.count.n ?? 0); }
  else if (countKind === 'upTo') { cards = eligible.slice(0, op.count.max ?? 0); }
  else { throw new Error(`[ir-cards] unsupported cards.move count "${countKind}"`); }
  if (cards.length) { source.moveCardsTo(cards, to); }
  return cont(state);
}
