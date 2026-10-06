import { step } from '../driver';
import {
  NeutralState, NeutralEvent, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-562 / B.53 (#2172: "The step to check for effects that activate when a Pokemon is damaged by an attack occurs after
 * the step to check for effects other than damage"; Advanced Rulebook II E-03) / B.84 (2) (#674, #2012: a card the
 * attack's effect moved does not react to that attack's damage).
 *
 * An attack that deals its damage inline, from inside its own effect (APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS, or a hand-rolled
 * `new DealDamageEffect(effect, effect.damage)` before a prompt), raised its AfterDamageEffect before the CF-74 hold-back
 * was armed, so "when damaged by an attack" reactions resolved BEFORE the attack's remaining effects.
 *
 * Chesnaught cri-007 Needly Armor: "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's
 * Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon for each [G] Energy
 * attached to this Pokémon."
 * Iron Jugulis tef-139 Automated Combat: "If this Pokémon is in the Active Spot and is damaged by an attack from your
 * opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon."
 * Scream Tail ex twm-094 Crunch (120): "Discard an Energy from your opponent's Active Pokémon."
 * Pikachu ex ssp-057 Topaz Bolt (300): "Discard 3 Energy from this Pokémon."
 */

const GRASS = 'sve-001';
const LIGHTNING = 'sve-004';
const PSYCHIC = 'sve-005';
const METAL = 'sve-008';
const CHESNAUGHT = 'cri-007';   // 180 HP
const JUGULIS = 'tef-139';      // 130 HP
const DONDOZO = 'svi-061';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function slot(iid: string, printing: string, energy: CardRef[], damage = 0): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy, tools: [], damage, conditions: [],
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
function board(A: PlayerState, B: PlayerState): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null, players: { A, B } } as NeutralState;
}

/** Scream Tail ex twm-094 with [P][P][P] into `defender` carrying `energy` (b1e0, b1e1, ...). */
function crunchBoard(defender: string, energy: string[], b1Damage = 0): NeutralState {
  const A = player(slot('a1', 'twm-094', cards('ae', 3, PSYCHIC)), [], 'a');
  const B = player(slot('b1', defender, energy.map((printing, i) => ({ iid: `b1e${i}`, printing })), b1Damage),
    [slot('b2', DONDOZO, [])], 'b');
  return board(A, B);
}
/** Pikachu ex ssp-057 with [G][L][M][L] into Iron Jugulis. */
function topazBoard(): NeutralState {
  const A = player(slot('a1', 'ssp-057', [GRASS, LIGHTNING, METAL, LIGHTNING].map((printing, i) => ({ iid: `ae${i}`, printing }))), [], 'a');
  const B = player(slot('b1', JUGULIS, []), [slot('b2', DONDOZO, [])], 'b');
  return board(A, B);
}

const act = (a: object) => a as unknown as NeutralAction;
const attack = (name: string) => act({ actor: 'A', type: 'declareAttack', source: 'a1', name });
const discardB = (target: string) => act({ actor: 'A', type: 'discard', owner: 'B', target, op: 'discard', destination: 'discardPile' });
const discardA = (target: string) => act({ actor: 'A', type: 'discard', owner: 'A', target, op: 'discard', destination: 'discardPile' });

type Damaged = { kind: string; target?: string; hp?: number };
const dealt = (events: NeutralEvent[], iid: string) => (events as Damaged[])
  .filter(e => e.kind === 'damaged' && e.target === iid).reduce((n, e) => n + (e.hp ?? 0), 0);
const rejected = (r: ReturnType<typeof step>) => r.status === 'invalidAction' ? r : undefined;
function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.target].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
function inDiscard(r: ReturnType<typeof step>, who: 'A' | 'B', iid: string): boolean {
  return (r.state.players[who].discard as CardRef[]).some(c => c.iid === iid);
}

describe('TA-562: a reaction to an attack\'s inline damage resolves after the attack\'s own effects (B.53, #2172)', () => {
  it('Crunch discards Chesnaught\'s Grass Energy: Needly Armor counts none, no counters on Scream Tail [TA-562]', () => {
    const r = step(crunchBoard(CHESNAUGHT, [GRASS, PSYCHIC]), [attack('Crunch'), discardB('b1e0')]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(120);
    expect(inDiscard(r, 'B', 'b1e0')).toBe(true);
    expect(dealt(r.events, 'a1')).toBe(0);
    expect(r.state.players.A.active?.damage).toBe(0);
  });

  it('Knock Out, Crunch discards Chesnaught\'s Grass Energy: Needly Armor counts none [TA-562]', () => {
    const r = step(crunchBoard(CHESNAUGHT, [GRASS, PSYCHIC], 100), [attack('Crunch'), discardB('b1e0')]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(120);
    expect(r.state.players.A.active?.damage).toBe(0);
  });

  it('control: Crunch discards the Psychic Energy, the Grass stays, Needly Armor puts 3 counters on Scream Tail [TA-562]', () => {
    const r = step(crunchBoard(CHESNAUGHT, [GRASS, PSYCHIC]), [attack('Crunch'), discardB('b1e1')]);
    expect(rejected(r)).toBeUndefined();
    expect(inDiscard(r, 'B', 'b1e1')).toBe(true);
    expect(r.state.players.A.active?.damage).toBe(30);
  });

  it('Crunch into Iron Jugulis: at the open discard pick no counters on Scream Tail yet [TA-562]', () => {
    const r = step(crunchBoard(JUGULIS, [PSYCHIC, PSYCHIC]), [attack('Crunch')]);
    expect(legal(r)).toEqual(['A:discard:b1e0', 'A:discard:b1e1']);
    expect(dealt(r.events, 'b1')).toBe(120);
    expect(dealt(r.events, 'a1')).toBe(0);
    expect(r.state.players.A.active?.damage).toBe(0);
  });

  it('Crunch into Iron Jugulis: Automated Combat puts 3 counters on Scream Tail after the discard [TA-562]', () => {
    const r = step(crunchBoard(JUGULIS, [PSYCHIC, PSYCHIC]), [attack('Crunch'), discardB('b1e0')]);
    expect(rejected(r)).toBeUndefined();
    expect(inDiscard(r, 'B', 'b1e0')).toBe(true);
    expect(r.state.players.A.active?.damage).toBe(30);
  });

  it('control, normal damage step: Crunch into an Iron Jugulis with no Energy (no inline damage) still punishes [TA-562]', () => {
    const r = step(crunchBoard(JUGULIS, []), [attack('Crunch')]);
    expect(rejected(r)).toBeUndefined();
    expect(dealt(r.events, 'b1')).toBe(120);
    expect(r.state.players.A.active?.damage).toBe(30);
  });

  it('Topaz Bolt into Iron Jugulis: at the open discard choice no counters on Pikachu ex [TA-562]', () => {
    const r = step(topazBoard(), [attack('Topaz Bolt')]);
    expect(legal(r)).toEqual(['A:discard:ae0', 'A:discard:ae1', 'A:discard:ae2', 'A:discard:ae3']);
    expect(dealt(r.events, 'a1')).toBe(0);
    expect(r.state.players.A.active?.damage).toBe(0);
  });

  it('Topaz Bolt into Iron Jugulis: Knock Out, 3 Energy discarded, 3 counters on Pikachu ex after the discard [TA-562]', () => {
    const r = step(topazBoard(), [attack('Topaz Bolt'), discardA('ae0'), discardA('ae1'), discardA('ae2')]);
    expect(rejected(r)).toBeUndefined();
    expect(['ae0', 'ae1', 'ae2'].every(c => inDiscard(r, 'A', c))).toBe(true);
    expect(r.state.players.A.active?.damage).toBe(30);
  });
});
