import { step } from '../driver';
import {
  NeutralState, NeutralEvent, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-494's split (2026-10-05): the in-pool family-A attacks that moved cards in play BEFORE their damage. B.82 (1) (the
 * attacker's own cards: choose, damage, move) and B.84 (1) (the opponent's cards: the move after the damage, before
 * Knock Outs; #77 "the damage reduction happens first and then apply any attack effects"). B.84 (3), WHEN a choice of an
 * opponent's card is asked, is not decided: where a card asked its choice before the damage it still does; only the
 * MOVE goes after the damage. A choice gated by the effect's own coin comes after the damage under either reading
 * (B.84 (3), #571), as Ekans mew-023 / Tympole obf-050 (cdg7). Printed text from card-data/final/<set>.json:
 *
 *   cri-056 Trubbish Acid Spray: "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
 *   par-142 Porygon Data Displacement: "Flip a coin. If heads, move an Energy from your opponent's Active Pokémon to 1 of
 *     their Benched Pokémon." The move is mandatory (it offered a decline, min 0).
 *   pbl-061 Shieldon Smithereen Smash: "Discard an Energy from your opponent's Active Pokémon."
 *   obf-085 Togekiss Power Cyclone: "Move an Energy from this Pokémon to 1 of your Benched Pokémon." (B.82: own Energy)
 *   dri-042 Blaziken Inferno Kick Flurry: "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of
 *     your opponent's Benched Pokémon." The Bench 120 was placed at the Bench pick, before the Energy choice (TA-635's
 *     shape; Larry's Staraptor asc-170 is the fixed pattern): the choices first, then the damage, then the discard.
 *
 * Regirock jtg-082 Rock Armor: "If this Pokémon has any Energy attached, it takes 30 less damage from attacks (after
 * applying Weakness and Resistance)." Double Turbo Energy brs-151: "The attacks of the Pokémon this card is attached to do
 * 20 less damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const DARK = 'sve-007';
const METAL = 'sve-008';
const DTE = 'brs-151';
const DONDOZO = 'svi-061';   // 160 HP
const BIG = 'mew-003';       // Venusaur ex, 340 HP
const REGIROCK = 'jtg-082';  // Rock Armor

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
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string): PrizeRef[] {
  return cards(tag, 6, GRASS).map(c => ({ ...c, faceUp: false }));
}
function player(active: PokemonInPlay, bench: PokemonInPlay[], tag: string): PlayerState {
  return { active, bench, hand: [], deck: cards(`${tag}d`, 6, GRASS), discard: [], lostZone: [], prizes: prizes(`${tag}p`), flags: flags() };
}
function board(aActive: PokemonInPlay, aBench: PokemonInPlay[], bActive: PokemonInPlay, bBench: PokemonInPlay[] = []): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null, players: { A: player(aActive, aBench, 'a'), B: player(bActive, bBench, 'b') } } as NeutralState;
}

const act = (a: object) => a as unknown as NeutralAction;
const attack = (name: string) => act({ actor: 'A', type: 'declareAttack', source: 'a1', name });
const HEADS = act({ actor: 'system', type: 'flip', face: 'heads' });
type Ev = { kind: string; target?: string; hp?: number; card?: string };
const evs = (r: ReturnType<typeof step>): Ev[] => (r.events ?? []) as unknown as Ev[];
const dealt = (events: NeutralEvent[], iid: string) => (events as unknown as Ev[])
  .filter(e => e.kind === 'damaged' && e.target === iid).reduce((n, e) => n + (e.hp ?? 0), 0);
const rejected = (r: ReturnType<typeof step>) => r.status === 'invalidAction' ? r : undefined;
type Act = { type: string; actor?: string; target?: string; card?: string; value?: unknown };
const acts = (r: ReturnType<typeof step>): Act[] => ((r as any).pending?.legalActions ?? []) as Act[];
const flipPending = (r: ReturnType<typeof step>) => acts(r).some(a => a.type === 'flip');
/** damaged on `target` and moved of any card in `moved`, in event order ('d' / 'm'). */
function order(r: ReturnType<typeof step>, target: string, moved: string[]): string[] {
  return evs(r).filter(e => (e.kind === 'damaged' && e.target === target) || (e.kind === 'moved' && moved.includes(e.card ?? '')))
    .map(e => e.kind === 'damaged' ? 'd' : 'm');
}

// ---------------------------------------------------------------- cri-056 Trubbish
describe('TA-494 cri-056 Trubbish Acid Spray: the flip and the discard after the damage', () => {
  const s = (bEnergy: string[]) => board(mon('a1', ['cri-056'], [DARK]), [], mon('b1', [BIG], bEnergy));
  it('the 10 damage is on the Defending Pokémon at the flip [TA-494 cri-056]', () => {
    const r = step(s([GRASS]), [attack('Acid Spray')]);
    expect(flipPending(r)).toBe(true);
    expect(r.state.players.B.active!.damage).toBe(10);
  });
  it('Rock Armor with 1 Energy: 0 damage, then heads discards the Energy [TA-494 cri-056]', () => {
    const st = board(mon('a1', ['cri-056'], [DARK]), [], mon('b1', [REGIROCK], [GRASS]));
    const r = step(st, [attack('Acid Spray'), HEADS]);
    expect(rejected(r)).toBeUndefined();
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['b1e0']);
  });
  it('control: heads with 1 Energy: the Energy is discarded and 10 is done [TA-494 cri-056]', () => {
    const r = step(s([GRASS]), [attack('Acid Spray'), HEADS]);
    expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['b1e0']);
    expect(r.state.players.B.active!.damage).toBe(10);
  });
});

// ---------------------------------------------------------------- par-142 Porygon
describe('TA-494 par-142 Porygon Data Displacement: flip and move after the damage; the move is mandatory', () => {
  const s = (def = BIG, two = false) => board(mon('a1', ['par-142'], [GRASS]), [], mon('b1', [def], [GRASS]),
    two ? [mon('b2', [DONDOZO]), mon('b3', [DONDOZO])] : [mon('b2', [DONDOZO])]);
  it('the 10 damage is on the Defending Pokémon at the flip [TA-494 par-142]', () => {
    const r = step(s(), [attack('Data Displacement')]);
    expect(flipPending(r)).toBe(true);
    expect(r.state.players.B.active!.damage).toBe(10);
  });
  it('heads, two Benched Pokémon: the move offers no decline [TA-494 par-142]', () => {
    const r = step(s(BIG, true), [attack('Data Displacement'), HEADS]);
    expect(acts(r).some(a => a.type === 'moveEnergy')).toBe(true);
    expect(acts(r).some(a => a.type === 'confirm' && a.value === false)).toBe(false);
  });
  it('Rock Armor with 1 Energy, heads: 0 damage, then the Energy moves to the Bench [TA-494 par-142]', () => {
    const r = step(s(REGIROCK), [attack('Data Displacement'), HEADS]); // one Energy, one Benched: the move is forced
    expect(rejected(r)).toBeUndefined();
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.players.B.bench[0].energy.map(e => e.iid)).toEqual(['b1e0']);
  });
  it('control: heads, move the Energy to the second Benched: 10 on the Active, the Energy on it [TA-494 par-142]', () => {
    const r = step(s(BIG, true), [attack('Data Displacement'), HEADS,
      act({ actor: 'A', type: 'moveEnergy', card: 'b1e0', source: 'b1', target: 'b3' })]);
    expect(rejected(r)).toBeUndefined();
    expect(r.state.players.B.active!.damage).toBe(10);
    expect(r.state.players.B.bench[1].energy.map(e => e.iid)).toEqual(['b1e0']);
    expect(order(r, 'b1', ['b1e0'])).toEqual(['d', 'm']);
  });
});

// ---------------------------------------------------------------- pbl-061 Shieldon
describe('TA-494 pbl-061 Shieldon Smithereen Smash: the Energy is discarded after the damage', () => {
  const SHIELDON = ['pbl-072', 'pbl-061'];
  it('Rock Armor with 1 Energy: 20 damage, then the Energy is discarded [TA-494 pbl-061]', () => {
    const st = board(mon('a1', SHIELDON, [METAL, METAL]), [], mon('b1', [REGIROCK], [GRASS]));
    const r = step(st, [attack('Smithereen Smash')]); // one Energy: no which-choice, the discard is forced
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(20);
    expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['b1e0']);
    expect(order(r, 'b1', ['b1e0'])).toEqual(['d', 'm']);
  });
  it('control: the choice is asked before the damage (B.89 Step D, TA-655; the discard still follows the damage) [TA-494 pbl-061]', () => {
    const st = board(mon('a1', SHIELDON, [METAL, METAL]), [], mon('b1', [BIG], [GRASS, GRASS]));
    const r = step(st, [attack('Smithereen Smash')]);
    expect(acts(r).filter(a => a.type === 'discard').length).toBe(2);
    expect(dealt(r.events, 'b1')).toBe(0);
  });
});

// ---------------------------------------------------------------- obf-085 Togekiss
describe('TA-494 obf-085 Togekiss Power Cyclone: its own Energy moves after the damage (B.82)', () => {
  const TOGEKISS = ['obf-083', 'obf-084', 'obf-085'];
  const s = (energy: string[]) => board(mon('a1', TOGEKISS, energy), [mon('a2', [DONDOZO])], mon('b1', [BIG]));
  const move = (card: string) => act({ actor: 'A', type: 'moveEnergy', card, source: 'a1', target: 'a2' });
  it('moving the Double Turbo Energy: its 20 less still applies, 90 damage [TA-494 obf-085]', () => {
    const r = step(s([DTE]), [attack('Power Cyclone')]); // one Energy, one Benched: forced
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(90);
    expect(r.state.players.A.bench[0].energy.map(e => e.iid)).toEqual(['a1e0']);
    expect(order(r, 'b1', ['a1e0'])).toEqual(['d', 'm']);
    expect(evs(r).filter(e => e.kind === 'chosen').map(e => e.card)).toEqual(['a1e0']);
  });
  // TA-653 / B.89 (1): the Energy and its Benched Pokémon are one joint moveEnergy pick before the damage (TA-494's shape,
  // restored; TA-651 had split off the destination to after the damage). One Benched Pokémon here: two offers.
  it('control: the choice is asked before the damage, then 110 and the move [TA-494 obf-085]', () => {
    const r0 = step(s([GRASS, GRASS]), [attack('Power Cyclone')]);
    expect(acts(r0).filter(a => a.type === 'moveEnergy').length).toBe(2);
    expect(dealt(r0.events, 'b1')).toBe(0);
    const r = step(s([GRASS, GRASS]), [attack('Power Cyclone'), move('a1e1')]);
    expect(dealt(r.events, 'b1')).toBe(110);
    // B.82 (3): the pick is recorded as `chosen` (the card still attached), then the damage, then its `moved` leg.
    const seq = evs(r).filter(e => e.kind === 'chosen' || (e.kind === 'damaged' && e.target === 'b1')
      || (e.kind === 'moved' && e.card === 'a1e1')).map(e => e.kind);
    expect(seq).toEqual(['chosen', 'damaged', 'moved']);
    expect(r.state.players.A.bench[0].energy.map(e => e.iid)).toEqual(['a1e1']);
  });
});

// ---------------------------------------------------------------- dri-042 Blaziken
describe('TA-494 dri-042 Blaziken Inferno Kick Flurry: Energy choice before the Bench 120', () => {
  const BLAZIKEN = ['dri-040', 'dri-041', 'dri-042'];
  const IKF = attack('Inferno Kick Flurry');
  const s = (bench: PokemonInPlay[]) => board(mon('a1', BLAZIKEN, [FIRE, FIRE, FIRE]), [], mon('b1', [DONDOZO]), bench);
  it('one Benched Pokémon: at the Energy discard pending nothing is damaged [TA-494 dri-042]', () => {
    const r = step(s([mon('b2', [DONDOZO])]), [IKF]);
    expect(acts(r).filter(a => a.type === 'discard').length).toBe(3);
    expect(r.state.players.B.bench[0].damage).toBe(0);
    expect(evs(r).some(e => e.kind === 'damaged')).toBe(false);
  });
  it('two Benched Pokémon, the second chosen: at the Energy discard pending the Bench is still at 0 [TA-494 dri-042]', () => {
    const r = step(s([mon('b2', [DONDOZO]), mon('b3', [DONDOZO])]), [IKF, act({ actor: 'A', type: 'choose', target: 'b3' })]);
    expect(acts(r).filter(a => a.type === 'discard').length).toBe(3);
    expect(r.state.players.B.bench[1].damage).toBe(0);
    expect(evs(r).some(e => e.kind === 'damaged')).toBe(false);
  });
  it('control: discard two: 120 on the Active, then 120 on the Bench, then the discard [TA-494 dri-042]', () => {
    const r = step(s([mon('b2', [BIG])]), [IKF, act({ actor: 'A', type: 'discard', owner: 'A', target: 'a1e0' }),
      act({ actor: 'A', type: 'discard', owner: 'A', target: 'a1e1' })]);
    expect(rejected(r)).toBeUndefined();
    expect(r.state.players.B.active!.damage).toBe(120);
    expect(r.state.players.B.bench[0].damage).toBe(120);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['a1e0', 'a1e1']);
    const seq = evs(r).filter(e => (e.kind === 'damaged' && e.target !== 'a1') || (e.kind === 'moved' && (e.card ?? '').startsWith('a1e')))
      .map(e => e.kind === 'damaged' ? e.target : 'moved');
    expect(seq).toEqual(['b1', 'b2', 'moved', 'moved']);
  });
});
