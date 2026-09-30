import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-475 — Exp. Share svi-174: "When your Active Pokémon is Knocked Out by damage from an opponent's attack, you
 * may move 1 basic Energy card that was attached to that Pokémon to the Pokémon this card is attached to."
 *
 * A triggered count-1 "may" has no inherent zero, so the may-gate is the only decline and stands alone as
 * confirm{true,false} (CF-32; Jamming Wing dri-070). twinleaf folded it into an allowCancel:true attach prompt whose
 * decline never reaches the wire, and the attach decomposer's CF-14 collapse then moved the one Energy unasked.
 * Each Exp. Share is its own trigger and moves to ITS OWN holder (two holders = two ordered triggers, each asking).
 *
 * Census (2026-09-29): the other served AttachEnergyPrompt sites with this hidden-decline shape (min 1, max 1,
 * allowCancel:true) are activated Abilities (Hydrapple ex scr, Xatu par, Garganacl par), whose decline is not using
 * the Ability — outside CF-32 — so the decomposer's collapse stays and the fix is card-level.
 *
 * Mutation guard: restore the allowCancel:true prompt without the ConfirmPrompt and the confirm cells go red.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const LIGHTNING = 'sve-004';
const FIGHTING = 'sve-006';
const EXP_SHARE = 'svi-174';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = [], damage = 0, tool?: string): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: tool ? [{ iid: `${iid}t0`, printing: tool }] : [], damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function deck(tag: string) {
  return Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
function board(holders: number): NeutralState {
  const bench = [mon('a2', 'twm-118', [], 0, EXP_SHARE)];
  if (holders > 1) {
    bench.push(mon('a3', 'twm-118', [], 0, EXP_SHARE));
  }
  const A: PlayerState = { active: mon('a1', 'por-039', holders > 1 ? [FIGHTING, FIGHTING] : [FIGHTING], 90), bench,
    hand: [{ iid: 'ah0', printing: WATER }], deck: deck('a'), discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', 'asc-062', [LIGHTNING]), bench: [], hand: [{ iid: 'bh0', printing: WATER }], deck: deck('b'),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'B', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const pouncingTrap = act({ actor: 'B', type: 'declareAttack', source: 'b1', name: 'Pouncing Trap' });
const yes = act({ actor: 'A', type: 'confirm', value: true });
const no = act({ actor: 'A', type: 'confirm', value: false });

function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.card, a.target, a.value].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
function energyOn(r: ReturnType<typeof step>, iid: string): string[] {
  const A = r.state.players.A;
  const slot = [A.active, ...A.bench].find(s => s && s.stack.some(c => c.iid === iid));
  return slot ? slot.energy.map(e => e.iid) : [];
}

describe('TA-475 Exp. Share may-gate', () => {
  it('the KO surfaces a standalone confirm{true,false} [TA-475 svi-174]', () => {
    const r = step(board(1), [pouncingTrap]);
    expect(legal(r)).toEqual(['A:confirm:false', 'A:confirm:true']);
  });

  it('yes: the one basic Energy moves to the Exp. Share holder [TA-475 svi-174]', () => {
    const r = step(board(1), [pouncingTrap, yes]);
    expect(r.status).toBe('awaitingAction');
    expect(energyOn(r, 'a2')).toEqual(['a1e0']);
  });

  it('no: nothing moves [TA-475 svi-174]', () => {
    const r = step(board(1), [pouncingTrap, no]);
    expect(r.status).toBe('awaitingAction');
    expect(energyOn(r, 'a2')).toEqual([]);
  });

  it('two Exp. Shares: each trigger asks and moves only to its own holder [TA-475 svi-174]', () => {
    const order = act({ actor: 'B', type: 'resolveNext', kind: 'cardTextEffect', source: 'a2t0', subject: 'a1' });
    const r = step(board(2), [pouncingTrap, order]);
    expect(legal(r)).toEqual(['A:confirm:false', 'A:confirm:true']);
    const r2 = step(board(2), [pouncingTrap, order, yes]);
    expect(legal(r2)).toEqual(['A:moveEnergy:a1e0:a2', 'A:moveEnergy:a1e1:a2']);
  });
});
