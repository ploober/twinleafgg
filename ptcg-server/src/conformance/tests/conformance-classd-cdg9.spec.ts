import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Seven card findings (class-D 2026-09-30 batch + TA-635), each re-driven on twinleaf ec9f093d5 before the fix. Printed
 * text is quoted from card-data/final/<set>.json.
 *
 *   TA-511 Hitmonchan mew-107 Counterattack: "If this Pokémon is in the Active Spot and is damaged by an attack from your
 *     opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon." The 30
 *     was a raw `damage += 30` with no LOG_PLAYER_PLACES_DAMAGE_COUNTERS, so when Hitmonchan was Knocked Out the event
 *     trace credited it 50 (80 - 30) and, when the counters also Knocked Out the attacker, dropped the attacker's 30.
 *   TA-512 Kilowattrel paf-022 United Thunder: "This attack does 10 damage for each Pokémon in your discard pile that has
 *     the United Wings attack to 1 of your opponent's Benched Pokémon." The target prompt offered the Active, and was
 *     raised at 0 damage (CF-14 / CF-33: no decision when every target leaves the same board).
 *   TA-513 Spidops ex svi-019 Wire Hang: "This attack does 30 more damage for each [Colorless] in your opponent's Active
 *     Pokémon's Retreat Cost." It read the printed retreat, ignoring Trap Territory ("Your opponent's Active Pokémon's
 *     Retreat Cost is [Colorless] more.") and every other modifier (#71, #1970, #2113).
 *   TA-514 Vespiquen ex obf-096 Healing Pheromone: "Heal 60 damage from 1 of your Pokémon." Undamaged Pokémon were
 *     offered (#1085), the prompt was labelled a damage pick, and with nothing damaged it still pended (#1661: the attack
 *     is used and heals nothing).
 *   TA-515 Arbok ex mew-024 Menacing Fangs: "Your opponent discards 2 cards from their hand." With 2 or fewer cards the
 *     opponent's hand went to the ATTACKER's discard pile.
 *   TA-516 Baxcalibur pal-060 Super Cold: "As often as you like during your turn, you may attach a Basic [Water] Energy
 *     card from your hand to 1 of your Pokémon." The AttachEnergyPrompt kept its default min 0, a post-activation
 *     decline (B.46).
 *   TA-635 Larry's Staraptor asc-170 Feathery Strike: "Discard 2 Energy from this Pokémon, and this attack also does 50
 *     damage to 1 of your opponent's Benched Pokémon." The Bench 50 was placed before the Energy choice was asked (one
 *     Benched Pokémon or two); B.82: the choices first, then the damage (Active and Bench), then the discard.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const PSYCHIC = 'sve-005';
const DARK = 'sve-007';
const BELLSPROUT = 'asc-004'; // Basic, 60 HP, retreat [C]
const BIG = 'mew-003';        // Venusaur ex, 340 HP, printed retreat [C][C][C][C]
const DONDOZO = 'svi-061';    // 160 HP

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
interface Side { active: PokemonInPlay; bench?: PokemonInPlay[]; hand?: string[]; discard?: string[] }
function board(A: Side, B: Side, actor: 'A' | 'B' = 'A'): NeutralState {
  const ps = (tag: string, s: Side): PlayerState => ({ active: s.active, bench: s.bench ?? [], hand: cards(`${tag}h`, s.hand ?? []),
    deck: cards(`${tag}d`, Array(8).fill(GRASS)), discard: cards(`${tag}x`, s.discard ?? []), lostZone: [], prizes: prizes(tag),
    flags: flags() });
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: actor, firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: ps('a', A), B: ps('b', B) } };
}
type Act = { type: string; actor?: string; target?: string; value?: unknown; [k: string]: unknown };
type Ev = { kind: string; target?: string; hp?: number; card?: string };
const acts = (r: ReturnType<typeof step>): Act[] => (r.pending?.legalActions ?? []) as unknown as Act[];
const evs = (r: ReturnType<typeof step>): Ev[] => (r.events ?? []) as unknown as Ev[];
const damaged = (r: ReturnType<typeof step>, target: string): number[] =>
  evs(r).filter(e => e.kind === 'damaged' && e.target === target).map(e => e.hp as number);
const attack = (actor: string, source: string, name: string) => ({ actor, type: 'declareAttack', source, name });

// ---------------------------------------------------------------- TA-511
describe('TA-511 Hitmonchan Counterattack logs its 3 counters', () => {
  // B's Clefairy asc-074 (60 HP, Psychic) Moon Kick 40 into Hitmonchan (120 HP, Psychic Weakness): 80.
  const HIT = 'mew-107';
  const CLEFAIRY = 'asc-074';
  const MOON = attack('B', 'b1', 'Moon Kick');
  it('Hitmonchan with 110 damage is Knocked Out: its damaged is 80 and the Attacking Clefairy\'s is 30 [TA-511]', () => {
    const s = board({ active: mon('a1', [HIT], [], 110), bench: [mon('a2', [BELLSPROUT])] },
      { active: mon('b1', [CLEFAIRY], [WATER, GRASS]), bench: [mon('b2', [BELLSPROUT])] }, 'B');
    const r = step(s, [MOON] as never);
    expect(damaged(r, 'a1')).toEqual([80]);
    expect(damaged(r, 'b1')).toEqual([30]);
    expect(r.state.players.B.active!.damage).toBe(30);
  });
  it('the counters also Knock Out the Attacking Clefairy (30 damage on it): its damaged 30 is still traced [TA-511]', () => {
    const s = board({ active: mon('a1', [HIT], [], 110), bench: [mon('a2', [BELLSPROUT])] },
      { active: mon('b1', [CLEFAIRY], [WATER, GRASS], 30), bench: [mon('b2', [BELLSPROUT])] }, 'B');
    const r = step(s, [MOON] as never);
    expect(damaged(r, 'a1')).toEqual([80]);
    expect(damaged(r, 'b1')).toEqual([30]);
    expect(evs(r).filter(e => e.kind === 'ko').map(e => e.target).sort()).toEqual(['a1', 'b1']);
  });
  it('control: Hitmonchan survives (no damage before): damaged 80 on it and 30 on Clefairy [TA-511]', () => {
    const s = board({ active: mon('a1', [HIT]), bench: [mon('a2', [BELLSPROUT])] },
      { active: mon('b1', [CLEFAIRY], [WATER, GRASS]), bench: [mon('b2', [BELLSPROUT])] }, 'B');
    const r = step(s, [MOON] as never);
    expect(r.state.players.A.active!.damage).toBe(80);
    expect(r.state.players.B.active!.damage).toBe(30);
    expect(damaged(r, 'b1')).toEqual([30]);
  });
});

// ---------------------------------------------------------------- TA-512
describe('TA-512 Kilowattrel United Thunder targets the Bench only, and only when it does damage', () => {
  const KILO = ['paf-145', 'paf-022'];
  const WATTREL = 'paf-145'; // has United Wings
  const UT = attack('A', 'a1', 'United Thunder');
  it('no United Wings Pokémon in the discard pile: no target pick, the turn passes [TA-512]', () => {
    const s = board({ active: mon('a1', KILO, [GRASS]) },
      { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT]), mon('b3', [BELLSPROUT])] });
    const r = step(s, [UT] as never);
    expect(acts(r).some(a => a.type === 'choose')).toBe(false);
    expect(r.state.activePlayer).toBe('B');
    expect(evs(r).some(e => e.kind === 'damaged')).toBe(false);
  });
  it('two Wattrel in the discard pile, two Benched: the pick offers the two Benched Pokémon, not the Active [TA-512]', () => {
    const s = board({ active: mon('a1', KILO, [GRASS]), discard: [WATTREL, WATTREL] },
      { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT]), mon('b3', [BELLSPROUT])] });
    const r = step(s, [UT] as never);
    expect(acts(r).filter(a => a.type === 'choose').map(a => a.target).sort()).toEqual(['b2', 'b3']);
  });
  it('one Wattrel in the discard pile, one Benched: the 10 lands on it with no pick [TA-512]', () => {
    const s = board({ active: mon('a1', KILO, [GRASS]), discard: [WATTREL] },
      { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT])] });
    const r = step(s, [UT] as never);
    expect(r.state.players.B.bench[0].damage).toBe(10);
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.activePlayer).toBe('B');
  });
  it('control: two Wattrel, choose the second Benched: 20 on it, nothing on the Active [TA-512]', () => {
    const s = board({ active: mon('a1', KILO, [GRASS]), discard: [WATTREL, WATTREL] },
      { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT]), mon('b3', [BELLSPROUT])] });
    const r = step(s, [UT, { actor: 'A', type: 'choose', target: 'b3' }] as never);
    expect(r.state.players.B.bench[1].damage).toBe(20);
    expect(r.state.players.B.bench[0].damage).toBe(0);
    expect(r.state.players.B.active!.damage).toBe(0);
  });
});

// ---------------------------------------------------------------- TA-513
describe('TA-513 Spidops ex Wire Hang counts the effective Retreat Cost', () => {
  const SPIDOPS = ['pal-017', 'svi-019'];
  const WH = attack('A', 'a1', 'Wire Hang');
  it('Venusaur ex (printed [C]x4) under Trap Territory (+[C]): 90 + 5 x 30 = 240 [TA-513]', () => {
    const s = board({ active: mon('a1', SPIDOPS, [GRASS, WATER]) }, { active: mon('b1', [BIG]) });
    const r = step(s, [WH] as never);
    expect(r.state.players.B.active!.damage).toBe(240);
  });
  it('Erika\'s Bellsprout (printed [C]) under Trap Territory: 90 + 2 x 30 = 150, a Knock Out [TA-513]', () => {
    const s = board({ active: mon('a1', SPIDOPS, [GRASS, WATER]) },
      { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT])] });
    const r = step(s, [WH] as never);
    expect(damaged(r, 'b1')).toEqual([150]);
  });
  it('control: Trap Territory raises B\'s Retreat Cost: Bellsprout with 1 Energy cannot retreat [TA-513]', () => {
    const s = board({ active: mon('a1', SPIDOPS, [GRASS, WATER]) },
      { active: mon('b1', [BELLSPROUT], [WATER]), bench: [mon('b2', [BELLSPROUT])] }, 'B');
    expect(acts(step(s, [] as never)).some(a => a.type === 'retreat')).toBe(false);
  });
});

// ---------------------------------------------------------------- TA-514
describe('TA-514 Vespiquen ex Healing Pheromone heals a damaged Pokémon only', () => {
  const VESP = ['obf-008', 'obf-096'];
  const HP = attack('A', 'a1', 'Healing Pheromone');
  const B = () => ({ active: mon('b1', [BIG]) });
  it('none of A\'s Pokémon is damaged: no pick, the attack heals nothing and the turn passes [TA-514]', () => {
    const s = board({ active: mon('a1', VESP, [GRASS]), bench: [mon('a2', [BELLSPROUT])] }, B());
    const r = step(s, [HP] as never);
    expect(acts(r).some(a => a.actor === 'A' && a.type !== 'endTurn')).toBe(false);
    expect(r.state.activePlayer).toBe('B');
  });
  it('only the Benched Bellsprout has damage (30): it is healed with no pick [TA-514]', () => {
    const s = board({ active: mon('a1', VESP, [GRASS]), bench: [mon('a2', [BELLSPROUT], [], 30)] }, B());
    const r = step(s, [HP] as never);
    expect(r.state.players.A.bench[0].damage).toBe(0);
    expect(r.state.activePlayer).toBe('B');
  });
  it('two damaged of three: the pick offers exactly the two damaged Pokémon, as a heal [TA-514]', () => {
    const s = board({ active: mon('a1', VESP, [GRASS], 20),
      bench: [mon('a2', [BELLSPROUT]), mon('a3', [BELLSPROUT], [], 40)] }, B());
    const r = step(s, [HP] as never);
    const targets = acts(r).map(a => a.target).sort();
    expect(targets).toEqual(['a1', 'a3']);
    expect(r.pending?.descriptor).toContain('HEAL');
    expect(acts(r).some(a => a.op === 'placeCounters')).toBe(false);
  });
  it('control: two damaged, pick the Benched one: 40 healed off it, the Active keeps its 20 [TA-514]', () => {
    const s = board({ active: mon('a1', VESP, [GRASS], 20),
      bench: [mon('a2', [BELLSPROUT]), mon('a3', [BELLSPROUT], [], 40)] }, B());
    const pick = acts(step(s, [HP] as never)).find(a => a.target === 'a3');
    expect(pick).toBeDefined();
    const r = step(s, [HP, pick] as never);
    expect(r.state.players.A.bench[1].damage).toBe(0);
    expect(r.state.players.A.active!.damage).toBe(20);
  });
});

// ---------------------------------------------------------------- TA-515
describe('TA-515 Arbok ex Menacing Fangs discards into the opponent\'s own discard pile', () => {
  const ARBOK = ['mew-023', 'mew-024'];
  const MF = attack('A', 'a1', 'Menacing Fangs');
  it('B holds exactly 2 cards: both go to B\'s discard pile, none to A\'s [TA-515]', () => {
    const s = board({ active: mon('a1', ARBOK, [DARK, DARK, DARK]) },
      { active: mon('b1', [BIG]), hand: [GRASS, PSYCHIC] });
    const r = step(s, [MF] as never);
    expect(r.state.players.B.hand.map(c => c.iid).filter(i => i.startsWith('bh'))).toEqual([]);
    expect(r.state.players.B.discard.map(c => c.iid).sort()).toEqual(['bh0', 'bh1']);
    expect(r.state.players.A.discard.length).toBe(0);
  });
  it('B holds 1 card: it goes to B\'s discard pile [TA-515]', () => {
    const s = board({ active: mon('a1', ARBOK, [DARK, DARK, DARK]) }, { active: mon('b1', [BIG]), hand: [GRASS] });
    const r = step(s, [MF] as never);
    expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['bh0']);
    expect(r.state.players.A.discard.length).toBe(0);
  });
  it('control: B holds 3 cards: B picks 2, which go to B\'s discard pile [TA-515]', () => {
    const s = board({ active: mon('a1', ARBOK, [DARK, DARK, DARK]) },
      { active: mon('b1', [BIG]), hand: [GRASS, PSYCHIC, WATER] });
    const r0 = step(s, [MF] as never);
    expect(acts(r0).filter(a => a.actor === 'B').length).toBe(3);
    const picks = acts(r0).filter(a => a.target === 'bh0' || a.target === 'bh2');
    let r = r0;
    const done: unknown[] = [MF];
    for (const want of ['bh0', 'bh2']) {
      const p = acts(r).find(a => a.target === want);
      if (p) { done.push(p); r = step(s, done as never); }
    }
    expect(picks.length).toBe(2);
    expect(r.state.players.B.discard.map(c => c.iid).sort()).toEqual(['bh0', 'bh2']);
    expect(r.state.players.A.discard.length).toBe(0);
  });
});

// ---------------------------------------------------------------- TA-516
describe('TA-516 Baxcalibur Super Cold attaches once used (no post-activation decline)', () => {
  const BAX = ['paf-017', 'paf-129', 'pal-060'];
  const USE = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Super Cold' };
  it('one Water in hand, two Pokémon: the pending offers the two attaches and no confirm:false [TA-516]', () => {
    const s = board({ active: mon('a1', BAX, [WATER]), bench: [mon('a2', [BELLSPROUT])], hand: [WATER, GRASS] },
      { active: mon('b1', [BIG]) });
    const r = step(s, [USE] as never);
    expect(acts(r).some(a => a.type === 'confirm')).toBe(false);
    expect(acts(r).filter(a => a.type === 'attachEnergy').map(a => a.target).sort()).toEqual(['a1', 'a2']);
  });
  it('two Water in hand: one use attaches one card, then Super Cold is offered again for the second [TA-516]', () => {
    const s = board({ active: mon('a1', BAX, [WATER]), bench: [mon('a2', [BELLSPROUT])], hand: [WATER, WATER] },
      { active: mon('b1', [BIG]) });
    const r = step(s, [USE, { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a2' }] as never);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ah0']);
    expect(acts(r).some(a => a.type === 'useAbility' && a.ability === 'Super Cold')).toBe(true);
  });
  it('control: attach the one Water to the Benched Bellsprout: it is attached [TA-516]', () => {
    const s = board({ active: mon('a1', BAX, [WATER]), bench: [mon('a2', [BELLSPROUT])], hand: [WATER, GRASS] },
      { active: mon('b1', [BIG]) });
    const r = step(s, [USE, { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a2' }] as never);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ah0']);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ah1']);
  });
});

// ---------------------------------------------------------------- TA-635
describe('TA-635 Larry\'s Staraptor Feathery Strike: Energy choice before the Bench 50', () => {
  const STAR = ['asc-168', 'asc-169', 'asc-170'];
  const FS = attack('A', 'a1', 'Feathery Strike');
  const A = () => ({ active: mon('a1', STAR, [GRASS, GRASS, GRASS]) });
  it('one Benched Pokémon: at the Energy discard pending the Bench is still at 0 and nothing is damaged [TA-635]', () => {
    const s = board(A(), { active: mon('b1', [DONDOZO]), bench: [mon('b2', [BELLSPROUT])] });
    const r = step(s, [FS] as never);
    expect(acts(r).filter(a => a.type === 'discard').length).toBe(3);
    expect(r.state.players.B.bench[0].damage).toBe(0);
    expect(evs(r).some(e => e.kind === 'damaged')).toBe(false);
  });
  it('two Benched Pokémon, the second chosen: at the Energy discard pending the Bench is still at 0 [TA-635]', () => {
    const s = board(A(), { active: mon('b1', [DONDOZO]), bench: [mon('b2', [BELLSPROUT]), mon('b3', [BELLSPROUT])] });
    const r = step(s, [FS, { actor: 'A', type: 'choose', target: 'b3' }] as never);
    expect(acts(r).filter(a => a.type === 'discard').length).toBe(3);
    expect(r.state.players.B.bench[1].damage).toBe(0);
    expect(evs(r).some(e => e.kind === 'damaged')).toBe(false);
  });
  it('control: one Benched, discard the first two Energy: 150 on the Active, then 50 on the Bench, then the discard [TA-635]', () => {
    const s = board(A(), { active: mon('b1', [DONDOZO]), bench: [mon('b2', [BIG])] });
    const r = step(s, [FS, { actor: 'A', type: 'discard', owner: 'A', target: 'a1e0' },
      { actor: 'A', type: 'discard', owner: 'A', target: 'a1e1' }] as never);
    expect(r.state.players.B.active!.damage).toBe(150);
    expect(r.state.players.B.bench[0].damage).toBe(50);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['a1e0', 'a1e1']);
    const order = evs(r).filter(e => (e.kind === 'damaged' && e.target !== 'a1') || (e.kind === 'moved' && (e.card ?? '').startsWith('a1e')))
      .map(e => e.kind === 'damaged' ? e.target : 'moved');
    expect(order).toEqual(['b1', 'b2', 'moved', 'moved']);
  });
});
