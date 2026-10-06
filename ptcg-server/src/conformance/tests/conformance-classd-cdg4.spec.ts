import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Seven class-D card findings (2026-09-30 batch), each re-driven on twinleaf 901f67b0d before the fix. Printed text
 * is quoted from card-data/final/<set>.json.
 *
 *   TA-519 Great Tusk ex paf-053 Quaking Demolition: "Once at the end of your turn (after your attack), if this
 *     Pokémon is in the Active Spot, you must discard the top 5 cards of your deck." The attack pipeline dispatched
 *     EndTurnEffect straight after the attack, and the attack's Knock Out (prize, promote) was swept inside that
 *     handler, so every "end of your turn" effect ran BEFORE the KO window: at the takePrize pending the top 5 were
 *     already discarded. Rulebook: after the attack, Knock Outs are checked and Prize cards taken; then the turn ends.
 *   TA-521 Veluza par-054 Fillet Memento: "move up to 2 [Water] Energy cards from this Pokémon to 1 of your Benched
 *     Pokémon." One destination: the prompt lacked sameTarget.
 *   TA-524 Marshadow meg-080 Shadowy Side Kick: "If your opponent's Pokémon is Knocked Out by damage from this
 *     attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this
 *     Pokémon." The KO window's probe (Store.probe) shares Card instances with the real state, so the card-instance
 *     flag was consumed by the probe and the real KnockOutEffect found it false (a TA-87 regression).
 *   TA-527 Starmie mew-121 Mysterious Comet: "you may put 2 damage counters on 1 of your opponent's Pokémon. If you
 *     placed any damage counters in this way, discard this Pokémon and all attached cards." The placement is a
 *     counter placement (contract verb placeCounter); the discard-after part is TA-570's and is guarded here.
 *   TA-528 Tinkaton paf-167 Gather Materials: "You must discard a card from your hand in order to use this Ability."
 *     A mandatory cost with one card in hand has one resolution (CF-14); allowCancel kept it from collapsing.
 *   TA-532 Toedscruel par-017 / par-185 Mushroom Drain (80): "Heal 30 damage from this Pokémon." Not implemented.
 *   TA-543 Zweilous pal-139 Find a Friend: "Search your deck for up to 2 Pokémon, reveal them, and put them into
 *     your hand. Then, shuffle your deck." Nothing found = nothing revealed; and the reveal precedes the move (B.34).
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const LIGHTNING = 'sve-004';
const PSYCHIC = 'sve-005';
const FIGHTING = 'sve-006';
const DARK = 'sve-007';
const BELLSPROUT = 'asc-004'; // Basic, 60 HP, Vine Slap [G] 20
const STUNFISK = 'asc-062'; // Basic, 110 HP, Pouncing Trap [L] 30
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
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
interface Side { active: PokemonInPlay; bench?: PokemonInPlay[]; hand?: string[]; deck?: string[] }
function board(a: Side, b: Side, activePlayer: 'A' | 'B' = 'A', turn = 3): NeutralState {
  const player = (tag: string, s: Side): PlayerState => ({ active: s.active, bench: s.bench ?? [],
    hand: cards(`${tag}h`, s.hand ?? []), deck: cards(`${tag}d`, s.deck ?? Array(18).fill(GRASS)),
    discard: [], lostZone: [], prizes: prizes(tag), flags: flags() });
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn, activePlayer, firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: player('a', a), B: player('b', b) } };
}
type Act = { type: string; [k: string]: unknown };
function legal(s: NeutralState, actions: unknown[]): Act[] {
  return (step(s, actions as never).pending?.legalActions ?? []) as unknown as Act[];
}
function attack(actor: 'A' | 'B', source: string, name: string): Act {
  return { actor, type: 'declareAttack', source, name };
}

// ---------------------------------------------------------------- TA-519
describe('TA-519 Great Tusk ex Quaking Demolition runs after the attack\'s Knock Out', () => {
  const TUSK = 'paf-053';
  const tusk = () => mon('a1', [TUSK], [FIGHTING, WATER, GRASS, PSYCHIC]);
  it('Great Bash KOs the Defending Pokémon: at the takePrize pending the deck is untouched [TA-519]', () => {
    const s = board({ active: tusk(), bench: [mon('a2', [BELLSPROUT])] },
      { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT])] });
    const r = step(s, [attack('A', 'a1', 'Great Bash')] as never);
    expect((r.pending?.legalActions ?? []).some(a => (a as Act).type === 'takePrize')).toBe(true);
    expect(r.state.players.A.deck.length).toBe(18);
    expect(r.state.players.A.discard.length).toBe(0);
  });
  it('Great Bash KOs: after the Prize and the promote, the turn ends and the top 5 are discarded [TA-519]', () => {
    const s = board({ active: tusk(), bench: [mon('a2', [BELLSPROUT])] },
      { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT])] });
    const acts: Act[] = [attack('A', 'a1', 'Great Bash'), { actor: 'A', type: 'takePrize', index: 0 }];
    const promote = legal(s, acts).find(a => a.type === 'promoteBench');
    if (promote) { acts.push(promote); }
    const r = step(s, acts as never);
    expect(r.state.activePlayer).toBe('B');
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['ad0', 'ad1', 'ad2', 'ad3', 'ad4']);
    expect(r.state.players.A.deck.length).toBe(13);
  });
  it('control: Great Bash does not KO: the turn ends and the top 5 are discarded [TA-519]', () => {
    const s = board({ active: tusk() }, { active: mon('b1', [BIG]), bench: [mon('b2', [BELLSPROUT])] });
    const r = step(s, [attack('A', 'a1', 'Great Bash')] as never);
    expect(r.state.activePlayer).toBe('B');
    expect(r.state.players.B.active!.damage).toBe(260);
    expect(r.state.players.A.discard.length).toBe(5);
  });
  it('control: Great Tusk ex on the Bench discards nothing at the end of the turn [TA-519]', () => {
    const s = board({ active: mon('a1', [BELLSPROUT]), bench: [mon('a2', [TUSK])] },
      { active: mon('b1', [BIG]) });
    const r = step(s, [{ actor: 'A', type: 'endTurn' }] as never);
    expect(r.state.activePlayer).toBe('B');
    expect(r.state.players.A.discard.length).toBe(0);
  });
});

// ---------------------------------------------------------------- TA-521
describe('TA-521 Veluza Fillet Memento moves to ONE Benched Pokémon', () => {
  const VELUZA = 'par-054';
  const BONNET = 'twm-118';
  const s = () => board(
    { active: mon('a1', [VELUZA], [WATER, WATER], 90), bench: [mon('a2', [BONNET]), mon('a3', [BONNET])], hand: [WATER] },
    { active: mon('b1', [STUNFISK], [LIGHTNING]) }, 'B', 4);
  const kick = attack('B', 'b1', 'Pouncing Trap');
  it('after the first Water Energy goes to a2, the second can go only to a2 [TA-521]', () => {
    const first = legal(s(), [kick]).find(a => a.type === 'moveEnergy' && a.target === 'a2')!;
    expect(first).toBeDefined();
    const next = legal(s(), [kick, first]).filter(a => a.type === 'moveEnergy');
    expect(next.length).toBeGreaterThan(0);
    expect(next.every(a => a.target === 'a2')).toBe(true);
  });
  it('first Energy to a3: the second is offered only to a3 and both end there [TA-521]', () => {
    const first = legal(s(), [kick]).find(a => a.type === 'moveEnergy' && a.target === 'a3')!;
    const seconds = legal(s(), [kick, first]).filter(a => a.type === 'moveEnergy');
    expect(seconds.map(a => a.target)).toEqual(['a3']);
    const r = step(s(), [kick, first, seconds[0]] as never);
    const a3 = r.state.players.A.bench.find(p => p.stack.some(c => c.iid === 'a3'))!;
    expect(a3.energy.length).toBe(2);
  });
  it('control: "up to 2": after the first move the player may stop, one Energy moved [TA-521]', () => {
    const first = legal(s(), [kick]).find(a => a.type === 'moveEnergy' && a.target === 'a2')!;
    const stop = legal(s(), [kick, first]).find(a => a.type === 'confirm' && a.value === false);
    expect(stop).toBeDefined();
    const r = step(s(), [kick, first, stop] as never);
    const a2 = r.state.players.A.bench.find(p => p.stack.some(c => c.iid === 'a2'))!;
    expect(a2.energy.length).toBe(1);
  });
});

// ---------------------------------------------------------------- TA-524
describe('TA-524 Marshadow Shadowy Side Kick protects after a Knock Out', () => {
  const MARSHADOW = 'meg-080';
  it('Side Kick KOs the Active; next turn Vine Slap does no damage to Marshadow [TA-524]', () => {
    const s = board({ active: mon('a1', [MARSHADOW], [FIGHTING, FIGHTING]), bench: [mon('a2', [BELLSPROUT])] },
      { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT])], hand: [GRASS] });
    const acts: Act[] = [attack('A', 'a1', 'Shadowy Side Kick'), { actor: 'A', type: 'takePrize', index: 0 }];
    const promote = legal(s, acts).find(a => a.type === 'promoteBench');
    if (promote) { acts.push(promote); }
    acts.push({ actor: 'B', type: 'attachEnergy', card: 'bh0', target: 'b2' }, attack('B', 'b2', 'Vine Slap'));
    const r = step(s, acts as never);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.turn).toBe(5);
    expect(r.state.players.A.active!.damage).toBe(0);
  });
  it('control: Side Kick does not KO; next turn Relentless Punches damages Marshadow [TA-524]', () => {
    const s = board({ active: mon('a1', [MARSHADOW], [FIGHTING, FIGHTING]) },
      { active: mon('b1', ['twm-118'], [DARK, DARK, DARK]) });
    const r = step(s, [attack('A', 'a1', 'Shadowy Side Kick'), attack('B', 'b1', 'Relentless Punches')] as never);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.B.active!.damage).toBe(60);
    expect(r.state.players.A.active!.damage).toBe(50);
  });
});

// ---------------------------------------------------------------- TA-527
describe('TA-527 Starmie Mysterious Comet is a counter placement', () => {
  const STARMIE = ['mew-120', 'mew-121'];
  const s = () => board({ active: mon('a1', STARMIE, [WATER, WATER]), bench: [mon('a2', [BELLSPROUT])] },
    { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT])] });
  const use = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Mysterious Comet' };
  it('the target pick is offered as placeCounter on each of the opponent\'s Pokémon [TA-527]', () => {
    const menu = legal(s(), [use]);
    expect(menu.map(a => a.type).sort()).toEqual(['placeCounter', 'placeCounter']);
    expect(menu.map(a => a.target).sort()).toEqual(['b1', 'b2']);
  });
  it('control: Starmie stays in play during the pick, then 2 counters land and Starmie is discarded (TA-570) [TA-527]', () => {
    const paused = step(s(), [use] as never);
    expect(paused.state.players.A.active!.stack.map(c => c.printing)).toEqual(STARMIE);
    const pick = (paused.pending!.legalActions as unknown as Act[]).find(a => a.target === 'b2')!;
    const r = step(s(), [use, pick] as never);
    const b2 = r.state.players.B.bench.find(p => p.stack.some(c => c.iid === 'b2'))!;
    expect(b2.damage).toBe(20);
    expect(r.state.players.A.discard.map(c => c.printing).sort()).toEqual(['mew-120', 'mew-121', WATER, WATER].sort());
  });
});

// ---------------------------------------------------------------- TA-528
describe('TA-528 Tinkaton Gather Materials discard cost collapses with one card in hand', () => {
  const TINKATON = ['meg-096', 'meg-097', 'paf-167'];
  const use = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Gather Materials' };
  it('one card in hand: the cost is paid at once and 3 cards are drawn [TA-528]', () => {
    const s = board({ active: mon('a1', TINKATON, [PSYCHIC]), hand: [PSYCHIC] }, { active: mon('b1', [BELLSPROUT]) });
    const r = step(s, [use] as never);
    expect((r.pending?.legalActions ?? []).some(a => (a as Act).type === 'discard')).toBe(false);
    expect(r.state.players.A.discard.map(c => c.iid)).toEqual(['ah0']);
    expect(r.state.players.A.hand.length).toBe(3);
  });
  it('control: two cards in hand: the discard pick is offered on both [TA-528]', () => {
    const s = board({ active: mon('a1', TINKATON, [PSYCHIC]), hand: [PSYCHIC, GRASS] }, { active: mon('b1', [BELLSPROUT]) });
    const menu = legal(s, [use]).filter(a => a.type === 'discard');
    expect(menu.map(a => a.target).sort()).toEqual(['ah0', 'ah1']);
  });
});

// ---------------------------------------------------------------- TA-532
describe('TA-532 Toedscruel Mushroom Drain heals 30 from itself', () => {
  for (const printing of ['par-017', 'par-185']) {
    it(`${printing} with 20 damage: Mushroom Drain KOs Bellsprout and Toedscruel ends with 0 damage [TA-532]`, () => {
      const s = board({ active: mon('a1', ['jtg-088', printing], [GRASS, WATER, GRASS], 20) },
        { active: mon('b1', [BELLSPROUT]), bench: [mon('b2', [BELLSPROUT])] });
      const r = step(s, [attack('A', 'a1', 'Mushroom Drain')] as never);
      expect(r.state.players.A.active!.damage).toBe(0);
    });
  }
  it('par-017 with 50 damage ends with 20; the defender takes 80 [TA-532]', () => {
    const s = board({ active: mon('a1', ['jtg-088', 'par-017'], [GRASS, WATER, GRASS], 50) }, { active: mon('b1', [BIG]) });
    const r = step(s, [attack('A', 'a1', 'Mushroom Drain')] as never);
    expect(r.state.players.A.active!.damage).toBe(20);
    expect(r.state.players.B.active!.damage).toBe(80);
  });
  it('control: an undamaged par-017 stays at 0 and the defender takes 80 [TA-532]', () => {
    const s = board({ active: mon('a1', ['jtg-088', 'par-017'], [GRASS, WATER, GRASS]) }, { active: mon('b1', [BIG]) });
    const r = step(s, [attack('A', 'a1', 'Mushroom Drain')] as never);
    expect(r.state.players.A.active!.damage).toBe(0);
    expect(r.state.players.B.active!.damage).toBe(80);
  });
});

// ---------------------------------------------------------------- TA-543
describe('TA-543 Zweilous Find a Friend reveals only what it finds', () => {
  const ZWEILOUS = ['pal-138', 'pal-139'];
  it('deck with no Pokémon: no reveal event, straight to the shuffle [TA-543]', () => {
    const s = board({ active: mon('a1', ZWEILOUS, [DARK, DARK, WATER]) }, { active: mon('b1', [BELLSPROUT]) });
    const r = step(s, [attack('A', 'a1', 'Find a Friend')] as never);
    const acts = (r.pending?.legalActions ?? []) as unknown as Act[];
    const pickable = acts.filter(a => a.type === 'choose');
    expect(pickable.length).toBe(0);
    expect(r.events.filter(e => e.kind === 'reveal').length).toBe(0);
  });
  it('two Pokémon found: one reveal naming both, before they enter the hand [TA-543]', () => {
    const s = board({ active: mon('a1', ZWEILOUS, [DARK, DARK, WATER]) }, { active: mon('b1', [BELLSPROUT]) });
    s.players.A.deck[3].printing = BELLSPROUT;
    s.players.A.deck[7].printing = BELLSPROUT;
    const decl = attack('A', 'a1', 'Find a Friend');
    const acts: Act[] = [decl, { actor: 'A', type: 'choose', target: 'ad3' }, { actor: 'A', type: 'choose', target: 'ad7' }];
    const r = step(s, acts as never);
    const reveals = r.events.filter(e => e.kind === 'reveal') as unknown as Array<{ cards: string[] }>;
    expect(reveals.length).toBe(1);
    expect([...reveals[0].cards].sort()).toEqual(['ad3', 'ad7']);
    const revealAt = r.events.findIndex(e => e.kind === 'reveal');
    const toHand = r.events.findIndex(e => e.kind === 'moved' && (e as unknown as { destination?: { zone: string } }).destination?.zone === 'hand'
      && ['ad3', 'ad7'].includes((e as unknown as { card: string }).card));
    expect(revealAt).toBeLessThan(toHand);
    expect(r.state.players.A.hand.map(c => c.iid).sort()).toEqual(['ad3', 'ad7']);
  });
  it('control: two Pokémon found: both go to the hand and the shuffle is owed [TA-543]', () => {
    const s = board({ active: mon('a1', ZWEILOUS, [DARK, DARK, WATER]) }, { active: mon('b1', [BELLSPROUT]) });
    s.players.A.deck[3].printing = BELLSPROUT;
    s.players.A.deck[7].printing = BELLSPROUT;
    const r = step(s, [attack('A', 'a1', 'Find a Friend'), { actor: 'A', type: 'choose', target: 'ad3' },
      { actor: 'A', type: 'choose', target: 'ad7' }] as never);
    expect(r.state.players.A.hand.map(c => c.iid).sort()).toEqual(['ad3', 'ad7']);
    expect((r.pending?.legalActions ?? []).some(a => (a as Act).type === 'shuffle')).toBe(true);
  });
});
