import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Class-D card findings (2026-09-30 batch, worktree cdg8), each re-driven on twinleaf ec9f093d5 before the fix.
 * Printed text is quoted from card-data/final/<set>.json.
 *
 *   TA-504 Team Rocket's Spidops asc-019 Charging Up: "Once during your turn, you may attach a Basic Energy card from
 *     your discard pile to this Pokémon." Built as ChooseCardsPrompt(CHOOSE_CARD_TO_ATTACH) + MOVE_CARDS, so the
 *     adapter surfaced a bare choose{energy} instead of the CF-5 attachEnergy{card,target} pair.
 *   TA-505 Gloom mew-044 Semi-Blooming Energy / Vileplume mew-045 Fully Blooming Energy: "When you play this Pokémon
 *     from your hand to evolve 1 of your Pokémon during your turn, you may look at the top 3 [8] cards of your deck and
 *     attach any number of Basic Energy cards you find there ... Shuffle the other cards back into your deck." The
 *     look ran with no opt-in; the only decline (attach none) still looked and owed a shuffle.
 *   TA-506 Minior par-099 Far-Flying Meteor: "Once during your turn, if this Pokémon is on your Bench, when you attach
 *     an Energy card from your hand to this Pokémon, you may switch it with your Active Pokémon." Offered on an attach
 *     to an Active Minior. (The from-hand condition is TA-575, fixed in another worktree.)
 *   TA-507 Floragato pal-014: Seed Bomb 30 (no text); Magic Whip 50 "Switch out your opponent's Active Pokémon to the
 *     Bench." The switch was keyed on attack index 0 (Seed Bomb).
 *   TA-508 Bellibolt ex pal-079 Jumping Press: "This attack does 50 damage to 1 of your opponent's Pokémon. (Don't apply
 *     Weakness and Resistance for Benched Pokémon.)" Coded with the Benched-only prefab.
 *   TA-509 Pelipper pal-159 Hearsay: "When you play this Pokémon from your hand to evolve ..., you may choose 1: put a
 *     Supporter card from your discard pile into your hand; or search your deck for a Supporter card, reveal it, put it
 *     into your hand, and then shuffle your deck." No decline, and the discard mode was offered on a discard with no
 *     Supporter, then refused.
 *   TA-510 Gengar mew-094: Poltergeist "50x ... 50 damage for each Trainer card you find there"; Hollow Dive 110 "Put 3
 *     damage counters on your opponent's Benched Pokémon in any way you like." The two attack indices were swapped.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const PSYCHIC = 'sve-005';
const FIGHTING = 'sve-006';
const BELLSPROUT = 'asc-004'; // Basic, 70 HP
const BIG = 'mew-003'; // Venusaur ex, 340 HP, weak to Fire: a defender that survives
const ARVEN = 'svi-166'; // Supporter
const IONO = 'pal-185'; // Supporter
const NEST_BALL = 'svi-181'; // Item

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = [], damage = 0): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: [], damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
interface Opts { hand?: string[]; deck?: string[]; discard?: string[]; bActive?: PokemonInPlay; bBench?: PokemonInPlay[]; bHand?: string[] }
function board(active: PokemonInPlay, bench: PokemonInPlay[], opts: Opts = {}): NeutralState {
  const A: PlayerState = { active, bench, hand: cards('ah', opts.hand ?? []), deck: cards('ad', opts.deck ?? Array(8).fill(GRASS)),
    discard: cards('ax', opts.discard ?? []), lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: opts.bActive ?? mon('b1', [BELLSPROUT]), bench: opts.bBench ?? [], hand: cards('bh', opts.bHand ?? []),
    deck: cards('bd', Array(8).fill(GRASS)), discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
type Act = { type: string; actor?: string; [k: string]: unknown };
function menu(s: NeutralState, actions: unknown[] = []): Act[] {
  return (step(s, actions as never).pending?.legalActions ?? []) as unknown as Act[];
}
function types(acts: Act[]): string[] {
  return Array.from(new Set(acts.map(a => a.type))).sort();
}
/** Drive the actions, then answer every A-side pause with its first offer (at most n times). */
function resolveA(s: NeutralState, actions: unknown[], n = 6): ReturnType<typeof step> {
  let acts = actions.slice();
  let r = step(s, acts as never);
  for (let i = 0; i < n; i++) {
    const legal = (r.pending?.legalActions ?? []) as unknown as Act[];
    if (r.pending === undefined || r.pending === null || (r.pending as unknown as Act).actor !== 'A' || legal.length === 0
      || legal.some(a => a.type === 'endTurn')) {
      break;
    }
    acts = acts.concat([legal[0]]);
    r = step(s, acts as never);
  }
  return r;
}

// ---------------------------------------------------------------- TA-504
describe('TA-504 Team Rocket\'s Spidops Charging Up attaches by pair', () => {
  const SPIDOPS = ['asc-018', 'asc-019'];
  const USE = (src: string) => ({ actor: 'A', type: 'useAbility', source: src, ability: 'Charging Up' });
  it('two Basic Energy in the discard: Charging Up offers attachEnergy{card -> this Spidops} for each, nothing else [TA-504]', () => {
    const s = board(mon('a1', SPIDOPS), [mon('a2', [BELLSPROUT])], { discard: [WATER, GRASS] });
    const paused = menu(s, [USE('a1')]);
    // TA-772 / B.116 (owner 2026-10-23, overrides the CF-5 pairs this cell pinned): "this Pokémon" is the only legal
    // target, so the target collapses and each card is asked alone, choose {target: card} op attach; a pair onto the
    // Benched Bellsprout (not this Spidops) is refused.
    expect(types(paused)).toEqual(['choose']);
    expect(paused.map(a => `${a.target}:${(a as { op?: string }).op}`).sort()).toEqual(['ax0:attach', 'ax1:attach']);
    expect(step(s, [USE('a1'), { actor: 'A', type: 'attachEnergy', card: 'ax0', target: 'a2' }] as never).status).toBe('invalidAction');
    const r = step(s, [USE('a1'), paused.find(a => a.target === 'ax0')] as never);
    expect(r.state.players.A.active!.energy.map(e => e.iid)).toEqual(['ax0']);
    expect(r.state.players.A.discard.map(c => c.iid)).toEqual(['ax1']);
  });
  it('control: Benched Spidops, one Basic Energy in the discard: it goes onto the Benched Spidops only [TA-504]', () => {
    const s = board(mon('a1', [BELLSPROUT]), [mon('a2', SPIDOPS)], { discard: [WATER] });
    const r = resolveA(s, [USE('a2')]);
    expect(r.state.players.A.bench[0].energy.map(e => e.iid)).toEqual(['ax0']);
    expect(r.state.players.A.active!.energy.length).toBe(0);
    expect(r.state.players.A.discard.length).toBe(0);
  });
});

// ---------------------------------------------------------------- TA-505
for (const [card, stack, ability] of [
  ['mew-044', ['mew-043'], 'Semi-Blooming Energy'],
  ['mew-045', ['mew-043', 'mew-044'], 'Fully Blooming Energy'],
] as const) {
  describe(`TA-505 ${card} ${ability} asks before it looks`, () => {
    const deck = [GRASS, PSYCHIC, WATER, GRASS, FIGHTING, GRASS, PSYCHIC, WATER, GRASS, GRASS];
    const s = board(mon('a1', stack as unknown as string[]), [mon('a2', [BELLSPROUT])], { hand: [card], deck });
    const EVOLVE = { actor: 'A', type: 'evolve', card: 'ah0', target: 'a1' };
    it(`evolve into ${card}: the first decision is confirm{true,false} [TA-505]`, () => {
      const paused = menu(s, [EVOLVE]);
      expect(types(paused)).toEqual(['confirm']);
      expect(paused.map(a => a.value).sort()).toEqual([false, true]);
    });
    it(`evolve into ${card}, decline: no look, no shuffle, the deck order is unchanged, back at the main menu [TA-505]`, () => {
      const r = step(s, [EVOLVE, { actor: 'A', type: 'confirm', value: false }] as never);
      expect(((r.pending?.legalActions ?? []) as unknown as Act[]).some(a => a.type === 'shuffle')).toBe(false);
      expect(((r.pending?.legalActions ?? []) as unknown as Act[]).some(a => a.type === 'endTurn')).toBe(true);
      expect(r.state.players.A.deck.map(c => c.iid)).toEqual(deck.map((_, i) => `ad${i}`));
      expect(r.state.players.A.active!.energy.length).toBe(0);
    });
    it(`control: evolve into ${card}, accept: the attach offer is over the looked-at Basic Energy [TA-505]`, () => {
      const paused = menu(s, [EVOLVE, { actor: 'A', type: 'confirm', value: true }]);
      expect(paused.some(a => a.type === 'attachEnergy')).toBe(true);
      expect(paused.every(a => a.type !== 'attachEnergy' || ['ad0', 'ad1', 'ad2'].concat(card === 'mew-045' ? ['ad3', 'ad4', 'ad5', 'ad6', 'ad7'] : []).includes(a.card as string))).toBe(true);
    });
  });
}

// ---------------------------------------------------------------- TA-506
describe('TA-506 Minior Far-Flying Meteor needs Minior on the Bench', () => {
  it('attach a Fighting Energy from hand to an Active Minior: no Ability offer, back at the main menu [TA-506]', () => {
    const s = board(mon('a1', ['par-099']), [mon('a2', [BELLSPROUT])], { hand: [FIGHTING] });
    const r = step(s, [{ actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a1' }] as never);
    const legal = (r.pending?.legalActions ?? []) as unknown as Act[];
    expect(legal.some(a => a.type === 'confirm')).toBe(false);
    expect(legal.some(a => a.type === 'endTurn')).toBe(true);
    expect(r.state.players.A.active!.stack[0].printing).toBe('par-099');
  });
  it('control: attach from hand to a Benched Minior: confirm offered, accepting puts Minior Active [TA-506]', () => {
    const s = board(mon('a1', [BELLSPROUT]), [mon('a2', ['par-099'])], { hand: [FIGHTING] });
    const ATTACH = { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a2' };
    expect(types(menu(s, [ATTACH]))).toEqual(['confirm']);
    const r = step(s, [ATTACH, { actor: 'A', type: 'confirm', value: true }] as never);
    expect(r.state.players.A.active!.stack[0].printing).toBe('par-099');
  });
});

// ---------------------------------------------------------------- TA-507
describe('TA-507 Floragato: Magic Whip switches, Seed Bomb does not', () => {
  const s = board(mon('a1', ['pal-013', 'pal-014'], [GRASS, GRASS]), [], { bActive: mon('b1', [BIG]), bBench: [mon('b2', [BELLSPROUT])] });
  it('Magic Whip: 50 to the Active, then it is switched to the Bench (Bellsprout becomes Active) [TA-507]', () => {
    const r = step(s, [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Magic Whip' }] as never);
    expect(r.state.players.B.active!.stack[0].printing).toBe(BELLSPROUT);
    expect(r.state.players.B.bench[0].stack[0].printing).toBe(BIG);
    expect(r.state.players.B.bench[0].damage).toBe(50);
  });
  it('control: Seed Bomb: 30 to the Active, no switch [TA-507]', () => {
    const r = step(s, [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Seed Bomb' }] as never);
    expect(r.state.players.B.active!.stack[0].printing).toBe(BIG);
    expect(r.state.players.B.active!.damage).toBe(30);
    expect(r.state.players.B.bench[0].damage).toBe(0);
  });
});

// ---------------------------------------------------------------- TA-508
describe('TA-508 Bellibolt ex Jumping Press may hit the Active', () => {
  const ATTACK = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Jumping Press' };
  const bellibolt = () => mon('a1', ['pal-077', 'pal-079'], [GRASS, GRASS]);
  it('opponent has an Active and 1 Benched: the pick is over both; picking the Active puts 50 on it [TA-508]', () => {
    const s = board(bellibolt(), [], { bActive: mon('b1', [BIG]), bBench: [mon('b2', [BELLSPROUT])] });
    const paused = menu(s, [ATTACK]);
    expect(paused.map(a => a.target).sort()).toEqual(['b1', 'b2']);
    const r = step(s, [ATTACK, paused.find(a => a.target === 'b1')] as never);
    expect(r.state.players.B.active!.damage).toBe(50);
    expect(r.state.players.B.bench[0].damage).toBe(0);
  });
  it('opponent has no Benched Pokémon: the 50 lands on the Active [TA-508]', () => {
    const s = board(bellibolt(), [], { bActive: mon('b1', [BIG]) });
    const r = resolveA(s, [ATTACK]);
    expect(r.state.players.B.active!.damage).toBe(50);
  });
  it('control: picking the Benched Pokémon puts 50 on it, none on the Active [TA-508]', () => {
    const s = board(bellibolt(), [], { bActive: mon('b1', [BIG]), bBench: [mon('b2', [BIG])] });
    const paused = menu(s, [ATTACK]);
    const r = step(s, [ATTACK, paused.find(a => a.target === 'b2')] as never);
    expect(r.state.players.B.bench[0].damage).toBe(50);
    expect(r.state.players.B.active!.damage).toBe(0);
  });
});

// ---------------------------------------------------------------- TA-509
describe('TA-509 Pelipper Hearsay may be declined; it offers only modes it can perform', () => {
  const EVOLVE = { actor: 'A', type: 'evolve', card: 'ah0', target: 'a1' };
  const deck = [GRASS, ARVEN, GRASS, GRASS, IONO, GRASS];
  it('evolve with an empty discard: the first decision is confirm{true,false} [TA-509]', () => {
    const s = board(mon('a1', ['pal-158']), [], { hand: ['pal-159'], deck });
    const paused = menu(s, [EVOLVE]);
    expect(types(paused)).toEqual(['confirm']);
    expect(paused.map(a => a.value).sort()).toEqual([false, true]);
  });
  it('decline: hand empty, deck order unchanged, no shuffle, back at the main menu [TA-509]', () => {
    const s = board(mon('a1', ['pal-158']), [], { hand: ['pal-159'], deck });
    const r = step(s, [EVOLVE, { actor: 'A', type: 'confirm', value: false }] as never);
    const legal = (r.pending?.legalActions ?? []) as unknown as Act[];
    expect(legal.some(a => a.type === 'endTurn')).toBe(true);
    expect(r.state.players.A.hand.length).toBe(0);
    expect(r.state.players.A.deck.map(c => c.iid)).toEqual(deck.map((_, i) => `ad${i}`));
  });
  it('accept with no Supporter in the discard: no mode choice, straight to the deck search [TA-509]', () => {
    const s = board(mon('a1', ['pal-158']), [], { hand: ['pal-159'], deck, discard: [GRASS] });
    const paused = menu(s, [EVOLVE, { actor: 'A', type: 'confirm', value: true }]);
    expect(paused.some(a => a.type === 'selectOption')).toBe(false);
    expect(paused.filter(a => a.type === 'choose').map(a => a.target).sort()).toEqual(['ad1', 'ad4']);
  });
  it('control: accept with a Supporter in the discard: both modes offered; the discard mode moves it to hand [TA-509]', () => {
    const s = board(mon('a1', ['pal-158']), [], { hand: ['pal-159'], deck, discard: [IONO] });
    const ACCEPT = { actor: 'A', type: 'confirm', value: true };
    const modes = menu(s, [EVOLVE, ACCEPT]);
    expect(modes.filter(a => a.type === 'selectOption').length).toBe(2);
    const r = resolveA(s, [EVOLVE, ACCEPT, modes.find(a => a.type === 'selectOption' && a.option === 0)]);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ax0']);
    expect(r.state.players.A.discard.length).toBe(0);
  });
});

// ---------------------------------------------------------------- TA-510
describe('TA-510 Gengar mew-094 attacks run their own effects', () => {
  const GENGAR = ['mew-092', 'mew-093', 'mew-094'];
  const gengar = () => mon('a1', GENGAR, [PSYCHIC, PSYCHIC]);
  it('Poltergeist into a hand with no Trainer: 0 damage, no counters on the Bench [TA-510]', () => {
    const s = board(gengar(), [], { bActive: mon('b1', [BIG]), bBench: [mon('b2', [BIG])], bHand: [GRASS, GRASS] });
    const r = resolveA(s, [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Poltergeist' }]);
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.players.B.bench[0].damage).toBe(0);
  });
  it('control: Poltergeist into a hand with 2 Trainers: 100 damage [TA-510]', () => {
    const s = board(gengar(), [], { bActive: mon('b1', [BIG]), bBench: [mon('b2', [BIG])], bHand: [NEST_BALL, ARVEN, GRASS] });
    const r = resolveA(s, [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Poltergeist' }]);
    expect(r.state.players.B.active!.damage).toBe(100);
    expect(r.state.players.B.bench[0].damage).toBe(0);
  });
  it('Hollow Dive: 110 to the Active and 3 damage counters on the Bench [TA-510]', () => {
    const s = board(gengar(), [], { bActive: mon('b1', [BIG]), bBench: [mon('b2', [BIG])], bHand: [GRASS] });
    const r = resolveA(s, [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Hollow Dive' }]);
    expect(r.state.players.B.active!.damage).toBe(110);
    expect(r.state.players.B.bench[0].damage).toBe(30);
  });
});
