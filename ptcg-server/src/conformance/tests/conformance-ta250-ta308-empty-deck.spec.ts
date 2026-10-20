import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Two empty-deck families, re-measured on twinleaf f3fc8f4c5 against rotomancer before the fix. Printed text is
 * quoted from card-data/final/<set>.json.
 *
 * TA-250 (B.33: the shuffle's OBJECT decides; "shuffle your deck" names an object that survives an empty deck, so the
 * shuffle is owed whatever the search did; a missing DESTINATION — no Bench room — runs first and owes nothing, B.33
 * addendum). The 30 attack printings named in the finding all shuffle now (re-driven, 30/30 converged); these are the
 * members the attack-text census never saw (printings that joined the pool since, or Trainer/Ability/Tool/Energy text):
 *   pal-124 Glimmet "Ascension", pbl-037 Lampent "Spreading Light", mep-107 Pikachu ex "Pika-Pika Parade",
 *   mew-133 Eevee "Colorful Friends" (threw on an empty deck), obf-188 Geeta, ssp-162 Amulet of Hope,
 *   par-076 Cofagrigus ex "Gold Coffin", por-088 Telepathic Psychic Energy.
 *   Pikachu ex also shuffled on a FULL Bench (stocked deck), which B.33's addendum calls a no-destination: no shuffle.
 *
 * TA-308 (B.41 + its 2026-08-31 / 2026-09-01 addenda): a recycle Trainer whose whole effect provably returns every
 * card (every deck the cards go into is empty and every draw takes back exactly what went in) is withheld. Lacey,
 * Lillie's Determination, Drasna and Kofu were fixed under TA-349 / TA-380; still offered were Judge (por-076,
 * svi-176, paf-228), Meddling Memo ssp-181, and — found by the family census — Youngster svi-198 and Harlequin wht-083.
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const WATER = 'sve-003';
const PSYCHIC = 'sve-005';
const FIGHT = 'sve-006';
const BELLSPROUT = 'asc-004'; // Basic Grass, 60 HP
const SALANDIT = 'asc-020';   // Basic Fire, Fire Claws [R] 30 (80 HP)

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = [], damage = 0, tools: string[] = []): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: tools.map((t, i) => ({ iid: `${iid}t${i}`, printing: t })), damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string, n = 6): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
interface Side { active: PokemonInPlay; bench?: PokemonInPlay[]; hand?: string[]; deck?: number; deckOf?: string[]; prizes?: number }
/** `deck` is the deck SIZE (filler Water), kept at 0 when asked: deck emptiness is the thing under test. */
function board(A: Side, B: Side, actor: 'A' | 'B' = 'A'): NeutralState {
  const ps = (tag: string, s: Side): PlayerState => ({ active: s.active, bench: s.bench ?? [], hand: cards(`${tag}h`, s.hand ?? []),
    deck: cards(`${tag}d`, s.deckOf ?? Array(s.deck ?? 8).fill(WATER)), discard: [], lostZone: [], prizes: prizes(tag, s.prizes ?? 6),
    flags: flags() });
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: actor, firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: ps('a', A), B: ps('b', B) } };
}
type Act = { type: string; actor?: string; card?: string; target?: string };
const acts = (r: ReturnType<typeof step>): Act[] => (r.pending?.legalActions ?? []) as unknown as Act[];
/** The shuffle happened or is pending (CF-11 / B.62: an empty-deck shuffle still emits). */
const shuffles = (r: ReturnType<typeof step>): boolean =>
  (r.events ?? []).some(e => (e as { kind: string }).kind === 'shuffled') || acts(r).some(a => a.type === 'shuffle');
const attack = (actor: string, source: string, name: string) => ({ actor, type: 'declareAttack', source, name });
/**
 * The KO-triggered cells resolve over several decisions (the Prize taken, the promotion, a system shuffle): answer each
 * with its first offer until the board is back at a turn menu or the search itself is pending. Events are the full
 * replay trace, so the last response carries every event of the walk.
 */
function walk(s: NeutralState, first: unknown[]): ReturnType<typeof step> {
  const sequence: unknown[] = [...first];
  let r = step(s, sequence as never);
  for (let i = 0; i < 8 && r.status === 'awaitingAction'; i++) {
    const a = acts(r)[0] as Act & { deck?: string[] };
    if (!a || !['takePrize', 'promoteBench', 'shuffle'].includes(a.type)) { break; }
    sequence.push(a.type === 'shuffle' ? { actor: 'system', type: 'shuffle', order: a.deck ?? [] } : a);
    r = step(s, sequence as never);
  }
  return r;
}
const benchOf = (n: number, tag = 'ab') => Array.from({ length: n }, (_, i) => mon(`${tag}${i}`, [BELLSPROUT]));
const B_WALL = { active: mon('b1', ['svi-061']), bench: [mon('b2', [BELLSPROUT])] }; // Dondozo 160 HP

// ---------------------------------------------------------------- TA-250 attacks
describe('TA-250 the owed "Then, shuffle your deck" on an empty deck — attacks outside the original census', () => {
  it('Glimmet Ascension with an empty deck still shuffles [TA-250 pal-124]', () => {
    const r = step(board({ active: mon('a1', ['pal-124'], [FIGHT]), bench: benchOf(1), deck: 0 }, B_WALL), [attack('A', 'a1', 'Ascension')] as never);
    expect(r.status).not.toBe('invalidAction');
    expect(shuffles(r)).toBe(true);
  });
  it('Lampent Spreading Light with an empty deck and Bench room still shuffles [TA-250 pbl-037]', () => {
    const r = step(board({ active: mon('a1', ['pbl-037'], [PSYCHIC]), bench: benchOf(1), deck: 0 }, B_WALL), [attack('A', 'a1', 'Spreading Light')] as never);
    expect(shuffles(r)).toBe(true);
  });
  it('control: Lampent with a FULL Bench and an empty deck has no destination, so no shuffle [TA-250 pbl-037]', () => {
    const r = step(board({ active: mon('a1', ['pbl-037'], [PSYCHIC]), bench: benchOf(5), deck: 0 }, B_WALL), [attack('A', 'a1', 'Spreading Light')] as never);
    expect(shuffles(r)).toBe(false);
  });
  it('Pikachu ex Pika-Pika Parade with an empty deck and Bench room still shuffles [TA-250 mep-107]', () => {
    const r = step(board({ active: mon('a1', ['mep-107'], [GRASS]), bench: benchOf(1), deck: 0 }, B_WALL), [attack('A', 'a1', 'Pika-Pika Parade')] as never);
    expect(shuffles(r)).toBe(true);
  });
  it('Pikachu ex Pika-Pika Parade with a FULL Bench (stocked deck) has no destination: no search, no shuffle [TA-250 mep-107]', () => {
    const r = step(board({ active: mon('a1', ['mep-107'], [GRASS]), bench: benchOf(5), deckOf: [BELLSPROUT, BELLSPROUT, WATER] }, B_WALL),
      [attack('A', 'a1', 'Pika-Pika Parade')] as never);
    expect(shuffles(r)).toBe(false);
  });
  it('Eevee Colorful Friends with an empty deck is used and still shuffles [TA-250 mew-133]', () => {
    const r = step(board({ active: mon('a1', ['mew-133'], [GRASS]), bench: benchOf(1), deck: 0 }, B_WALL), [attack('A', 'a1', 'Colorful Friends')] as never);
    expect(r.status).not.toBe('invalidAction');
    expect(shuffles(r)).toBe(true);
  });
  it('control: Eevee Colorful Friends over a stocked deck offers the search [TA-250 mew-133]', () => {
    const r = step(board({ active: mon('a1', ['mew-133'], [GRASS]), bench: benchOf(1), deckOf: [BELLSPROUT, WATER] }, B_WALL),
      [attack('A', 'a1', 'Colorful Friends')] as never);
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('A');
  });
});

// ---------------------------------------------------------------- TA-250 Trainer / Tool / Ability / Energy
describe('TA-250 the owed shuffle on an empty deck — Trainer, Tool, Ability and Energy text', () => {
  // B.47 (2026-10-20, RE-259 / TA-725): Geeta's attack lock is a drawback, so at deck 0 (its search and attach provably
  // empty) the card is not playable at all; the owed-shuffle question this cell asked does not arise for Geeta.
  it('Geeta with an empty deck is not playable (B.47), so no shuffle is owed [TA-250 obf-188]', () => {
    const r = step(board({ active: mon('a1', [BELLSPROUT], [GRASS]), bench: benchOf(1), hand: ['obf-188'], deck: 0 }, B_WALL),
      [{ actor: 'A', type: 'playSupporter', card: 'ah0' }] as never);
    expect(r.status).toBe('invalidAction');
    expect(r.state.players.A.hand.map(c => c.iid)).toContain('ah0');
  });
  it('Amulet of Hope: its Pokémon is Knocked Out with an empty deck, the deck is still shuffled [TA-250 ssp-162]', () => {
    // "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon,
    // search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck."
    const r = walk(board({ active: mon('a1', [BELLSPROUT], [], 40, ['ssp-162']), bench: benchOf(1), deck: 0 },
      { active: mon('b1', [SALANDIT], [FIRE, FIRE]), bench: [mon('b2', [BELLSPROUT])] }, 'B'),
      [attack('B', 'b1', 'Fire Claws')]);
    expect(shuffles(r)).toBe(true);
  });
  it('control: Amulet of Hope over a stocked deck still opens its search [TA-250 ssp-162]', () => {
    const r = walk(board({ active: mon('a1', [BELLSPROUT], [], 40, ['ssp-162']), bench: benchOf(1), deck: 3 },
      { active: mon('b1', [SALANDIT], [FIRE, FIRE]), bench: [mon('b2', [BELLSPROUT])] }, 'B'),
      [attack('B', 'b1', 'Fire Claws')]);
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('A');
    expect(acts(r).some(a => a.type === 'shuffle')).toBe(false);
  });
  it('Cofagrigus ex Gold Coffin: Knocked Out with an empty deck, the deck is still shuffled [TA-250 par-076]', () => {
    // "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, search your deck for a
    // card and put it into your hand. Then, shuffle your deck."
    const r = walk(board({ active: mon('a1', ['par-076'], [], 250), bench: benchOf(1), deck: 0 },
      { active: mon('b1', [SALANDIT], [FIRE, FIRE]), bench: [mon('b2', [BELLSPROUT])] }, 'B'),
      [attack('B', 'b1', 'Fire Claws')]);
    expect(shuffles(r)).toBe(true);
  });
  it('Telepathic Psychic Energy attached with an empty deck and Bench room still shuffles [TA-250 por-088]', () => {
    // "When you attach this card from your hand to a [P] Pokémon, search your deck for up to 2 Basic [P] Pokémon and put
    // them onto your Bench. Then, shuffle your deck." #2322: a full Bench skips both; a Bench with room "must search and
    // shuffle". An empty deck is not a missing destination (B.33).
    const r = step(board({ active: mon('a1', ['asc-085']), bench: benchOf(1), hand: ['por-088'], deck: 0 }, B_WALL),
      [{ actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a1' }] as never);
    expect(shuffles(r)).toBe(true);
  });
  it('control: Telepathic Psychic Energy with a FULL Bench and an empty deck neither searches nor shuffles (#2322) [TA-250 por-088]', () => {
    const r = step(board({ active: mon('a1', ['asc-085']), bench: benchOf(5), hand: ['por-088'], deck: 0 }, B_WALL),
      [{ actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a1' }] as never);
    expect(shuffles(r)).toBe(false);
  });
});

// ---------------------------------------------------------------- TA-308
describe('TA-308 a recycle Trainer is withheld when it provably returns every card (B.41)', () => {
  const offered = (card: string, A: { hand: number; deck: number }, B: { hand: number; deck: number }, actor: 'A' = 'A') => {
    const r = step(board(
      { active: mon('a1', [BELLSPROUT]), hand: [card, ...Array(A.hand).fill(WATER)], deck: A.deck },
      { active: mon('b1', [BELLSPROUT]), hand: Array(B.hand).fill(WATER), deck: B.deck }, actor), []);
    return acts(r).some(a => a.card === 'ah0');
  };
  it('Judge: both decks empty, 4 and 4 other cards in hand: withheld [TA-308 por-076]', () => {
    expect(offered('por-076', { hand: 4, deck: 0 }, { hand: 4, deck: 0 })).toBe(false);
  });
  it('Judge reprints svi-176 and paf-228 carry the same gate [TA-308 svi-176]', () => {
    expect(offered('svi-176', { hand: 4, deck: 0 }, { hand: 4, deck: 0 })).toBe(false);
    expect(offered('paf-228', { hand: 2, deck: 0 }, { hand: 0, deck: 0 })).toBe(false);
  });
  it('Judge played anyway on the provable round trip is refused [TA-308 por-076]', () => {
    const r = step(board({ active: mon('a1', [BELLSPROUT]), hand: ['por-076', WATER, WATER], deck: 0 },
      { active: mon('b1', [BELLSPROUT]), hand: [WATER], deck: 0 }), [{ actor: 'A', type: 'playSupporter', card: 'ah0' }] as never);
    expect(r.status).toBe('invalidAction');
  });
  it('control: Judge is offered when one card would stay in a deck or a deck is stocked [TA-308 por-076]', () => {
    expect(offered('por-076', { hand: 4, deck: 0 }, { hand: 5, deck: 0 })).toBe(true);  // opponent's 5th stays
    expect(offered('por-076', { hand: 5, deck: 0 }, { hand: 4, deck: 0 })).toBe(true);  // my 5th stays
    expect(offered('por-076', { hand: 4, deck: 0 }, { hand: 4, deck: 3 })).toBe(true);  // the opponent draws new cards
    expect(offered('por-076', { hand: 4, deck: 1 }, { hand: 4, deck: 0 })).toBe(true);  // I draw a new card
  });
  it('Meddling Memo: the opponent\'s deck is empty, so their hand goes under it and comes straight back: withheld [TA-308 ssp-181]', () => {
    // "Your opponent counts the cards in their hand, shuffles those cards, and puts them on the bottom of their deck. If
    // they do, they draw that many cards."
    expect(offered('ssp-181', { hand: 2, deck: 3 }, { hand: 3, deck: 0 })).toBe(false);
    expect(offered('ssp-181', { hand: 0, deck: 0 }, { hand: 6, deck: 0 })).toBe(false);
  });
  it('control: Meddling Memo is offered when the opponent\'s deck holds a card [TA-308 ssp-181]', () => {
    expect(offered('ssp-181', { hand: 2, deck: 3 }, { hand: 3, deck: 1 })).toBe(true);
  });
  it('Youngster: own deck empty and 5 or fewer other cards: withheld; 6 leaves one behind: offered [TA-308 svi-198]', () => {
    // "Shuffle your hand into your deck. Then, draw 5 cards."
    expect(offered('svi-198', { hand: 5, deck: 0 }, { hand: 0, deck: 3 })).toBe(false);
    expect(offered('svi-198', { hand: 0, deck: 0 }, { hand: 0, deck: 3 })).toBe(false);
    expect(offered('svi-198', { hand: 6, deck: 0 }, { hand: 0, deck: 3 })).toBe(true);
    expect(offered('svi-198', { hand: 5, deck: 1 }, { hand: 0, deck: 3 })).toBe(true);
  });
  it('Harlequin: both decks empty and both hands within the smaller draw (3): withheld [TA-308 wht-083]', () => {
    // "Each player shuffles their hand into their deck. Then, flip a coin. If heads, you draw 5 cards, and your opponent
    // draws 3 cards. If tails, you draw 3 cards, and your opponent draws 5 cards." Withheld only when BOTH arms return
    // every card (Drasna's rule, TA-349).
    expect(offered('wht-083', { hand: 3, deck: 0 }, { hand: 3, deck: 0 })).toBe(false);
  });
  it('control: Harlequin is offered when a 4th card makes the flip decide, or a deck is stocked [TA-308 wht-083]', () => {
    expect(offered('wht-083', { hand: 4, deck: 0 }, { hand: 3, deck: 0 })).toBe(true);
    expect(offered('wht-083', { hand: 3, deck: 0 }, { hand: 4, deck: 0 })).toBe(true);
    expect(offered('wht-083', { hand: 2, deck: 0 }, { hand: 2, deck: 3 })).toBe(true);
  });
});
