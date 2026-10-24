import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-754 — Kick Away asc-129 (Mightyena, 50) and Push Down asc-146 (Pawniard, 10): "Switch out your opponent's Active
 * Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)" The damage is the attack's (rulebook step F:
 * damage, then the other effects), so it lands on the Defending Pokémon and THEN it is switched out. The scripts ran the
 * switch in the before-damage block (WAS_ATTACK_USED), so the damage landed on the Pokémon switched in.
 * Mutation guard: put either card back on WAS_ATTACK_USED -> its cells see the damage on bb1s0.
 */

const DARK = 'sve-007', METAL = 'sve-008', FILLER = 'asc-004', WATER = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    flags: flags(), ...over,
  };
}
function state(A: PlayerState, B: PlayerState): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}
type La = { type: string; target?: string; actor?: string };
const offered = (r: ReturnType<typeof step>): La[] => (r.pending?.legalActions ?? []) as unknown as La[];

const CASES: Array<[string, string, string, CardRef[], number]> = [
  ['asc-129', 'Kick Away', 'Mightyena', [{ iid: 'a1e0', printing: DARK }, { iid: 'a1e1', printing: DARK }], 50],
  ['asc-146', 'Push Down', 'Pawniard', [{ iid: 'a1e0', printing: METAL }], 10],
];

for (const [printing, attack, name, energy, dmg] of CASES) {
  describe(`TA-754 — ${attack} ${printing} (${name}) does its damage, then switches`, () => {
    const board = () => state(
      player('a', { active: pip([{ iid: 'a1s0', printing }], energy) }),
      player('b', {
        active: pip([{ iid: 'b1s0', printing: FILLER }], [{ iid: 'b1e0', printing: WATER }]),
        bench: [pip([{ iid: 'bb1s0', printing: FILLER }]), pip([{ iid: 'bb2s0', printing: FILLER }])],
      }),
    );
    const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: attack } as unknown as NeutralAction;

    it(`at B's new-Active pick the damage is already on b1s0 [TA-754 ${printing}]`, () => {
      const r = step(board(), [declare]);
      expect(r.pending).toBeTruthy();
      expect(offered(r).map(a => `${a.type}:${a.target}`).sort()).toEqual(['promoteBench:bb1s0', 'promoteBench:bb2s0']);
      expect(r.state.players.B.active?.stack[0].iid).toBe('b1s0');
      expect(r.state.players.B.active?.damage).toBe(dmg);
    });
    it(`after B picks bb1s0, b1s0 is Benched with the damage and its Energy, bb1s0 Active undamaged [TA-754 ${printing} end]`, () => {
      const r = step(board(), [declare, { actor: 'B', type: 'promoteBench', target: 'bb1s0' } as unknown as NeutralAction]);
      const B = r.state.players.B;
      expect(B.active?.stack[0].iid).toBe('bb1s0');
      expect(B.active?.damage).toBe(0);
      const old = B.bench.find(p => p.stack[0].iid === 'b1s0');
      expect(old?.damage).toBe(dmg);
      expect(old?.energy.map(e => e.iid)).toEqual(['b1e0']);
    });
  });
}
