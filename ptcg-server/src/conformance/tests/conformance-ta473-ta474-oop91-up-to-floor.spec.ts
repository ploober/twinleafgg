import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * The "up to X" floor (B.18 / #2301: an attack's "up to X" is 0..X; any other effect's is 1..X) and the count-1
 * "may" (CF-32: "you may move AN Energy" has no inherent zero, so the may-gate is the only decline and surfaces as a
 * standalone confirm{true,false}).
 *
 * TA-473 — Raichu mew-026 Electrical Grounding (Ability): "you may move a [L] Energy" -> confirm first; on yes the
 *          move is 1 (a single candidate collapses, CF-14); on no nothing moves.
 * TA-474 — Veluza par-054 Fillet Memento (Ability): "move up to 2 [W] Energy ... to your Benched Pokémon" -> 1..2,
 *          so one [W] and one bencher is a forced move that collapses; no decline.
 * OOP-91 — Poppy obf-193 (Supporter): "Move up to 2 Energy from 1 of your Pokémon to another" -> 1..2, no decline.
 *
 * Mutation guards: min back to 0 on Veluza / Poppy reds their cells; dropping Raichu's ConfirmPrompt reds its cells.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const LIGHTNING = 'sve-004';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = [], damage = 0): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function deck(tag: string) {
  return Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
/** B's Pouncing Trap (asc-062) KOs A's damaged Active; A's Ability triggers in the KO window. */
function koBoard(aActive: PokemonInPlay, aBench: PokemonInPlay[]): NeutralState {
  const A: PlayerState = { active: aActive, bench: aBench, hand: [{ iid: 'ah0', printing: WATER }], deck: deck('a'),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', 'asc-062', [LIGHTNING]), bench: [], hand: [{ iid: 'bh0', printing: WATER }], deck: deck('b'),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'B', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
function poppyBoard(bench: PokemonInPlay[]): NeutralState {
  const A: PlayerState = { active: mon('a0', 'twm-118', [WATER]), bench, hand: [{ iid: 'ah0', printing: 'obf-193' }], deck: deck('a'),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b0', 'twm-118'), bench: [], hand: [], deck: deck('b'),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const pouncingTrap = act({ actor: 'B', type: 'declareAttack', source: 'b1', name: 'Pouncing Trap' });
const yes = act({ actor: 'A', type: 'confirm', value: true });
const no = act({ actor: 'A', type: 'confirm', value: false });
const poppy = act({ actor: 'A', type: 'playSupporter', card: 'ah0' });

function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.card, a.target, a.value].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
function energyOn(r: ReturnType<typeof step>, iid: string): string[] {
  const A = r.state.players.A;
  const slot = [A.active, ...A.bench].find(s => s && s.stack.some(c => c.iid === iid));
  return slot ? slot.energy.map(e => e.iid) : [];
}

describe('up-to floor / count-1 may (TA-473, TA-474, OOP-91)', () => {
  const raichu = () => koBoard(mon('a1', 'por-039', [LIGHTNING], 90), [mon('a2', 'mew-026')]);

  it('Electrical Grounding surfaces a standalone confirm{true,false} [TA-473 mew-026]', () => {
    const r = step(raichu(), [pouncingTrap]);
    expect(legal(r)).toEqual(['A:confirm:false', 'A:confirm:true']);
  });

  it('Electrical Grounding yes: the one [L] Energy moves to Raichu (collapsed) [TA-473 mew-026]', () => {
    const r = step(raichu(), [pouncingTrap, yes]);
    expect(r.status).toBe('awaitingAction');
    expect(energyOn(r, 'a2')).toEqual(['a1e0']);
  });

  it('Electrical Grounding no: nothing moves [TA-473 mew-026]', () => {
    const r = step(raichu(), [pouncingTrap, no]);
    expect(r.status).toBe('awaitingAction');
    expect(energyOn(r, 'a2')).toEqual([]);
  });

  it('Fillet Memento with one [W] and one bencher is forced and collapses [TA-474 par-054]', () => {
    const r = step(koBoard(mon('a1', 'par-054', [WATER], 90), [mon('a2', 'twm-118')]), [pouncingTrap]);
    expect(energyOn(r, 'a2')).toEqual(['a1e0']);
    expect(legal(r).some(a => a.startsWith('A:'))).toBe(false);
  });

  it('Fillet Memento with two benchers offers the pick but no decline [TA-474 par-054]', () => {
    const r = step(koBoard(mon('a1', 'par-054', [WATER], 90), [mon('a2', 'twm-118'), mon('a3', 'twm-118')]), [pouncingTrap]);
    expect(legal(r).length).toBeGreaterThan(1);
    expect(legal(r)).not.toContain('A:confirm:false');
  });

  it('Poppy with one Energy and one other Pokemon offers no decline [OOP-91 obf-193]', () => {
    const r = step(poppyBoard([mon('a1', 'twm-118'), mon('a2', 'twm-118')]), [poppy]);
    expect(r.status).toBe('awaitingAction');
    expect(legal(r).length).toBeGreaterThan(0);
    expect(legal(r)).not.toContain('A:confirm:false');
  });

  it('Poppy moves from ONE Pokemon to ANOTHER: the second Energy keeps the first move\'s source and target [TA-483 obf-193]', () => {
    const b = poppyBoard([mon('a1', 'twm-118', [WATER]), mon('a2', 'twm-118')]);
    b.players.A.active.energy.push({ iid: 'a0e1', printing: LIGHTNING });
    const first = act({ actor: 'A', type: 'moveEnergy', source: 'a0', card: 'a0e0', target: 'a1' });
    const r = step(b, [poppy, first]);
    expect(legal(r)).toEqual(['A:confirm:false', 'A:moveEnergy:a0e1:a1']);
    expect(energyOn(r, 'a1')).toEqual(['a1e0', 'a0e0']);
  });
});
