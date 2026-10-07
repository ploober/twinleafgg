import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.89 (owner pin 2026-10-06, amends B.85): rulebook Step D, "Make any choices the attack requires you to make", comes
 * before Step F's damage. Every choice the ATTACKING player makes is made there, before the damage: the opponent's cards
 * the attack will move, the destination of a move ("to 1 of their Benched Pokémon"), and a "you may" gate (CF-32: a
 * count-1 / fixed-count may is a standalone confirm). Each card choice is recorded as a `chosen` event; the damage reads
 * the cards where they are (#77); the chosen cards move after the damage, before damage reactions and the Knock Out
 * check (B.89 (4), #1834). B.85 (3)(a) put these picks after the damage; B.89 supersedes it for the attacker's choices.
 *
 * Printed text from card-data/final/<set>.json:
 *
 * TA-655, discard (no gate):
 *   dri-132 Marnie's Scraggy Crunch (50), twm-094 / twm-197 Scream Tail ex Crunch (120), pfl-074 Duraludon Hyper Beam
 *   (70), por-012 / por-100 Decidueye ex Crushing Arrow (240), dri-096 Team Rocket's Tyranitar Demolition Tackle (180),
 *   pbl-061 Shieldon Smithereen Smash (50): "Discard an Energy from your opponent's Active Pokémon."
 * TA-655, move to the opponent's Bench (gate, then the Energy and its destination, all before the damage):
 *   cri-037 Meowstic Tricky Steps (80), dri-070 Team Rocket's Zapdos Jamming Wing (30), tef-104 / tef-193 Gengar ex
 *   Tricky Steps (160), svi-026 Toedscruel Eerie Tentacles (30): "You may move an Energy from your opponent's Active
 *   Pokémon to 1 of their Benched Pokémon."
 * TA-655, to the opponent's hand (gate, then the pick):
 *   svi-015 Meowscarada Trick Cape (40): "You may put an Energy attached to your opponent's Active Pokémon into their hand."
 *   tef-135 Unfezant Opposing Winds (70): "You may put 2 Energy attached to your opponent's Active Pokémon into their hand."
 * TA-652: Eerie Tentacles svi-026 folded its "may" into the move menu (moveEnergy ... | confirm false); CF-32: the gate is
 *   a standalone confirm {true,false}, then the move.
 *
 * Regirock jtg-082 Rock Armor: "If this Pokémon has any Energy attached, it takes 30 less damage from attacks (after
 * applying Weakness and Resistance)."
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const LIGHTNING = 'sve-004';
const PSYCHIC = 'sve-005';
const FIGHTING = 'sve-006';
const DARK = 'sve-007';
const METAL = 'sve-008';
const BIG = 'mew-003';       // Venusaur ex, 340 HP, weakness Fire
const DONDOZO = 'svi-061';   // 160 HP
const REGIROCK = 'jtg-082';  // Rock Armor, 130 HP

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage: 0,
    conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function player(active: PokemonInPlay, bench: PokemonInPlay[], tag: string): PlayerState {
  return { active, bench, hand: cards(`${tag}h`, [GRASS]), deck: cards(`${tag}d`, Array(6).fill(GRASS)), discard: [], lostZone: [],
    prizes: cards(`${tag}p`, Array(6).fill(GRASS)).map(c => ({ ...c, faceUp: false }) as PrizeRef), flags: flags() };
}
/** `attacker` with `energy` into `defender` b1 carrying `bEnergy` (b1e0, b1e1, ...), `benched` Dondozo on B's Bench (b2, b3). */
function board(attacker: string, energy: string[], bEnergy: string[] = [GRASS, PSYCHIC], defender = BIG, benched = 1): NeutralState {
  const bench = Array.from({ length: benched }, (_, i) => mon(`b${i + 2}`, DONDOZO));
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null,
    players: { A: player(mon('a1', attacker, energy), [], 'a'), B: player(mon('b1', defender, bEnergy), bench, 'b') },
  } as NeutralState;
}

const act = (a: object) => a as unknown as NeutralAction;
const attack = (name: string) => act({ actor: 'A', type: 'declareAttack', source: 'a1', name });
const yes = act({ actor: 'A', type: 'confirm', value: true });
const no = act({ actor: 'A', type: 'confirm', value: false });
const discard = (target: string) => act({ actor: 'A', type: 'discard', owner: 'B', target, op: 'discard', destination: 'discardPile' });
const moveTo = (card: string, target: string) => act({ actor: 'A', type: 'moveEnergy', card, source: 'b1', target });
type Ev = { kind: string; target?: string; hp?: number; card?: string };
type Act = { type: string; actor?: string; target?: string; card?: string; value?: unknown };
const evs = (r: ReturnType<typeof step>): Ev[] => (r.events ?? []) as unknown as Ev[];
const acts = (r: ReturnType<typeof step>): Act[] => ((r as any).pending?.legalActions ?? []) as Act[];
const rejected = (r: ReturnType<typeof step>) => r.status === 'invalidAction' ? r : undefined;
const dealt = (r: ReturnType<typeof step>) =>
  evs(r).filter(e => e.kind === 'damaged' && e.target === 'b1').reduce((n, e) => n + (e.hp ?? 0), 0);
/** The pending's offers as `type:card>target` / `type:target` / `type:value`, sorted. */
function menu(r: ReturnType<typeof step>): string[] {
  return acts(r).map(a => a.type === 'confirm' ? `confirm:${a.value}`
    : a.type === 'moveEnergy' ? `moveEnergy:${a.card}>${a.target}` : `${a.type}:${a.target}`).sort();
}
/** chosen / damaged (on b1) / moved (of a b1 Energy), in event order. */
function seq(r: ReturnType<typeof step>): string[] {
  return evs(r).filter(e => e.kind === 'chosen' || (e.kind === 'damaged' && e.target === 'b1')
    || (e.kind === 'moved' && (e.card ?? '').startsWith('b1e')))
    .map(e => e.kind === 'damaged' ? 'damaged' : `${e.kind} ${e.card}`);
}
const energyOf = (r: ReturnType<typeof step>, slot: 'active' | number) => {
  const B = r.state.players.B;
  const s = slot === 'active' ? B.active : B.bench[slot];
  return s ? s.energy.map(e => e.iid).sort() : [];
};
/** The pending's pick offer naming `target` (whatever its verb), as an action. */
function pickOf(r: ReturnType<typeof step>, target: string): NeutralAction {
  const a = acts(r).find(x => x.target === target && x.type !== 'moveEnergy');
  if (a === undefined) { throw new Error(`no pick offer for ${target}: ${JSON.stringify(menu(r))}`); }
  return act({ actor: 'A', ...a });
}

// ================================================================ TA-655: discard an Energy from the opponent's Active
describe('TA-655 (B.89 (1)): "Discard an Energy from your opponent\'s Active Pokémon" picks before the damage, discards after', () => {
  const discarders: Array<[string, string, string[], number]> = [
    ['dri-132', 'Crunch', [DARK, DARK, DARK], 50],
    ['twm-094', 'Crunch', [PSYCHIC, PSYCHIC, PSYCHIC], 120],
    ['twm-197', 'Crunch', [PSYCHIC, PSYCHIC, PSYCHIC], 120],
    ['pfl-074', 'Hyper Beam', [METAL, METAL, METAL], 70],
    ['por-012', 'Crushing Arrow', [GRASS, GRASS, GRASS, GRASS], 240],
    ['por-100', 'Crushing Arrow', [GRASS, GRASS, GRASS, GRASS], 240],
    ['dri-096', 'Demolition Tackle', [FIGHTING, FIGHTING, FIGHTING, FIGHTING], 180],
    ['pbl-061', 'Smithereen Smash', [METAL, METAL], 50],
  ];
  for (const [id, name, energy, dmg] of discarders) {
    it(`${id} ${name}: the Energy pick is asked before the damage, both Energy attached [TA-655]`, () => {
      const r = step(board(id, energy), [attack(name)]);
      expect(rejected(r)).toBeUndefined();
      expect(menu(r)).toEqual(['discard:b1e0', 'discard:b1e1']);
      expect(dealt(r)).toBe(0);
      expect(energyOf(r, 'active')).toEqual(['b1e0', 'b1e1']);
    });
    it(`${id} ${name}: chosen, then ${dmg} damage, then the discard [TA-655]`, () => {
      const r = step(board(id, energy), [attack(name), discard('b1e1')]);
      expect(rejected(r)).toBeUndefined();
      expect(seq(r)).toEqual(['chosen b1e1', 'damaged', 'moved b1e1']);
      expect(dealt(r)).toBe(dmg);
      expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['b1e1']);
      expect(energyOf(r, 'active')).toEqual(['b1e0']);
    });
  }

  it('twm-094 Crunch into Rock Armor with one Energy: the forced pick is chosen, the damage reads it attached (90), then it is discarded [TA-655]', () => {
    const r = step(board('twm-094', [PSYCHIC, PSYCHIC, PSYCHIC], [WATER], REGIROCK), [attack('Crunch')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen b1e0', 'damaged', 'moved b1e0']);
    expect(dealt(r)).toBe(90);
    expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['b1e0']);
  });
  it('control: twm-094 Crunch into a Pokémon with no Energy: no pick, no chosen, 120 damage [TA-655]', () => {
    const r = step(board('twm-094', [PSYCHIC, PSYCHIC, PSYCHIC], []), [attack('Crunch')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['damaged']);
    expect(dealt(r)).toBe(120);
  });
});

// ================================================================ TA-655 / TA-652: move to the opponent's Bench
describe('TA-655 (B.89 (1)): "You may move an Energy from your opponent\'s Active Pokémon to 1 of their Benched Pokémon": the gate, the Energy and its destination before the damage', () => {
  const movers: Array<[string, string, string[], number, string]> = [
    ['cri-037', 'Tricky Steps', [PSYCHIC, PSYCHIC], 80, 'TA-655'],
    ['dri-070', 'Jamming Wing', [LIGHTNING, LIGHTNING], 30, 'TA-655'],
    ['tef-104', 'Tricky Steps', [DARK, DARK], 160, 'TA-655'],
    ['tef-193', 'Tricky Steps', [DARK, DARK], 160, 'TA-655'],
    ['svi-026', 'Eerie Tentacles', [GRASS], 30, 'TA-655'],
  ];
  for (const [id, name, energy, dmg, tag] of movers) {
    it(`${id} ${name}: the "you may" is a standalone confirm, asked before the damage [${tag}]`, () => {
      const r = step(board(id, energy, [GRASS, PSYCHIC], BIG, 2), [attack(name)]);
      expect(rejected(r)).toBeUndefined();
      expect(menu(r)).toEqual(['confirm:false', 'confirm:true']);
      expect(dealt(r)).toBe(0);
    });
    it(`${id} ${name}: yes: the Energy and its destination are asked together, before the damage [${tag}]`, () => {
      const r = step(board(id, energy, [GRASS, PSYCHIC], BIG, 2), [attack(name), yes]);
      expect(rejected(r)).toBeUndefined();
      expect(menu(r)).toEqual(['moveEnergy:b1e0>b2', 'moveEnergy:b1e0>b3', 'moveEnergy:b1e1>b2', 'moveEnergy:b1e1>b3']);
      expect(dealt(r)).toBe(0);
      expect(energyOf(r, 'active')).toEqual(['b1e0', 'b1e1']);
    });
    it(`${id} ${name}: chosen, then ${dmg} damage, then the Energy moves to the chosen Benched Pokémon [${tag}]`, () => {
      const r = step(board(id, energy, [GRASS, PSYCHIC], BIG, 2), [attack(name), yes, moveTo('b1e1', 'b3')]);
      expect(rejected(r)).toBeUndefined();
      expect(seq(r)).toEqual(['chosen b1e1', 'damaged', 'moved b1e1']);
      expect(dealt(r)).toBe(dmg);
      expect(energyOf(r, 1)).toEqual(['b1e1']);
      expect(energyOf(r, 0)).toEqual([]);
      expect(energyOf(r, 'active')).toEqual(['b1e0']);
    });
    it(`${id} ${name}: declined: ${dmg} damage, nothing chosen or moved [${tag}]`, () => {
      const r = step(board(id, energy, [GRASS, PSYCHIC], BIG, 2), [attack(name), no]);
      expect(rejected(r)).toBeUndefined();
      expect(seq(r)).toEqual(['damaged']);
      expect(dealt(r)).toBe(dmg);
      expect(energyOf(r, 'active')).toEqual(['b1e0', 'b1e1']);
    });
  }

  it('svi-026 Eerie Tentacles: the first pending is the gate alone, no moveEnergy folded into it [TA-652]', () => {
    const r = step(board('svi-026', [GRASS]), [attack('Eerie Tentacles')]);
    expect(rejected(r)).toBeUndefined();
    expect(menu(r)).toEqual(['confirm:false', 'confirm:true']);
  });
  it('svi-026 Eerie Tentacles: yes: then the move (one Benched Pokémon: two offers, no decline) [TA-652]', () => {
    const r = step(board('svi-026', [GRASS]), [attack('Eerie Tentacles'), yes]);
    expect(rejected(r)).toBeUndefined();
    expect(menu(r)).toEqual(['moveEnergy:b1e0>b2', 'moveEnergy:b1e1>b2']);
  });
  it('control: svi-026 Eerie Tentacles with no Energy on the opponent\'s Active: no gate (CF-33), 30 damage [TA-652]', () => {
    const r = step(board('svi-026', [GRASS], []), [attack('Eerie Tentacles')]);
    expect(rejected(r)).toBeUndefined();
    expect(acts(r).some(a => a.type === 'confirm' && a.actor === 'A')).toBe(false);
    expect(dealt(r)).toBe(30);
  });

  it('cri-037 Tricky Steps into Rock Armor, one Energy, one Benched: yes collapses the move; chosen, 50 (Rock Armor reads it), then moved [TA-655]', () => {
    const r = step(board('cri-037', [PSYCHIC, PSYCHIC], [WATER], REGIROCK), [attack('Tricky Steps'), yes]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen b1e0', 'damaged', 'moved b1e0']);
    expect(dealt(r)).toBe(50);
    expect(energyOf(r, 0)).toEqual(['b1e0']);
  });
});

// ================================================================ TA-655: to the opponent's hand
describe('TA-655 (B.89 (1)): "You may put [an / 2] Energy attached to your opponent\'s Active Pokémon into their hand": gate and pick before the damage', () => {
  it('svi-015 Trick Cape: the confirm is asked before the damage [TA-655 svi-015]', () => {
    const r = step(board('svi-015', [GRASS]), [attack('Trick Cape')]);
    expect(rejected(r)).toBeUndefined();
    expect(menu(r)).toEqual(['confirm:false', 'confirm:true']);
    expect(dealt(r)).toBe(0);
  });
  it('svi-015 Trick Cape: yes: the Energy pick is asked before the damage [TA-655 svi-015]', () => {
    const r = step(board('svi-015', [GRASS]), [attack('Trick Cape'), yes]);
    expect(rejected(r)).toBeUndefined();
    expect(acts(r).map(a => a.target).sort()).toEqual(['b1e0', 'b1e1']);
    expect(dealt(r)).toBe(0);
  });
  it('svi-015 Trick Cape: chosen, then 40 damage, then the Energy goes to the hand [TA-655 svi-015]', () => {
    const st = board('svi-015', [GRASS]);
    const r0 = step(st, [attack('Trick Cape'), yes]);
    const r = step(st, [attack('Trick Cape'), yes, pickOf(r0, 'b1e1')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen b1e1', 'damaged', 'moved b1e1']);
    expect(dealt(r)).toBe(40);
    expect(r.state.players.B.hand.some(c => c.iid === 'b1e1')).toBe(true);
  });
  // One Energy: the pick is forced and collapses (CF-14). The ChooseEnergyPrompt decomposer names no card for a forced
  // full pick (as Topaz Bolt ssp-057's discard-all, on both engines), so no `chosen` here, unlike the ChooseCardsPrompt
  // forced pick (Crunch above, TA-651's Power Cyclone); the order of the damage and the move is what this cell pins.
  it('svi-015 Trick Cape into Rock Armor, one Energy: yes, the forced pick collapses, 50 (Grass Weakness, Rock Armor reads it), then to the hand [TA-655 svi-015]', () => {
    const r = step(board('svi-015', [GRASS], [WATER], REGIROCK), [attack('Trick Cape'), yes]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r).filter(e => !e.startsWith('chosen'))).toEqual(['damaged', 'moved b1e0']);
    expect(dealt(r)).toBe(50);
    expect(r.state.players.B.hand.some(c => c.iid === 'b1e0')).toBe(true);
  });

  it('tef-135 Opposing Winds: the confirm is asked before the damage [TA-655 tef-135]', () => {
    const r = step(board('tef-135', [GRASS, GRASS], [GRASS, PSYCHIC, WATER]), [attack('Opposing Winds')]);
    expect(rejected(r)).toBeUndefined();
    expect(menu(r)).toEqual(['confirm:false', 'confirm:true']);
    expect(dealt(r)).toBe(0);
  });
  it('tef-135 Opposing Winds: yes: the 2-of-3 pick is asked before the damage [TA-655 tef-135]', () => {
    const r = step(board('tef-135', [GRASS, GRASS], [GRASS, PSYCHIC, WATER]), [attack('Opposing Winds'), yes]);
    expect(rejected(r)).toBeUndefined();
    expect(acts(r).map(a => a.target).sort()).toEqual(['b1e0', 'b1e1', 'b1e2']);
    expect(dealt(r)).toBe(0);
  });
  it('tef-135 Opposing Winds: both chosen, then 70 damage, then both go to the hand [TA-655 tef-135]', () => {
    const st = board('tef-135', [GRASS, GRASS], [GRASS, PSYCHIC, WATER]);
    const r0 = step(st, [attack('Opposing Winds'), yes]);
    const r1 = step(st, [attack('Opposing Winds'), yes, pickOf(r0, 'b1e0')]);
    expect(rejected(r1)).toBeUndefined();
    expect(dealt(r1)).toBe(0);
    const r = step(st, [attack('Opposing Winds'), yes, pickOf(r0, 'b1e0'), pickOf(r1, 'b1e2')]);
    expect(rejected(r)).toBeUndefined();
    expect(seq(r)).toEqual(['chosen b1e0', 'chosen b1e2', 'damaged', 'moved b1e0', 'moved b1e2']);
    expect(dealt(r)).toBe(70);
    expect(r.state.players.B.hand.map(c => c.iid).filter(i => i.startsWith('b1e')).sort()).toEqual(['b1e0', 'b1e2']);
    expect(energyOf(r, 'active')).toEqual(['b1e1']);
  });
});

// ================================================================ copied attack (copy delegation runs afterDamageMoves too)
describe('B.89 through a copied attack: Mew ex mew-151 Genome Hacking copies Demolition Tackle dri-096', () => {
  it('the pick comes before the 180; chosen, damaged, moved, then the Knock Out [TA-655 dri-096]', () => {
    const st = board('mew-151', [GRASS, GRASS, GRASS], [FIGHTING, WATER], 'dri-096');
    const hack = attack('Genome Hacking');
    const r0 = step(st, [hack]);
    expect(rejected(r0)).toBeUndefined();
    expect(menu(r0)).toEqual(['discard:b1e0', 'discard:b1e1']);
    expect(dealt(r0)).toBe(0);
    const r = step(st, [hack, discard('b1e1')]);
    expect(rejected(r)).toBeUndefined();
    const order = evs(r).filter(e => e.kind === 'chosen' || (e.kind === 'damaged' && e.target === 'b1')
      || (e.kind === 'moved' && e.card === 'b1e1') || e.kind === 'ko').map(e => e.kind);
    expect(order).toEqual(['chosen', 'damaged', 'moved', 'ko']);
    expect(r.state.players.B.discard.map(c => c.iid)[0]).toBe('b1e1');
  });
});
