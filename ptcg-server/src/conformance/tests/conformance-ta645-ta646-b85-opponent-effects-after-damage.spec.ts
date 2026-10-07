import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.85 (3)(a) (owner pin, 2026-10-06): an attack's effects on the OPPONENT's cards in play and on the opponent's hand,
 * the decision (the attacker's choice, a random pick, the opponent's own choice) AND the move, happen after the attack's
 * damage, in printed order, unless the text says "Before doing damage" or the damage depends on the decision. A pick made
 * after the damage moves its card at the pick: no `chosen` event (B.85 (3)(d)). Damage reactions still resolve after all
 * of the attack's effects (B.53 / B.85 (4)); Knock Outs last.
 *
 * Printed text from card-data/final/<set>.json:
 *
 * TA-645 (the opponent's cards in play): twinleaf asked the pick before the damage and moved after it.
 *   dri-096 Team Rocket's Tyranitar Demolition Tackle (180): "Discard an Energy from your opponent's Active Pokémon."
 *   pbl-061 Shieldon Smithereen Smash (50): "Discard an Energy from your opponent's Active Pokémon."
 *   svi-015 Meowscarada Trick Cape (40): "You may put an Energy attached to your opponent's Active Pokémon into their hand."
 *   svi-026 Toedscruel Eerie Tentacles (30): "You may move an Energy from your opponent's Active Pokémon to 1 of their
 *     Benched Pokémon."
 *
 * TA-646 (the opponent's hand): twinleaf discarded before the damage.
 *   pal-092 Gothitelle Psych Out (120); pre-034 / pre-155 / svp-175 Espeon ex Psych Out (160); asc-134 Scraggy Knock Off
 *     (20); cri-041 / cri-102 Gourgeist ex Ghostly Touch (140): "Discard a random card from your opponent's hand."
 *   asc-135 / asc-270 / asc-285 Mega Scrafty ex Outlaw Leg (160): "Discard a random card from your opponent's hand.
 *     Discard the top card of your opponent's deck."
 *   mew-024 / mew-185 Arbok ex Menacing Fangs (150): "Your opponent discards 2 cards from their hand."
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const WATER = 'sve-003';
const PSYCHIC = 'sve-005';
const FIGHTING = 'sve-006';
const DARK = 'sve-007';
const METAL = 'sve-008';
const BIG = 'mew-003';       // Venusaur ex, 340 HP, weakness Fire
const DONDOZO = 'svi-061';   // 160 HP

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
function player(active: PokemonInPlay, bench: PokemonInPlay[], hand: string[], tag: string): PlayerState {
  return { active, bench, hand: cards(`${tag}h`, hand), deck: cards(`${tag}d`, Array(6).fill(GRASS)), discard: [], lostZone: [],
    prizes: cards(`${tag}p`, Array(6).fill(GRASS)).map(c => ({ ...c, faceUp: false }) as PrizeRef), flags: flags() };
}
/** `attacker` with `energy` into Venusaur ex b1 (Grass b1e0 + Psychic b1e1), Dondozo b2 on the Bench, B holds `hand`. */
function board(attacker: string, energy: string[], hand: string[] = [GRASS]): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null,
    players: { A: player(mon('a1', attacker, energy), [], [], 'a'), B: player(mon('b1', BIG, [GRASS, PSYCHIC]), [mon('b2', DONDOZO)], hand, 'b') },
  } as NeutralState;
}

const act = (a: object) => a as unknown as NeutralAction;
const attack = (name: string) => act({ actor: 'A', type: 'declareAttack', source: 'a1', name });
type Ev = { kind: string; target?: string; hp?: number; card?: string };
type Act = { type: string; actor?: string; target?: string; card?: string; value?: unknown };
const evs = (r: ReturnType<typeof step>): Ev[] => (r.events ?? []) as unknown as Ev[];
const acts = (r: ReturnType<typeof step>): Act[] => ((r as any).pending?.legalActions ?? []) as Act[];
const rejected = (r: ReturnType<typeof step>) => r.status === 'invalidAction' ? r : undefined;
const dealt = (r: ReturnType<typeof step>, iid: string) =>
  evs(r).filter(e => e.kind === 'damaged' && e.target === iid).reduce((n, e) => n + (e.hp ?? 0), 0);
/** `damaged` on b1 ('d'), `moved` of any card whose iid starts with one of `prefixes` ('m'), in event order. */
function order(r: ReturnType<typeof step>, prefixes: string[]): string[] {
  return evs(r).filter(e => (e.kind === 'damaged' && e.target === 'b1')
    || (e.kind === 'moved' && prefixes.some(p => (e.card ?? '').startsWith(p))))
    .map(e => e.kind === 'damaged' ? 'd' : 'm');
}
const chosen = (r: ReturnType<typeof step>) => evs(r).filter(e => e.kind === 'chosen');
function energyOf(r: ReturnType<typeof step>, slot: 'active' | 0): string[] {
  const B = r.state.players.B;
  const s = slot === 'active' ? B.active : B.bench[0];
  return s ? s.energy.map(e => e.iid) : [];
}

// ================================================================ TA-645: the opponent's cards in play
// B.89 (owner 2026-10-06) supersedes B.85 (3)(a) for the ATTACKER's choices: the pick (and a "you may" gate, and a move's
// destination) is made at rulebook Step D, before the damage, recorded as `chosen`; the card still moves after the damage
// (TA-655). These cells pinned the B.85 order (damage, then the pick, the move at the pick, no chosen) and were rewritten
// to B.89; conformance-ta655-ta652-b89-step-d-opponent-picks.spec.ts holds the full set. The TA-646 hand cells below
// (random picks and the opponent's own choice, B.89 (3)) are unchanged.
describe('TA-645 under B.89: the pick of the opponent\'s Energy is asked before the damage (chosen), the move comes after it', () => {
  const discard = (target: string) => act({ actor: 'A', type: 'discard', owner: 'B', target, op: 'discard', destination: 'discardPile' });

  const discarders: Array<[string, string, string[], number]> = [
    ['dri-096', 'Demolition Tackle', [FIGHTING, FIGHTING, FIGHTING, FIGHTING], 180],
    ['pbl-061', 'Smithereen Smash', [METAL, METAL], 50],
  ];
  for (const [id, name, energy, dmg] of discarders) {
    it(`${id} ${name}: at the Energy pick no damage is done yet and both Energy are attached (${id}) [TA-645]`, () => {
      const r = step(board(id, energy), [attack(name)]);
      expect(rejected(r)).toBeUndefined();
      expect(acts(r).filter(a => a.type === 'discard').map(a => a.target).sort()).toEqual(['b1e0', 'b1e1']);
      expect(dealt(r, 'b1')).toBe(0);
      expect(energyOf(r, 'active')).toEqual(['b1e0', 'b1e1']);
    });
    it(`${id} ${name}: chosen, then the ${dmg} damage, then the discard (${id}) [TA-645]`, () => {
      const r = step(board(id, energy), [attack(name), discard('b1e1')]);
      expect(rejected(r)).toBeUndefined();
      expect(order(r, ['b1e'])).toEqual(['d', 'm']);
      expect(chosen(r).map(e => e.card)).toEqual(['b1e1']);
      expect(dealt(r, 'b1')).toBe(dmg);
      expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['b1e1']);
      expect(energyOf(r, 'active')).toEqual(['b1e0']);
    });
  }

  it('svi-015 Trick Cape: at the "you may" no damage is done yet [TA-645 svi-015]', () => {
    const r = step(board('svi-015', [GRASS]), [attack('Trick Cape')]);
    expect(rejected(r)).toBeUndefined();
    expect(acts(r).some(a => a.type === 'confirm')).toBe(true);
    expect(dealt(r, 'b1')).toBe(0);
    expect(energyOf(r, 'active')).toEqual(['b1e0', 'b1e1']);
  });
  it('svi-015 Trick Cape: chosen, then the damage, then the Energy to the hand [TA-645 svi-015]', () => {
    const st = board('svi-015', [GRASS]);
    let r = step(st, [attack('Trick Cape'), act({ actor: 'A', type: 'confirm', value: true })]);
    const done: NeutralAction[] = [attack('Trick Cape'), act({ actor: 'A', type: 'confirm', value: true })];
    const pick = acts(r).find(a => a.card === 'b1e1' || a.target === 'b1e1');
    if (pick) { done.push(act(pick)); r = step(st, done); }
    expect(rejected(r)).toBeUndefined();
    expect(order(r, ['b1e'])).toEqual(['d', 'm']);
    expect(chosen(r).map(e => e.card)).toEqual(['b1e1']);
    expect(r.state.players.B.hand.some(c => c.iid === 'b1e1')).toBe(true);
  });

  // TA-652 (CF-32): the "you may" is a standalone confirm, then the move (Energy and destination), all before the damage.
  it('svi-026 Eerie Tentacles: at the gate and at the move pick no damage is done yet [TA-645 svi-026]', () => {
    const r0 = step(board('svi-026', [GRASS]), [attack('Eerie Tentacles')]);
    expect(rejected(r0)).toBeUndefined();
    expect(acts(r0).map(a => a.type)).toEqual(['confirm', 'confirm']);
    expect(dealt(r0, 'b1')).toBe(0);
    const r = step(board('svi-026', [GRASS]), [attack('Eerie Tentacles'), act({ actor: 'A', type: 'confirm', value: true })]);
    expect(rejected(r)).toBeUndefined();
    expect(acts(r).some(a => a.type === 'moveEnergy')).toBe(true);
    expect(dealt(r, 'b1')).toBe(0);
    expect(energyOf(r, 'active')).toEqual(['b1e0', 'b1e1']);
  });
  it('svi-026 Eerie Tentacles: chosen, then the damage, then the Energy to the Bench [TA-645 svi-026]', () => {
    const r = step(board('svi-026', [GRASS]), [attack('Eerie Tentacles'), act({ actor: 'A', type: 'confirm', value: true }),
      act({ actor: 'A', type: 'moveEnergy', card: 'b1e1', source: 'b1', target: 'b2' })]);
    expect(rejected(r)).toBeUndefined();
    expect(order(r, ['b1e'])).toEqual(['d', 'm']);
    expect(chosen(r).map(e => e.card)).toEqual(['b1e1']);
    expect(energyOf(r, 0)).toEqual(['b1e1']);
  });
});

// ================================================================ TA-646: the opponent's hand
describe('TA-646 (B.85 (3)(a)): the opponent\'s hand is discarded after the damage', () => {
  const random: Array<[string, string, string[], number]> = [
    ['pal-092', 'Psych Out', [PSYCHIC, PSYCHIC], 120],
    ['pre-034', 'Psych Out', [PSYCHIC, PSYCHIC, PSYCHIC], 160],
    ['pre-155', 'Psych Out', [PSYCHIC, PSYCHIC, PSYCHIC], 160],
    ['svp-175', 'Psych Out', [PSYCHIC, PSYCHIC, PSYCHIC], 160],
    ['asc-134', 'Knock Off', [DARK, DARK], 20],
    ['cri-041', 'Ghostly Touch', [PSYCHIC, PSYCHIC], 140],
    ['cri-102', 'Ghostly Touch', [PSYCHIC, PSYCHIC], 140],
  ];
  for (const [id, name, energy, dmg] of random) {
    it(`${id} ${name}: one card in hand: ${dmg} damage, then the card is discarded (${id}) [TA-646]`, () => {
      const r = step(board(id, energy, [WATER]), [attack(name)]);
      expect(rejected(r)).toBeUndefined();
      expect(dealt(r, 'b1')).toBe(dmg);
      expect(order(r, ['bh'])).toEqual(['d', 'm']);
      expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['bh0']);
    });
  }

  for (const id of ['asc-135', 'asc-270', 'asc-285']) {
    it(`${id} Outlaw Leg: 160 damage, then the hand card, then the top card of the deck (${id}) [TA-646]`, () => {
      const r = step(board(id, [DARK, DARK, DARK], [WATER]), [attack('Outlaw Leg')]);
      expect(rejected(r)).toBeUndefined();
      expect(dealt(r, 'b1')).toBe(160);
      expect(order(r, ['bh', 'bd0'])).toEqual(['d', 'm', 'm']);
      expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['bh0', 'bd0']);
    });
  }

  for (const id of ['mew-024', 'mew-185']) {
    it(`${id} Menacing Fangs: three cards in hand: at the opponent's pick the 150 damage is done (${id}) [TA-646]`, () => {
      const r = step(board(id, [DARK, DARK, DARK], [GRASS, FIRE, WATER]), [attack('Menacing Fangs')]);
      expect(rejected(r)).toBeUndefined();
      expect(acts(r).filter(a => a.actor === 'B').length).toBe(3);
      expect(dealt(r, 'b1')).toBe(150);
      expect(r.state.players.B.hand.length).toBe(3);
    });
    it(`${id} Menacing Fangs: two cards in hand: 150 damage, then both are discarded (${id}) [TA-646]`, () => {
      const r = step(board(id, [DARK, DARK, DARK], [GRASS, FIRE]), [attack('Menacing Fangs')]);
      expect(rejected(r)).toBeUndefined();
      expect(dealt(r, 'b1')).toBe(150);
      expect(order(r, ['bh'])[0]).toBe('d');
      expect(r.state.players.B.discard.map(c => c.iid).sort()).toEqual(['bh0', 'bh1']);
    });
  }
});

// ================================================================ copied attacks (blast radius: AFTER_ATTACK through the copy delegation)
describe('B.85 (3)(a) through a copied attack: Mew ex mew-151 Genome Hacking ("Choose 1 of your opponent\'s Active Pokémon\'s attacks and use it as this attack.")', () => {
  /** Mew ex a1 with three Grass into `defender` b1 (with `energy`), B holds `hand`. */
  function copyBoard(defender: string, energy: string[], hand: string[]): NeutralState {
    const st = board('mew-151', [GRASS, GRASS, GRASS], hand);
    st.players.B.active = mon('b1', defender, energy);
    return st;
  }
  const hack = attack('Genome Hacking');
  const pickAttack = (name: string) => act({ actor: 'A', type: 'choose', target: 'b1', name });

  it('copied Menacing Fangs mew-024, two cards in hand: 150 damage, then both are discarded [TA-646 mew-024]', () => {
    const r = step(copyBoard('mew-024', [], [GRASS, FIRE]), [hack, pickAttack('Menacing Fangs')]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r, 'b1')).toBe(150);
    expect(order(r, ['bh'])).toEqual(['d', 'm', 'm']);
    expect(r.state.players.B.discard.map(c => c.iid).sort()).toEqual(['bh0', 'bh1']);
  });
  it('copied Demolition Tackle dri-096 (its only attack, no attack pick): at the Energy pick no damage is done yet (B.89); chosen, damage, discard, Knock Out [TA-645 dri-096]', () => {
    const st = copyBoard('dri-096', [FIGHTING, WATER], []);
    const r0 = step(st, [hack]);
    expect(rejected(r0)).toBeUndefined();
    expect(acts(r0).filter(a => a.type === 'discard').map(a => a.target).sort()).toEqual(['b1e0', 'b1e1']);
    expect(dealt(r0, 'b1')).toBe(0);
    const r = step(st, [hack,
      act({ actor: 'A', type: 'discard', owner: 'B', target: 'b1e1', op: 'discard', destination: 'discardPile' })]);
    expect(rejected(r)).toBeUndefined();
    // 180 Knocks Out the 180-HP Tyranitar: the Step-D pick, the damage, the picked Energy discarded, then the Knock Out.
    const seq = evs(r).filter(e => e.kind === 'chosen' || (e.kind === 'damaged' && e.target === 'b1')
      || (e.kind === 'moved' && e.card === 'b1e1') || e.kind === 'ko').map(e => e.kind);
    expect(seq).toEqual(['chosen', 'damaged', 'moved', 'ko']);
    expect(r.state.players.B.discard.map(c => c.iid)[0]).toBe('b1e1');
  });
});
