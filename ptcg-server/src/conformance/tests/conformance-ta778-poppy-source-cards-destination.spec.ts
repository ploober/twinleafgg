import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-778 (B.120 amended, owner 2026-10-25; SR-5): Poppy obf-193 "Move up to 2 Energy from 1 of your Pokémon to another
 * of your Pokémon." The source Pokémon is a choice, so it is asked first; then up to 2 of its Energy (a Trainer's "up to"
 * is 1..2, B.18 / #2301: no stop before the first); then another of your Pokémon (never the source). Twinleaf asked
 * (Energy, source, target) moveEnergy pairs and fixed the destination with the first move (TA-483's two prompts).
 * Mutation guard: restore the MoveEnergyPrompt pair version -> pairs come back and these cells red.
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
function poppyBoard(bench: PokemonInPlay[]): NeutralState {
  const A: PlayerState = { active: mon('a0', 'twm-118', [WATER]), bench, hand: [{ iid: 'ah0', printing: 'obf-193' }], deck: deck('a'),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b0', 'twm-118'), bench: [], hand: [], deck: deck('b'),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
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

const choose = (target: string) => act({ actor: 'A', type: 'choose', target });
function board(): NeutralState {
  const b = poppyBoard([mon('a1', 'twm-118', [GRASS]), mon('a2', 'twm-118')]);
  b.players.A.active!.energy.push({ iid: 'a0e1', printing: LIGHTNING });
  return b;
}

describe('TA-778 — Poppy obf-193: the source, then up to 2 of its Energy, then another Pokémon', () => {
  it('first pending: the Pokémon with Energy, no stop, no pairs [TA-778 obf-193]', () => {
    expect(legal(step(board(), [poppy]))).toEqual(['A:choose:a0', 'A:choose:a1']);
  });
  it('after the source: its Energy only, no stop before the first [TA-778 obf-193 cards]', () => {
    expect(legal(step(board(), [poppy, choose('a0')]))).toEqual(['A:choose:a0e0', 'A:choose:a0e1']);
  });
  it('after one Energy: the other and the stop [TA-778 obf-193 second]', () => {
    expect(legal(step(board(), [poppy, choose('a0'), choose('a0e0')]))).toEqual(['A:choose:a0e1', 'A:confirm:false']);
  });
  it('after both: another Pokémon, never the source; both land there [TA-778 obf-193 destination]', () => {
    expect(legal(step(board(), [poppy, choose('a0'), choose('a0e0'), choose('a0e1')]))).toEqual(['A:choose:a1', 'A:choose:a2']);
    const r = step(board(), [poppy, choose('a0'), choose('a0e0'), choose('a0e1'), choose('a2')]);
    expect(r.status).not.toBe('invalidAction');
    expect(energyOn(r, 'a2').sort()).toEqual(['a0e0', 'a0e1']);
    expect(energyOn(r, 'a0')).toEqual([]);
  });
  it('the stop after one Energy, then the destination: one moves [TA-778 obf-193 stop]', () => {
    const r = step(board(), [poppy, choose('a0'), choose('a0e1'), act({ actor: 'A', type: 'confirm', value: false }), choose('a1')]);
    expect(energyOn(r, 'a1').sort()).toEqual(['a0e1', 'a1e0']);
    expect(energyOn(r, 'a0')).toEqual(['a0e0']);
  });
  it('a (card, source, target) pair is not offered and is refused [TA-778 obf-193 pair refused]', () => {
    const r = step(board(), [poppy, act({ actor: 'A', type: 'moveEnergy', source: 'a0', card: 'a0e0', target: 'a1' })]);
    expect(r.status).toBe('invalidAction');
  });
  it('one Pokémon with one Energy: source and Energy are forced, only the destination is asked [TA-778 obf-193 forced]', () => {
    const r = step(poppyBoard([mon('a1', 'twm-118'), mon('a2', 'twm-118')]), [poppy]);
    expect(legal(r)).toEqual(['A:choose:a1', 'A:choose:a2']);
    const done = step(poppyBoard([mon('a1', 'twm-118'), mon('a2', 'twm-118')]), [poppy, choose('a2')]);
    expect(energyOn(done, 'a2')).toEqual(['a0e0']);
  });
});
