import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Seven class-D card findings (2026-09-30 / 10-01), each re-driven on twinleaf 901f67b0d before the fix. Printed
 * text is quoted from card-data/final/<set>.json.
 *
 *   TA-544 Team Rocket's Nidorina dri-115 Dark Awakening: "Choose up to 2 of your [Darkness] Pokémon. For each of
 *     those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve
 *     it. Then, shuffle your deck." On an empty deck the attack returned straight to a shuffle, skipping the pick.
 *     #2301: up to 2 is 0..2; choosing none searches nothing and owes no shuffle (B.44, #2322); choosing one is a
 *     search performed on an empty deck, which still shuffles (#2303, B.62).
 *   TA-546 Teal Mask Ogerpon ex twm-025 Teal Dance: "Once during your turn, you may attach a Basic [Grass] Energy card
 *     from your hand to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card." The pick was a
 *     ChooseCardsPrompt (choose{card}); CF-32 / CF-5 name an attach attachEnergy{card,target}.
 *   TA-548 Vespiquen ex obf-096 Phantom Queen (200): "Put 3 damage counters on each of your opponent's Benched
 *     Pokémon that has any damage counters on it." Twinleaf also put 20 on a damaged Active, before the 200.
 *   TA-549 Togekiss obf-085 Precious Gift: "Once at the end of your turn (after your attack), you may use this
 *     Ability. Draw cards until you have 8 cards in your hand." #1869: "used at the end of your turn after attacking
 *     and checking for a KO but before Pokemon Checkup. So if your attack causes a KO you would take Prize cards
 *     first, and then you can use Precious Gift." It was offered before the attack's Knock Out was resolved.
 *   TA-550 Vileplume mew-045 / paf-094 Fully Blooming Energy: "When you play this Pokémon from your hand to evolve 1 of
 *     your Pokémon during your turn, you may look at the top 8 cards of your deck and attach any number of Basic Energy
 *     cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck." There was
 *     no may: the look always happened and a decline still shuffled.
 *   TA-551 Jirachi par-126 Charge Energy: "Search your deck for up to 2 Basic Energy cards, reveal them, and put them
 *     into your hand. Then, shuffle your deck." Unimplemented: the attack did nothing.
 *   TA-563 Weezing mew-110 Let's Have a Blast: "If this Pokémon is in the Active Spot and is Knocked Out by damage from
 *     an attack from your opponent's Pokémon, flip a coin. If heads, the Attacking Pokémon is Knocked Out." The
 *     Attacking Pokémon's Knock Out was dispatched (and its Prize asked) from inside the reaction, while Weezing was
 *     still in the Active Spot; both belong to one Knock Out group (TA-577), discarded before any Prize is taken.
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const WATER = 'sve-003';
const DARK = 'sve-007';
const BELLSPROUT = 'asc-004'; // Basic, 60 HP
const BIG = 'mew-003'; // Venusaur ex, 340 HP: a defender that survives

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
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
interface Opts { hand?: string[]; deck?: string[]; bActive?: PokemonInPlay; bBench?: PokemonInPlay[]; bDeck?: string[] }
function board(active: PokemonInPlay, bench: PokemonInPlay[], opts: Opts = {}): NeutralState {
  const A: PlayerState = { active, bench, hand: cards('ah', opts.hand ?? []), deck: cards('ad', opts.deck ?? Array(8).fill(WATER)),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: opts.bActive ?? mon('b1', [BIG]), bench: opts.bBench ?? [mon('b2', [BELLSPROUT])], hand: [],
    deck: cards('bd', opts.bDeck ?? Array(8).fill(WATER)), discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
type Act = { type: string; actor?: string; [k: string]: unknown };
type Ev = { kind: string; [k: string]: unknown };
function run(s: NeutralState, actions: unknown[]) {
  return step(s, actions as never);
}
function menu(s: NeutralState, actions: unknown[] = []): Act[] {
  return (run(s, actions).pending?.legalActions ?? []) as unknown as Act[];
}
function events(s: NeutralState, actions: unknown[]): Ev[] {
  return (run(s, actions).events ?? []) as unknown as Ev[];
}
/** A deck shuffle happened (event) or is pending as a system shuffle (the live arbiter's pause). */
function shuffledOrPending(s: NeutralState, actions: unknown[], player: string): boolean {
  const r = run(s, actions);
  const ev = ((r.events ?? []) as unknown as Ev[]).some(e => e.kind === 'shuffled' && e.player === player && e.zone === 'deck');
  const pend = ((r.pending?.legalActions ?? []) as unknown as Act[]).some(a => a.actor === 'system' && a.type === 'shuffle');
  return ev || pend;
}
const attack = (source: string, name: string) => ({ actor: 'A', type: 'declareAttack', source, name });
const confirm = (value: boolean, actor = 'A') => ({ actor, type: 'confirm', value });
const flip = (face: 'heads' | 'tails') => ({ actor: 'system', type: 'flip', face });

// ---------------------------------------------------------------- TA-544
describe("TA-544 Team Rocket's Nidorina Dark Awakening asks the pick on an empty deck", () => {
  const NIDORINA = ['dri-114', 'dri-115'];
  const empty = board(mon('a1', NIDORINA, [DARK]), [mon('a2', [BELLSPROUT])], { deck: [] });
  const DARK_AWAKENING = attack('a1', 'Dark Awakening');
  it('empty deck: Dark Awakening pends the choice of up to 2 [D] Pokémon (the Darkness Nidorina is a candidate) [TA-544]', () => {
    const m = menu(empty, [DARK_AWAKENING]);
    expect(m.some(a => a.type === 'choose' && a.target === 'a1')).toBe(true);
    expect(m.some(a => a.type === 'confirm' && a.value === false)).toBe(true);
    expect(m.some(a => a.type === 'choose' && a.target === 'a2')).toBe(false);
  });
  it('empty deck, choose none: no search, so no shuffle (B.44 / #2322) [TA-544]', () => {
    expect(shuffledOrPending(empty, [DARK_AWAKENING, confirm(false)], 'A')).toBe(false);
  });
  it('empty deck, choose Nidorina: the search is performed and whiffs, and the deck is shuffled (#2303 / B.62) [TA-544]', () => {
    const picked = [DARK_AWAKENING, { actor: 'A', type: 'choose', target: 'a1' }];
    const after = menu(empty, picked).some(a => a.type === 'confirm' && a.value === false) ? [...picked, confirm(false)] : picked;
    expect(shuffledOrPending(empty, after, 'A')).toBe(true);
  });
  it('control: stocked deck with a Nidoqueen: choosing Nidorina evolves it from the deck [TA-544]', () => {
    const s = board(mon('a1', NIDORINA, [DARK]), [mon('a2', [BELLSPROUT])], { deck: ['dri-116', WATER, WATER] });
    let acts: unknown[] = [DARK_AWAKENING, { actor: 'A', type: 'choose', target: 'a1' }];
    if (menu(s, acts).some(a => a.type === 'confirm' && a.value === false && !menu(s, acts).some(b => b.type === 'choose' && b.target === 'ad0'))) {
      acts = [...acts, confirm(false)];
    }
    acts = [...acts, { actor: 'A', type: 'choose', target: 'ad0' }];
    const r = run(s, acts);
    const stack = r.state.players.A.active!.stack.map(c => c.printing);
    expect(stack[stack.length - 1]).toBe('dri-116');
  });
});

// ---------------------------------------------------------------- TA-546
describe('TA-546 Teal Mask Ogerpon ex Teal Dance offers the attach as attachEnergy', () => {
  const OGERPON = mon('a1', ['twm-025']);
  const USE = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Teal Dance' };
  it('two Basic Grass Energy in hand: Teal Dance pends attachEnergy{card, target: this Ogerpon} per Energy [TA-546]', () => {
    const s = board(OGERPON, [mon('a2', [BELLSPROUT])], { hand: [GRASS, GRASS, WATER] });
    const m = menu(s, [USE]);
    // TA-772 / B.116 (owner 2026-10-23, overrides the CF-5 pairs this cell pinned): this Ogerpon is the only legal target,
    // so the target collapses and each Grass is asked alone, choose {target: card} op attach; a pair onto the Benched
    // Bellsprout is refused.
    expect(m.filter(a => a.type === 'choose').map(a => `${a.target}:${a.op}`).sort()).toEqual(['ah0:attach', 'ah1:attach']);
    expect(m.some(a => a.type === 'attachEnergy')).toBe(false);
    expect(step(s, [USE, { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a2' }] as never).status).toBe('invalidAction');
  });
  it('two Basic Grass Energy: attaching one puts it on Ogerpon and draws a card [TA-546]', () => {
    const s = board(OGERPON, [mon('a2', [BELLSPROUT])], { hand: [GRASS, GRASS, WATER] });
    const r = run(s, [USE, { actor: 'A', type: 'choose', target: 'ah1' }]);   // TA-772 / B.116: the card alone
    expect(r.state.players.A.active!.energy.map(c => c.iid)).toEqual(['ah1']);
    expect(r.state.players.A.hand.length).toBe(3);
    expect(r.state.players.A.bench[0].energy.length).toBe(0);
  });
  it('control: one Basic Grass Energy: the forced attach collapses (CF-14), Energy on Ogerpon, 1 card drawn [TA-546]', () => {
    const s = board(OGERPON, [mon('a2', [BELLSPROUT])], { hand: [GRASS, WATER] });
    const r = run(s, [USE]);
    expect(r.state.players.A.active!.energy.map(c => c.iid)).toEqual(['ah0']);
    expect(r.state.players.A.hand.length).toBe(2);
  });
});

// ---------------------------------------------------------------- TA-548
describe('TA-548 Vespiquen ex Phantom Queen puts counters only on damaged Benched Pokémon', () => {
  const VESPIQUEN = mon('a1', ['obf-096'], [GRASS, GRASS, GRASS]);
  const s = board(VESPIQUEN, [], { bActive: mon('b1', [BIG], [], 10), bBench: [mon('b2', [BIG], [], 10), mon('b3', [BIG])] });
  const PQ = attack('a1', 'Phantom Queen');
  it('damaged Active (10): it takes only the 200, ending at 210 [TA-548]', () => {
    expect(run(s, [PQ]).state.players.B.active!.damage).toBe(210);
  });
  it('the 200 to the Active is dealt before the counters on the Bench [TA-548]', () => {
    const dmg = events(s, [PQ]).filter(e => e.kind === 'damaged').map(e => e.target);
    expect(dmg).toEqual(['b1', 'b2']);
  });
  it('control: the damaged Benched Pokémon gets 3 counters, the undamaged one none [TA-548]', () => {
    const r = run(s, [PQ]);
    expect(r.state.players.B.bench.map(b => b.damage)).toEqual([40, 0]);
  });
});

// ---------------------------------------------------------------- TA-549
describe('TA-549 Togekiss Precious Gift comes after the attack\'s Knock Out and Prize', () => {
  const TOGEKISS = ['asc-080', 'asc-081', 'obf-085'];
  // A: hand 2, Togekiss Active with 2 Energy, 1 Benched; B: 60-HP Active (Knocked Out by 110), 1 Benched.
  const ko = board(mon('a1', TOGEKISS, [GRASS, WATER]), [mon('a2', [BELLSPROUT])], { hand: [WATER, WATER],
    bActive: mon('b1', [BELLSPROUT]), bBench: [mon('b2', [BIG])] });
  const PC = attack('a1', 'Power Cyclone');
  function afterMove(s: NeutralState): unknown[] {
    const m = menu(s, [PC]);
    // TA-651: the Energy is a `choose` before the damage; the one Benched Pokémon then receives it (forced).
    const mv = m.find(a => a.type === 'choose' || a.type === 'moveEnergy' || a.type === 'attachEnergy');
    return mv ? [PC, mv] : [PC];
  }
  it('Power Cyclone Knocks Out the Active: the next decision is A\'s Prize, not Precious Gift [TA-549]', () => {
    const m = menu(ko, afterMove(ko));
    expect(m.some(a => a.type === 'takePrize' && a.actor === 'A')).toBe(true);
    expect(m.some(a => a.type === 'confirm')).toBe(false);
  });
  it('Prize taken first, then Precious Gift accepted: the hand is 8 including the Prize [TA-549]', () => {
    let acts = [...afterMove(ko), { actor: 'A', type: 'takePrize', index: 0 }];
    // B promotes its lone Benched Pokémon (collapses where forced); then Precious Gift.
    for (let i = 0; i < 3; i++) {
      const m = menu(ko, acts);
      if (m.some(a => a.type === 'confirm' && a.actor === 'A')) {
        break;
      }
      const promote = m.find(a => a.actor === 'B');
      if (promote === undefined) {
        break;
      }
      acts = [...acts, promote];
    }
    const before = run(ko, acts);
    expect(before.state.players.A.hand.length).toBe(3);
    expect(before.state.players.B.active?.stack[0].iid).toBe('b2');
    const r = run(ko, [...acts, confirm(true)]);
    expect(r.state.players.A.hand.length).toBe(8);
    expect(r.state.players.A.prizes.length).toBe(5);
  });
  it('control: no Knock Out (big defender): Precious Gift is offered right after the attack and draws to 8 [TA-549]', () => {
    const s = board(mon('a1', TOGEKISS, [GRASS, WATER]), [mon('a2', [BELLSPROUT])], { hand: [WATER, WATER] });
    const acts = afterMove(s);
    expect(menu(s, acts).some(a => a.type === 'confirm' && a.actor === 'A')).toBe(true);
    expect(run(s, [...acts, confirm(true)]).state.players.A.hand.length).toBe(8);
  });
});

// ---------------------------------------------------------------- TA-550
for (const card of ['mew-045', 'paf-094']) {
  describe(`TA-550 Vileplume ${card} Fully Blooming Energy is a may`, () => {
    const s = board(mon('a1', ['mew-043', 'mew-044']), [mon('a2', [BELLSPROUT])], { hand: [card],
      deck: [GRASS, WATER, BELLSPROUT, FIRE, BELLSPROUT, BELLSPROUT, BELLSPROUT, BELLSPROUT, GRASS, WATER] });
    const EVOLVE = { actor: 'A', type: 'evolve', card: 'ah0', target: 'a1' };
    it(`${card} evolves: the first decision is the may (confirm true / false only), nothing looked at yet [TA-550]`, () => {
      const m = menu(s, [EVOLVE]);
      expect(m.map(a => `${a.type}:${a.value}`).sort()).toEqual(['confirm:false', 'confirm:true']);
    });
    it(`${card} declined: no look, no shuffle, the deck order is untouched [TA-550]`, () => {
      const r = run(s, [EVOLVE, confirm(false)]);
      expect(shuffledOrPending(s, [EVOLVE, confirm(false)], 'A')).toBe(false);
      expect(r.state.players.A.deck.map(c => c.iid)).toEqual(s.players.A.deck.map(c => c.iid));
    });
    it(`control: ${card} accepted: the attach pick over the top 8 is offered [TA-550]`, () => {
      const m = menu(s, [EVOLVE, confirm(true)]);
      expect(m.some(a => a.type === 'attachEnergy' && a.card === 'ad0')).toBe(true);
    });
  });
}

// ---------------------------------------------------------------- TA-551
describe('TA-551 Jirachi Charge Energy searches for up to 2 Basic Energy', () => {
  const s = board(mon('a1', ['par-126'], [WATER]), [mon('a2', [BELLSPROUT])], { deck: [GRASS, BELLSPROUT, FIRE, BELLSPROUT, WATER] });
  const CE = attack('a1', 'Charge Energy');
  it('Charge Energy pends a pick over the Basic Energy in the deck (not the Pokémon) with a stop [TA-551]', () => {
    const m = menu(s, [CE]);
    expect(m.filter(a => a.type === 'choose').map(a => a.target).sort()).toEqual(['ad0', 'ad2', 'ad4']);
    expect(m.some(a => a.type === 'confirm' && a.value === false)).toBe(true);
  });
  it('take two: both go to the hand and the deck is shuffled [TA-551]', () => {
    const acts = [CE, { actor: 'A', type: 'choose', target: 'ad0' }, { actor: 'A', type: 'choose', target: 'ad2' }];
    const r = run(s, acts);
    const handIds = r.state.players.A.hand.map(c => c.iid);
    expect(handIds).toContain('ad0');
    expect(handIds).toContain('ad2');
    expect(shuffledOrPending(s, acts, 'A')).toBe(true);
  });
  it('control: take none: nothing to the hand, the deck is still shuffled (a performed search, #2303) [TA-551]', () => {
    const acts = [CE, confirm(false)];
    expect(run(s, acts).state.players.A.hand.length).toBe(0);
    expect(shuffledOrPending(s, acts, 'A')).toBe(true);
  });
});

// ---------------------------------------------------------------- TA-563
describe("TA-563 Weezing Let's Have a Blast: both Knocked Out Pokémon leave play before any Prize", () => {
  // A: Tandemaus ssp-157 Play Rough (10, +10 on heads); B: Weezing mew-110 at 100 of 110 HP, one Benched each.
  const s = board(mon('a1', ['ssp-157'], [WATER]), [mon('a2', ['mew-109'])], {
    bActive: mon('b1', ['mew-109', 'mew-110'], [], 100), bBench: [mon('b2', ['mew-109'])] });
  const PR = attack('a1', 'Play Rough');
  const both = [PR, flip('heads'), flip('heads')];
  it('heads, heads: at the first Prize pick neither Knocked Out Pokémon is still in the Active Spot [TA-563]', () => {
    const r = run(s, both);
    expect(((r.pending?.legalActions ?? []) as unknown as Act[]).some(a => a.type === 'takePrize')).toBe(true);
    expect(r.state.players.B.active).toBeNull();
    expect(r.state.players.A.active).toBeNull();
    expect(r.state.players.B.discard.map(c => c.printing)).toContain('mew-110');
  });
  it('heads, heads: both Knock Outs are reported before the first Prize [TA-563]', () => {
    const kos = events(s, both).filter(e => e.kind === 'ko').map(e => e.target).sort();
    expect(kos).toEqual(['a1', 'b1']);
  });
  it('control: heads, heads, both Prizes taken: each player took exactly 1 Prize (TA-559) [TA-563]', () => {
    let acts: unknown[] = both;
    for (let i = 0; i < 2; i++) {
      const p = menu(s, acts).find(a => a.type === 'takePrize');
      if (p === undefined) {
        break;
      }
      acts = [...acts, p];
    }
    const r = run(s, acts);
    expect(r.state.players.A.prizes.length).toBe(5);
    expect(r.state.players.B.prizes.length).toBe(5);
  });
  it('control: heads, tails: only Weezing is Knocked Out; Tandemaus stays Active [TA-563]', () => {
    const r = run(s, [PR, flip('heads'), flip('tails')]);
    expect(r.state.players.A.active?.stack[0].printing).toBe('ssp-157');
    expect(r.state.players.B.discard.map(c => c.printing)).toContain('mew-110');
  });
});
