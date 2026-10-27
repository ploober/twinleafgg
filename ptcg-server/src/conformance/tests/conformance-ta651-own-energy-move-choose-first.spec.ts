import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-651 (B.82 (1), B.85 (1)(c)): an attack that moves the ATTACKER's OWN Energy to its Bench chooses the Energy
 * before the damage (a `chosen` event at the pick), the damage reads it still attached, and it moves after the
 * damage, before damage reactions and the Knock Out check (#2002: "You first CHOOSE the energy ..., then do the
 * damage ..., and THEN discard the energy"; #1834). TA-653 / B.89 (1) (2026-10-06): the Benched Pokémon that receives
 * it is a Step-D choice too, so each pick is a joint `moveEnergy {card, source, target}` before the damage (recorded as
 * `chosen`); the first pick fixes the one destination. These cells were rewritten from TA-651's `choose`-then-
 * destination-after-the-damage shape (the B.85 reading B.89 superseded); the facts they pin (Energy chosen before the
 * damage, read attached by it, moved after it) are unchanged. The destination cells proper are in
 * conformance-ta653-ta654-b89-destination-and-no-damage-picks.spec.ts.
 * Printed text from card-data/final/<set>.json:
 *
 *   asc-053 Frosmoth Cold Cyclone (90): "Move a [Water] Energy from this Pokémon to 1 of your Benched Pokémon."
 *   asc-125 / asc-269 / asc-284 / pfl-056 Mega Gengar ex Void Gale (230): "Move an Energy from this Pokémon to 1 of
 *     your Benched Pokémon."
 *   cri-019 Keldeo Reflect Energy (70), jtg-031 / jtg-171 / jtg-182 Volcanion ex Scorching Cyclone (160),
 *     pre-032 / twm-077 / twm-196 Iron Thorns ex Volt Cyclone (140): the same text.
 *   dri-003 / dri-206 / dri-228 Yanmega ex Jet Cyclone (210): "Move 3 Energy from this Pokémon to 1 of your Benched
 *     Pokémon." Three picks, one Energy each; the first fixes the one destination for all three.
 *   obf-085 Togekiss Power Cyclone (110): "Move an Energy from this Pokémon to 1 of your Benched Pokémon." TA-494's joint
 *     (Energy, Benched Pokémon) moveEnergy before the damage, which B.89 restores for all 16.
 *
 * Legacy Energy twm-167: "it provides every type of Energy but provides only 1 Energy at a time." Double Turbo Energy
 * brs-151: "The attacks of the Pokémon this card is attached to do 20 less damage to your opponent's Pokémon (before
 * applying Weakness and Resistance)."
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

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = []): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string): PrizeRef[] {
  return cards(tag, 6, GRASS).map(c => ({ ...c, faceUp: false }));
}
function player(active: PokemonInPlay, bench: PokemonInPlay[], tag: string): PlayerState {
  return { active, bench, hand: [], deck: cards(`${tag}d`, 6, GRASS), discard: [], lostZone: [], prizes: prizes(`${tag}p`), flags: flags() };
}
/** A's attacker `printing` with `energy`, `benched` Dondozo on A's Bench (a2, a3, ...), B's Venusaur ex b1. */
function board(printing: string, energy: string[], benched = 1): NeutralState {
  const bench = Array.from({ length: benched }, (_, i) => mon(`a${i + 2}`, [DONDOZO]));
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null,
    players: { A: player(mon('a1', [printing], energy), bench, 'a'), B: player(mon('b1', [BIG]), [], 'b') } } as NeutralState;
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
/** The Energy the pending's moveEnergy offers name, sorted and distinct. */
const chooseTargets = (r: ReturnType<typeof step>) => [...new Set(acts(r).filter(a => a.type === 'moveEnergy')
  .map(a => a.card ?? ''))].sort();
/** moveEnergy offers as `card>target`, sorted. */
const moveOffers = (r: ReturnType<typeof step>) => acts(r).filter(a => a.type === 'moveEnergy')
  .map(a => `${a.card}>${a.target}`).sort();
/** chosen / damaged (on b1) / moved (of an a1 Energy) in event order. */
function seq(r: ReturnType<typeof step>): string[] {
  return evs(r).filter(e => e.kind === 'chosen' || (e.kind === 'damaged' && e.target === 'b1')
    || (e.kind === 'moved' && (e.card ?? '').startsWith('a1e')))
    .map(e => e.kind === 'damaged' ? 'damaged' : `${e.kind} ${e.card}`);
}
const energyOn = (r: ReturnType<typeof step>, i: number) => r.state.players.A.bench[i].energy.map(e => e.iid).sort();
const activeEnergy = (r: ReturnType<typeof step>) => r.state.players.A.active!.energy.map(e => e.iid).sort();

// ---------------------------------------------------------------- cri-019 Keldeo Reflect Energy
describe('TA-651 cri-019 Keldeo Reflect Energy: choose the Energy (and its destination), then the damage, then the move', () => {
  it('cri-019: the Energy is asked before the damage [TA-651]', () => {
    const r = step(board('cri-019', [WATER, WATER], 2), [attack('Reflect Energy')]);
    expect(rejected(r)).toBeUndefined();
    expect(chooseTargets(r)).toEqual(['a1e0', 'a1e1']);
    expect(dealt(r)).toBe(0);
  });
  it('cri-019, two Benched: chosen, then 70 with the Energy still attached, then the move [TA-651]', () => {
    const r = step(board('cri-019', [WATER, WATER], 2), [attack('Reflect Energy'), move('a1e1', 'a3')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e1', 'damaged', 'moved a1e1']);
    expect(dealt(r)).toBe(70);
  });
  it('cri-019, two Benched: the chosen Energy moves to the second Benched Pokémon after the damage [TA-651]', () => {
    const r = step(board('cri-019', [WATER, WATER], 2), [attack('Reflect Energy'), move('a1e1', 'a3')]);
    expect(rejected(r)).toBeUndefined();
    expect(energyOn(r, 1)).toEqual(['a1e1']);
    expect(activeEnergy(r)).toEqual(['a1e0']);
  });
});

// ---------------------------------------------------------------- Mega Gengar ex Void Gale
describe('TA-651 Mega Gengar ex Void Gale: choose the Energy, then the damage, then the move', () => {
  it('pfl-056, one Benched: chosen, 230, then the Energy moves (destination forced) [TA-651]', () => {
    const r = step(board('pfl-056', [DARK, DARK], 1), [attack('Void Gale'), chooseAct('a1e0')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e0', 'damaged', 'moved a1e0']);
    expect(dealt(r)).toBe(230);
    expect(energyOn(r, 0)).toEqual(['a1e0']);
  });
  for (const printing of ['pfl-056', 'asc-125', 'asc-269', 'asc-284']) {
    it(`${printing}: the Energy is asked before the damage [TA-651]`, () => {
      const r = step(board(printing, [DARK, DARK], 1), [attack('Void Gale')]);
      expect(chooseOffers(r)).toEqual(['a1e0>a2', 'a1e1>a2']);   // TA-786 / SR-6: one Benched Pokémon, the recipient
      expect(moveOffers(r)).toEqual([]);
      expect(dealt(r)).toBe(0);
    });
  }
});

// ---------------------------------------------------------------- asc-053 Frosmoth Cold Cyclone
describe('TA-651 asc-053 Frosmoth Cold Cyclone: choose a [W] Energy first (TA-383 pool kept)', () => {
  it('asc-053: Legacy Energy and the Water are offered before the damage, the Fire is not [TA-651]', () => {
    const r = step(board('asc-053', [LEGACY, WATER, FIRE], 1), [attack('Cold Cyclone')]);
    expect(rejected(r)).toBeUndefined();
    expect(chooseOffers(r)).toEqual(['a1e0>a2', 'a1e1>a2']);   // TA-786 / SR-6: one Benched Pokémon, the recipient
    expect(dealt(r)).toBe(0);
  });
  it('asc-053: choosing Legacy Energy: chosen, 90, then it moves to the Bench [TA-651]', () => {
    const r = step(board('asc-053', [LEGACY, WATER, FIRE], 1), [attack('Cold Cyclone'), chooseAct('a1e0')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e0', 'damaged', 'moved a1e0']);
    expect(dealt(r)).toBe(90);
    expect(energyOn(r, 0)).toEqual(['a1e0']);
    expect(activeEnergy(r)).toEqual(['a1e1', 'a1e2']);
  });
});

// ---------------------------------------------------------------- Yanmega ex Jet Cyclone
// TA-769 / B.120 (amended, owner 2026-10-25): "Move 3 Energy from this Pokémon to 1 of your Benched Pokémon" asks the
// three Energy first (choose {target: card}), then the one Benched Pokémon they all go to (choose {target: pokemon});
// with one Benched Pokémon it is not asked and each card offer names it (recipient, B.116). The (card, Pokémon) pairs
// this block pinned before are gone.
const chooseAct = (target: string) => act({ actor: 'A', type: 'choose', target });
type Choose = { type: string; target?: string; op?: string; recipient?: string };
/** choose offers as `target` (with `>recipient` where the offer carries one), sorted. */
const chooseOffers = (r: ReturnType<typeof step>) => (acts(r) as Choose[]).filter(a => a.type === 'choose')
  .map(a => `${a.target}${a.recipient ? '>' + a.recipient : ''}`).sort();
describe('TA-651 Yanmega ex Jet Cyclone: three Energy chosen one at a time, then the damage, then the move', () => {
  const FIVE = [GRASS, GRASS, GRASS, GRASS, GRASS];
  it('dri-003: the first pick is asked before the damage, one Energy per pick [TA-651]', () => {
    const r = step(board('dri-003', FIVE, 2), [attack('Jet Cyclone')]);
    expect(rejected(r)).toBeUndefined();
    expect(chooseOffers(r)).toEqual(['a1e0', 'a1e1', 'a1e2', 'a1e3', 'a1e4']);
    expect(moveOffers(r)).toEqual([]);
    expect(dealt(r)).toBe(0);
  });
  it('dri-003: after one pick the other four are offered, the pick is chosen, nothing is damaged [TA-651]', () => {
    const r = step(board('dri-003', FIVE, 2), [attack('Jet Cyclone'), chooseAct('a1e0')]);
    expect(rejected(r)).toBeUndefined();
    expect(chooseOffers(r)).toEqual(['a1e1', 'a1e2', 'a1e3', 'a1e4']);
    expect(seq(r)).toEqual(['chosen a1e0']);
    expect(activeEnergy(r)).toEqual(['a1e0', 'a1e1', 'a1e2', 'a1e3', 'a1e4']);
  });
  it('dri-003, two Benched: three chosen, then the Pokémon, 210, then the three move; nothing is asked after the damage [TA-651]', () => {
    const r = step(board('dri-003', FIVE, 2), [attack('Jet Cyclone'), chooseAct('a1e0'), chooseAct('a1e1'), chooseAct('a1e2'), chooseAct('a3')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r).slice(0, 4)).toEqual(['chosen a1e0', 'chosen a1e1', 'chosen a1e2', 'damaged']);
    expect(dealt(r)).toBe(210);
    expect(moveOffers(r)).toEqual([]);
  });
  it('dri-003, two Benched: the three Energy first, then the one Benched Pokémon they all go to (B.120) [TA-769 dri-003]', () => {
    const one = step(board('dri-003', FIVE, 2), [attack('Jet Cyclone'), chooseAct('a1e1')]);
    expect(chooseOffers(one)).toEqual(['a1e0', 'a1e2', 'a1e3', 'a1e4']);
    const three = step(board('dri-003', FIVE, 2), [attack('Jet Cyclone'), chooseAct('a1e1'), chooseAct('a1e0'), chooseAct('a1e2')]);
    expect(chooseOffers(three)).toEqual(['a2', 'a3']);
    expect(dealt(three)).toBe(0);
    const done = step(board('dri-003', FIVE, 2), [attack('Jet Cyclone'), chooseAct('a1e1'), chooseAct('a1e0'), chooseAct('a1e2'), chooseAct('a3')]);
    expect(rejected(done)).toBeUndefined();
    expect(energyOn(done, 1)).toEqual(['a1e0', 'a1e1', 'a1e2']);
    expect(energyOn(done, 0)).toEqual([]);
    expect(activeEnergy(done)).toEqual(['a1e3', 'a1e4']);
  });
  it('dri-003: a (card, Pokémon) pair is not offered and is refused (B.120) [TA-769 dri-003 pair refused]', () => {
    expect(step(board('dri-003', FIVE, 2), [attack('Jet Cyclone'), move('a1e0', 'a2')]).status).toBe('invalidAction');
  });
  it('dri-003, one Benched: the Pokémon is not asked, each card offer names it; the three move after the 210 [TA-651]', () => {
    const first = step(board('dri-003', FIVE, 1), [attack('Jet Cyclone')]);
    expect(chooseOffers(first)).toEqual(['a1e0>a2', 'a1e1>a2', 'a1e2>a2', 'a1e3>a2', 'a1e4>a2']);
    const r = step(board('dri-003', FIVE, 1), [attack('Jet Cyclone'), chooseAct('a1e0'), chooseAct('a1e2'), chooseAct('a1e4')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r).slice(0, 4)).toEqual(['chosen a1e0', 'chosen a1e2', 'chosen a1e4', 'damaged']);
    expect(seq(r).slice(4).sort()).toEqual(['moved a1e0', 'moved a1e2', 'moved a1e4']);
    expect(energyOn(r, 0)).toEqual(['a1e0', 'a1e2', 'a1e4']);
    expect(activeEnergy(r)).toEqual(['a1e1', 'a1e3']);
  });
  for (const printing of ['dri-206', 'dri-228']) {
    it(`${printing}: the first pick is asked before the damage [TA-651]`, () => {
      const r = step(board(printing, FIVE, 1), [attack('Jet Cyclone')]);
      expect(chooseOffers(r).length).toBe(5);
      expect(dealt(r)).toBe(0);
    });
  }
});

// ---------------------------------------------------------------- Volcanion ex Scorching Cyclone
describe('TA-651 Volcanion ex Scorching Cyclone: choose the Energy, then the damage, then the move', () => {
  it('jtg-031, one Benched: chosen, 160 (x2 Weakness), then the Energy moves [TA-651]', () => {
    const r = step(board('jtg-031', [FIRE, FIRE, FIRE], 1), [attack('Scorching Cyclone'), chooseAct('a1e2')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e2', 'damaged', 'moved a1e2']);
    expect(dealt(r)).toBe(320);   // 160, Venusaur ex is weak to [R]
    expect(energyOn(r, 0)).toEqual(['a1e2']);
  });
  for (const printing of ['jtg-031', 'jtg-171', 'jtg-182']) {
    it(`${printing}: the Energy is asked before the damage [TA-651]`, () => {
      const r = step(board(printing, [FIRE, FIRE, FIRE], 1), [attack('Scorching Cyclone')]);
      expect(chooseOffers(r)).toEqual(['a1e0>a2', 'a1e1>a2', 'a1e2>a2']);   // TA-786 / SR-6
      expect(dealt(r)).toBe(0);
    });
  }
});

// ---------------------------------------------------------------- Iron Thorns ex Volt Cyclone
describe('TA-651 Iron Thorns ex Volt Cyclone: choose the Energy, then the damage, then the move', () => {
  it('twm-077: moving the Double Turbo Energy: chosen, its 20 less still applies (120), then it moves [TA-651]', () => {
    const r = step(board('twm-077', [LIGHTNING, DTE], 1), [attack('Volt Cyclone'), chooseAct('a1e1')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e1', 'damaged', 'moved a1e1']);
    expect(dealt(r)).toBe(120);
    expect(energyOn(r, 0)).toEqual(['a1e1']);
  });
  for (const printing of ['twm-077', 'pre-032', 'twm-196']) {
    it(`${printing}: the Energy is asked before the damage [TA-651]`, () => {
      const r = step(board(printing, [LIGHTNING, LIGHTNING, LIGHTNING], 1), [attack('Volt Cyclone')]);
      expect(chooseOffers(r)).toEqual(['a1e0>a2', 'a1e1>a2', 'a1e2>a2']);   // TA-786 / SR-6
      expect(dealt(r)).toBe(0);
    });
  }
});

// ---------------------------------------------------------------- obf-085 Togekiss Power Cyclone
describe('TA-651 obf-085 Togekiss Power Cyclone: the Energy and the Benched Pokémon before the damage (B.89)', () => {
  const TOGEKISS = ['obf-083', 'obf-084', 'obf-085'];
  const s = () => ({ ...board('obf-085', [], 2), players: { ...board('obf-085', [], 2).players,
    A: { ...board('obf-085', [], 2).players.A, active: mon('a1', TOGEKISS, [GRASS, GRASS]) } } }) as NeutralState;
  it('obf-085: the joint moveEnergy is asked before the damage, no separate choose [TA-651]', () => {
    const r = step(s(), [attack('Power Cyclone')]);
    expect(rejected(r)).toBeUndefined();
    expect(acts(r).filter(a => a.type === 'choose')).toEqual([]);
    expect(moveOffers(r)).toEqual(['a1e0>a2', 'a1e0>a3', 'a1e1>a2', 'a1e1>a3']);
    expect(dealt(r)).toBe(0);
  });
  it('obf-085, two Benched: chosen, 110, then the move to a3 [TA-651]', () => {
    const r = step(s(), [attack('Power Cyclone'), move('a1e0', 'a3')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen a1e0', 'damaged', 'moved a1e0']);
    expect(energyOn(r, 1)).toEqual(['a1e0']);
  });
});

// ---------------------------------------------------------------- controls
describe('TA-651 controls', () => {
  it('control: no Benched Pokémon: nothing is asked, the damage lands, the Energy stays [TA-651]', () => {
    const r = step(board('cri-019', [WATER, WATER], 0), [attack('Reflect Energy')]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r)).toBe(70);
    expect(chooseTargets(r)).toEqual([]);
    expect(activeEnergy(r)).toEqual(['a1e0', 'a1e1']);
  });
});
