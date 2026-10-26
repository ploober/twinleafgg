import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.89 (owner pin, amends B.85): rulebook Step D, "Make any choices the attack requires you to make", comes before
 * Step F's damage; every choice the ATTACKING player makes is made there, its targets, the cards it will move and the
 * DESTINATION of a move, with a `chosen` event per card choice; the cards move after the damage (Step F).
 *
 * TA-653 (B.89 (1)): "Move [an / a [Water] / 3] Energy from this Pokémon to 1 of your Benched Pokémon." TA-651 chose
 * the Energy before the damage but asked the Benched Pokémon at the move, after it. The destination is a Step-D
 * choice: the Energy and the Benched Pokémon are picked together before the damage, as one
 * `moveEnergy {card, source, target}` per Energy (the joint pick Power Cyclone obf-085 had under TA-494), each
 * recorded as `chosen`; then the damage; then the move. "to 1 of your Benched Pokémon": the first pick fixes the
 * destination for every Energy (Jet Cyclone's three); a pick with one outcome is applied (CF-14). One Benched
 * Pokémon: only the Energy varies. No Benched Pokémon: nothing is asked and the damage lands (#570 / #2118).
 * Printed text, card-data/final/<set>.json:
 *
 *   asc-053 Frosmoth Cold Cyclone (90): "Move a [Water] Energy from this Pokémon to 1 of your Benched Pokémon."
 *   asc-125 / asc-269 / asc-284 / pfl-056 Mega Gengar ex Void Gale (230), cri-019 Keldeo Reflect Energy (70),
 *     jtg-031 / jtg-171 / jtg-182 Volcanion ex Scorching Cyclone (160), pre-032 / twm-077 / twm-196 Iron Thorns ex
 *     Volt Cyclone (140), obf-085 Togekiss Power Cyclone (110): "Move an Energy from this Pokémon to 1 of your
 *     Benched Pokémon."
 *   dri-003 / dri-206 / dri-228 Yanmega ex Jet Cyclone (210): "Move 3 Energy from this Pokémon to 1 of your Benched
 *     Pokémon."
 *
 * TA-654 (B.89 (5)): tef-136 / tef-182 Minccino Cleaning Up (no damage): "Discard up to 2 Pokémon Tools from your
 * opponent's Pokémon." An attack with no damage still makes its Step-D choices first: each Tool picked is `chosen`
 * and stays attached until the effect applies; then the chosen Tools are discarded. The stop (confirm false) ends
 * the picking ("up to 2"). The pick verb stays `discard {target, owner}` (the menu shape is unchanged).
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const WATER = 'sve-003';
const LIGHTNING = 'sve-004';
const DARK = 'sve-007';
const LEGACY = 'twm-167';
const DTE = 'brs-151';
const DONDOZO = 'svi-061';   // 160 HP
const BIG = 'mew-003';       // Venusaur ex, 340 HP

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = [], tools: string[] = []): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: tools.map((t, i) => ({ iid: `${iid}t${i}`, printing: t })),
    damage: 0, conditions: [], markers: markers(),
  };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string): PrizeRef[] {
  return cards(tag, 6, GRASS).map(c => ({ ...c, faceUp: false }));
}
function player(active: PokemonInPlay, bench: PokemonInPlay[], tag: string): PlayerState {
  return { active, bench, hand: [], deck: cards(`${tag}d`, 8, GRASS), discard: [], lostZone: [], prizes: prizes(`${tag}p`), flags: flags() };
}
/** A's attacker (stack `attacker`) with `energy`, `benched` Dondozo on A's Bench (a2, a3, ...), B's Venusaur ex b1. */
function board(attacker: string[], energy: string[], benched = 1): NeutralState {
  const bench = Array.from({ length: benched }, (_, i) => mon(`a${i + 2}`, [DONDOZO]));
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null,
    players: { A: player(mon('a1', attacker, energy), bench, 'a'), B: player(mon('b1', [BIG]), [], 'b') } } as NeutralState;
}

const act = (a: object) => a as unknown as NeutralAction;
const attack = (name: string) => act({ actor: 'A', type: 'declareAttack', source: 'a1', name });
const move = (card: string, target: string) => act({ actor: 'A', type: 'moveEnergy', card, source: 'a1', target });
type Ev = { kind: string; target?: string; hp?: number; card?: string };
const evs = (r: ReturnType<typeof step>): Ev[] => (r.events ?? []) as unknown as Ev[];
const dealt = (r: ReturnType<typeof step>) => evs(r).filter(e => e.kind === 'damaged' && e.target === 'b1')
  .reduce((n, e) => n + (e.hp ?? 0), 0);
const rejected = (r: ReturnType<typeof step>) => r.status === 'invalidAction' ? r : undefined;
type Act = { type: string; target?: string; card?: string; source?: string };
const acts = (r: ReturnType<typeof step>): Act[] => ((r as any).pending?.legalActions ?? []) as Act[];
/** moveEnergy offers as `card>target`, sorted. */
const moveOffers = (r: ReturnType<typeof step>) => acts(r).filter(a => a.type === 'moveEnergy')
  .map(a => `${a.card}>${a.target}`).sort();
const chooseOffers = (r: ReturnType<typeof step>) => acts(r).filter(a => a.type === 'choose');
/** chosen / damaged (on b1) / moved (of an a1 Energy) in event order. */
function seq(r: ReturnType<typeof step>): string[] {
  return evs(r).filter(e => e.kind === 'chosen' || (e.kind === 'damaged' && e.target === 'b1')
    || (e.kind === 'moved' && (e.card ?? '').startsWith('a1e')))
    .map(e => e.kind === 'damaged' ? 'damaged' : `${e.kind} ${e.card}`);
}
const energyOn = (r: ReturnType<typeof step>, i: number) => r.state.players.A.bench[i].energy.map(e => e.iid).sort();
const activeEnergy = (r: ReturnType<typeof step>) => r.state.players.A.active!.energy.map(e => e.iid).sort();

// =============================================================================================== TA-653
describe('TA-653 (B.89 (1)) cri-019 Keldeo Reflect Energy: Energy and Benched Pokémon chosen before the damage', () => {
  it('cri-019, two Benched: the first pending is a joint moveEnergy (Energy x Benched), nothing damaged [TA-653]', () => {
    const r = step(board(['cri-019'], [WATER, WATER], 2), [attack('Reflect Energy')]);
    expect(rejected(r)).toBeUndefined();
    expect(moveOffers(r)).toEqual(['a1e0>a2', 'a1e0>a3', 'a1e1>a2', 'a1e1>a3']);
    expect(chooseOffers(r)).toEqual([]);
    expect(dealt(r)).toBe(0);
  });
  it('cri-019, two Benched: chosen, then 70, then the move to the chosen a3; no destination asked after the damage [TA-653]', () => {
    const r = step(board(['cri-019'], [WATER, WATER], 2), [attack('Reflect Energy'), move('a1e1', 'a3')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e1', 'damaged', 'moved a1e1']);
    expect(dealt(r)).toBe(70);
    expect(moveOffers(r)).toEqual([]);
    expect(energyOn(r, 1)).toEqual(['a1e1']);
    expect(energyOn(r, 0)).toEqual([]);
    expect(activeEnergy(r)).toEqual(['a1e0']);
    expect(r.state.activePlayer).toBe('B');
  });
});

describe('TA-653 (B.89 (1)) Mega Gengar ex Void Gale', () => {
  for (const printing of ['pfl-056', 'asc-125', 'asc-269', 'asc-284']) {
    it(`${printing}, two Benched: the Energy and the destination are asked together before the damage [TA-653]`, () => {
      const r = step(board([printing], [DARK, DARK], 2), [attack('Void Gale')]);
      expect(rejected(r)).toBeUndefined();
      expect(moveOffers(r)).toEqual(['a1e0>a2', 'a1e0>a3', 'a1e1>a2', 'a1e1>a3']);
      expect(dealt(r)).toBe(0);
    });
  }
  it('pfl-056, two Benched: chosen, 230, then the Energy moves to a2 [TA-653]', () => {
    const r = step(board(['pfl-056'], [DARK, DARK], 2), [attack('Void Gale'), move('a1e0', 'a2')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e0', 'damaged', 'moved a1e0']);
    expect(dealt(r)).toBe(230);
    expect(energyOn(r, 0)).toEqual(['a1e0']);
  });
});

describe('TA-653 (B.89 (1)) asc-053 Frosmoth Cold Cyclone: the [W] pool (TA-383) with the destination', () => {
  it('asc-053, two Benched: Legacy Energy and the Water to either Benched, the Fire not; nothing damaged [TA-653]', () => {
    const r = step(board(['asc-053'], [LEGACY, WATER, FIRE], 2), [attack('Cold Cyclone')]);
    expect(rejected(r)).toBeUndefined();
    expect(moveOffers(r)).toEqual(['a1e0>a2', 'a1e0>a3', 'a1e1>a2', 'a1e1>a3']);
    expect(dealt(r)).toBe(0);
  });
  it('asc-053: Legacy Energy to a3: chosen, 90, then the move [TA-653]', () => {
    const r = step(board(['asc-053'], [LEGACY, WATER, FIRE], 2), [attack('Cold Cyclone'), move('a1e0', 'a3')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e0', 'damaged', 'moved a1e0']);
    expect(dealt(r)).toBe(90);
    expect(energyOn(r, 1)).toEqual(['a1e0']);
    expect(activeEnergy(r)).toEqual(['a1e1', 'a1e2']);
  });
});

// TA-769 / B.120 (amended, owner 2026-10-25): the three Energy are picked first, then the one Benched Pokémon they all go
// to (it used to be the first (Energy, Pokémon) pair, fixing the destination for the other two). All of it at Step D
// (B.89 (1)): every pick is `chosen` and stays attached until after the damage.
const pick = (target: string) => act({ actor: 'A', type: 'choose', target });
type ChooseOffer = { type: string; target?: string; recipient?: string };
const chosenOffers = (r: ReturnType<typeof step>) => (chooseOffers(r) as ChooseOffer[])
  .map(a => `${a.target}${a.recipient ? '>' + a.recipient : ''}`).sort();
describe('TA-653 (B.89 (1)) Yanmega ex Jet Cyclone: the three Energy, then the one destination, before the damage', () => {
  const FIVE = [GRASS, GRASS, GRASS, GRASS, GRASS];
  it('dri-003, two Benched: the first pick offers every Energy (no pairs), nothing damaged [TA-653]', () => {
    const r = step(board(['dri-003'], FIVE, 2), [attack('Jet Cyclone')]);
    expect(rejected(r)).toBeUndefined();
    expect(moveOffers(r)).toEqual([]);
    expect(chosenOffers(r)).toEqual(['a1e0', 'a1e1', 'a1e2', 'a1e3', 'a1e4']);
    expect(dealt(r)).toBe(0);
  });
  it('dri-003: after one pick the other four Energy are offered; the pick is chosen and still attached [TA-653]', () => {
    const r = step(board(['dri-003'], FIVE, 2), [attack('Jet Cyclone'), pick('a1e0')]);
    expect(rejected(r)).toBeUndefined();
    expect(chosenOffers(r)).toEqual(['a1e1', 'a1e2', 'a1e3', 'a1e4']);
    expect(seq(r)).toEqual(['chosen a1e0']);
    expect(dealt(r)).toBe(0);
    expect(activeEnergy(r)).toEqual(['a1e0', 'a1e1', 'a1e2', 'a1e3', 'a1e4']);
  });
  it('dri-003: three chosen, then the Pokémon (a3), then 210, then the three move to a3, no pending after the damage [TA-653]', () => {
    const at = step(board(['dri-003'], FIVE, 2), [attack('Jet Cyclone'), pick('a1e0'), pick('a1e2'), pick('a1e4')]);
    expect(chosenOffers(at)).toEqual(['a2', 'a3']);
    expect(dealt(at)).toBe(0);
    const r = step(board(['dri-003'], FIVE, 2), [attack('Jet Cyclone'), pick('a1e0'), pick('a1e2'), pick('a1e4'), pick('a3')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r).slice(0, 4)).toEqual(['chosen a1e0', 'chosen a1e2', 'chosen a1e4', 'damaged']);
    expect(seq(r).slice(4).sort()).toEqual(['moved a1e0', 'moved a1e2', 'moved a1e4']);
    expect(dealt(r)).toBe(210);
    expect(energyOn(r, 1)).toEqual(['a1e0', 'a1e2', 'a1e4']);
    expect(energyOn(r, 0)).toEqual([]);
    expect(activeEnergy(r)).toEqual(['a1e1', 'a1e3']);
    expect(r.state.activePlayer).toBe('B');
  });
  it('dri-003: a (card, Pokémon) pair is refused; a Pokémon named before the cards are picked is refused [TA-653]', () => {
    expect(rejected(step(board(['dri-003'], FIVE, 2), [attack('Jet Cyclone'), move('a1e0', 'a3')]))).toBeDefined();
    expect(rejected(step(board(['dri-003'], FIVE, 2), [attack('Jet Cyclone'), pick('a1e0'), pick('a3')]))).toBeDefined();
  });
  // Jet Cyclone costs [G][G][G][C], so three Energy cards cannot pay it: the all-forced shape (only the Pokémon asked) is
  // not reachable here; with one Benched Pokémon the destination is not asked and each card offer names it (B.116).
  it('dri-003, four Energy, one Benched: each pick names an Energy (recipient a2); three chosen, 210, then the three move [TA-653]', () => {
    const FOUR = [GRASS, GRASS, GRASS, GRASS];
    const r0 = step(board(['dri-003'], FOUR, 1), [attack('Jet Cyclone')]);
    expect(chosenOffers(r0)).toEqual(['a1e0>a2', 'a1e1>a2', 'a1e2>a2', 'a1e3>a2']);
    expect(dealt(r0)).toBe(0);
    const r = step(board(['dri-003'], FOUR, 1), [attack('Jet Cyclone'), pick('a1e3'), pick('a1e1'), pick('a1e0')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r).slice(0, 4)).toEqual(['chosen a1e3', 'chosen a1e1', 'chosen a1e0', 'damaged']);
    expect(seq(r).slice(4).sort()).toEqual(['moved a1e0', 'moved a1e1', 'moved a1e3']);
    expect(energyOn(r, 0)).toEqual(['a1e0', 'a1e1', 'a1e3']);
    expect(activeEnergy(r)).toEqual(['a1e2']);
  });
  for (const printing of ['dri-206', 'dri-228']) {
    it(`${printing}, two Benched: the first pick names an Energy, before the damage [TA-653]`, () => {
      const r = step(board([printing], FIVE, 2), [attack('Jet Cyclone')]);
      expect(chosenOffers(r).length).toBe(5);
      expect(moveOffers(r)).toEqual([]);
      expect(dealt(r)).toBe(0);
    });
  }
});

describe('TA-653 (B.89 (1)) Volcanion ex Scorching Cyclone / Iron Thorns ex Volt Cyclone', () => {
  for (const printing of ['jtg-031', 'jtg-171', 'jtg-182']) {
    it(`${printing}, two Benched: Energy x destination before the damage [TA-653]`, () => {
      const r = step(board([printing], [FIRE, FIRE, FIRE], 2), [attack('Scorching Cyclone')]);
      expect(moveOffers(r)).toEqual(['a1e0>a2', 'a1e0>a3', 'a1e1>a2', 'a1e1>a3', 'a1e2>a2', 'a1e2>a3']);
      expect(dealt(r)).toBe(0);
    });
  }
  for (const printing of ['twm-077', 'pre-032', 'twm-196']) {
    it(`${printing}, two Benched: Energy x destination before the damage [TA-653]`, () => {
      const r = step(board([printing], [LIGHTNING, LIGHTNING, LIGHTNING], 2), [attack('Volt Cyclone')]);
      expect(moveOffers(r)).toEqual(['a1e0>a2', 'a1e0>a3', 'a1e1>a2', 'a1e1>a3', 'a1e2>a2', 'a1e2>a3']);
      expect(dealt(r)).toBe(0);
    });
  }
  it('twm-077: the Double Turbo Energy to a3: chosen, its 20 less still applies (120), then it moves [TA-653]', () => {
    const r = step(board(['twm-077'], [LIGHTNING, DTE], 2), [attack('Volt Cyclone'), move('a1e1', 'a3')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e1', 'damaged', 'moved a1e1']);
    expect(dealt(r)).toBe(120);
    expect(energyOn(r, 1)).toEqual(['a1e1']);
  });
});

describe('TA-653 (B.89 (1)) obf-085 Togekiss Power Cyclone', () => {
  const TOGEKISS = ['obf-083', 'obf-084', 'obf-085'];
  it('obf-085, two Benched: Energy x destination before the damage; then chosen, 110, moved to a3 [TA-653]', () => {
    const r0 = step(board(TOGEKISS, [GRASS, GRASS], 2), [attack('Power Cyclone')]);
    expect(moveOffers(r0)).toEqual(['a1e0>a2', 'a1e0>a3', 'a1e1>a2', 'a1e1>a3']);
    expect(dealt(r0)).toBe(0);
    const r = step(board(TOGEKISS, [GRASS, GRASS], 2), [attack('Power Cyclone'), move('a1e0', 'a3')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e0', 'damaged', 'moved a1e0']);
    expect(energyOn(r, 1)).toEqual(['a1e0']);
  });
});

describe('TA-653 controls (CF-14 collapses, #570 / #2118)', () => {
  it('control: one Benched Pokémon, two Energy: only the Energy varies, offered with the one destination [TA-653]', () => {
    const r = step(board(['cri-019'], [WATER, WATER], 1), [attack('Reflect Energy')]);
    expect(moveOffers(r)).toEqual(['a1e0>a2', 'a1e1>a2']);
    expect(dealt(r)).toBe(0);
  });
  // Togekiss pays Power Cyclone's [C][C] with one Double Turbo Energy (110 - 20 = 90).
  // TA-660 / B.93: a forced pick (CF-14) is no decision, so no `chosen`; the move still comes after the damage.
  it('control: one Energy, one Benched (obf-085): nothing to decide; 90, then moved, no chosen [TA-653]', () => {
    const r = step(board(['obf-083', 'obf-084', 'obf-085'], [DTE], 1), [attack('Power Cyclone')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['damaged', 'moved a1e0']);
    expect(dealt(r)).toBe(90);
    expect(moveOffers(r)).toEqual([]);   // the next pending is Precious Gift's end-of-turn confirm
  });
  it('control: no Benched Pokémon: nothing asked, the damage lands, the Energy stays [TA-653]', () => {
    const r = step(board(['cri-019'], [WATER, WATER], 0), [attack('Reflect Energy')]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r)).toBe(70);
    expect(acts(r).filter(a => a.type === 'moveEnergy' || a.type === 'choose')).toEqual([]);
    expect(activeEnergy(r)).toEqual(['a1e0', 'a1e1']);
  });
});

// =============================================================================================== TA-654
/** A's Minccino a1; B's Active Rotom ex pfl-029 (Multi Adapter) with 2 Tools, B's Bench svi-070 with 2 Tools. */
function tools(minccino: string): NeutralState {
  const A = player(mon('a1', [minccino], [WATER, WATER]), [], 'a');
  const B = player(mon('b1', ['pfl-029'], [LIGHTNING], ['svi-193', 'svi-197']), [mon('bb1', ['svi-070'], [], ['svi-169', 'svi-174'])], 'b');
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main',
    outcome: 'ongoing', stadium: null, players: { A, B } } as NeutralState;
}
const cleaningUp = attack('Cleaning Up');
const discard = (target: string) => act({ actor: 'A', type: 'discard', target, owner: 'B' });
const stop = act({ actor: 'A', type: 'confirm', value: false });
const toolsOf = (r: ReturnType<typeof step>) => ({
  active: r.state.players.B.active?.tools.map(t => t.iid) ?? [],
  bench: r.state.players.B.bench[0]?.tools.map(t => t.iid) ?? [],
  discard: r.state.players.B.discard.map(c => c.iid).sort(),
});
/** chosen / moved of a B Tool, in event order. */
const toolSeq = (r: ReturnType<typeof step>) => evs(r)
  .filter(e => (e.kind === 'chosen' || e.kind === 'moved') && /^b(b1|1)t/.test(e.card ?? ''))
  .map(e => `${e.kind} ${e.card}`);

for (const minccino of ['tef-136', 'tef-182']) {
  describe(`TA-654 (B.89 (5)) ${minccino} Minccino Cleaning Up: both Tools chosen first, then discarded`, () => {
    it(`${minccino}: after the first pick the Tool is chosen and still attached; the menu is unchanged [TA-654]`, () => {
      const r = step(tools(minccino), [cleaningUp, discard('b1t0')]);
      expect(rejected(r)).toBeUndefined();
      expect(toolsOf(r)).toEqual({ active: ['b1t0', 'b1t1'], bench: ['bb1t0', 'bb1t1'], discard: [] });
      expect(toolSeq(r)).toEqual(['chosen b1t0']);
      const offered = acts(r).map(a => a.type === 'discard' ? `discard:${a.target}` : a.type).sort();
      expect(offered).toEqual(['confirm', 'discard:b1t1', 'discard:bb1t0', 'discard:bb1t1']);
    });
    it(`${minccino}: both picks are chosen before either Tool is discarded [TA-654]`, () => {
      const r = step(tools(minccino), [cleaningUp, discard('b1t0'), discard('bb1t1')]);
      expect(rejected(r)).toBeUndefined();
      const s = toolSeq(r);
      expect(s.slice(0, 2)).toEqual(['chosen b1t0', 'chosen bb1t1']);
      expect(s.slice(2).sort()).toEqual(['moved b1t0', 'moved bb1t1']);
      expect(toolsOf(r)).toEqual({ active: ['b1t1'], bench: ['bb1t0'], discard: ['b1t0', 'bb1t1'] });
      expect(r.state.activePlayer).toBe('B');
    });
    it(`${minccino}: one pick then the stop: chosen, then that Tool alone is discarded [TA-654]`, () => {
      const r = step(tools(minccino), [cleaningUp, discard('bb1t1'), stop]);
      expect(rejected(r)).toBeUndefined();
      expect(toolSeq(r)).toEqual(['chosen bb1t1', 'moved bb1t1']);
      expect(toolsOf(r)).toEqual({ active: ['b1t0', 'b1t1'], bench: ['bb1t0'], discard: ['bb1t1'] });
    });
    it(`control ${minccino}: the stop at once discards nothing and records nothing [TA-654]`, () => {
      const r = step(tools(minccino), [cleaningUp, stop]);
      expect(rejected(r)).toBeUndefined();
      expect(toolSeq(r)).toEqual([]);
      expect(toolsOf(r)).toEqual({ active: ['b1t0', 'b1t1'], bench: ['bb1t0', 'bb1t1'], discard: [] });
    });
  });
}
