import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * SD-26 Dangerous Laser sfa-058 ("Your opponent's Active Pokémon is now Burned and Confused.") applies its conditions
 * through AddSpecialConditionsEffect, so a Pokémon that can't be affected by Special Conditions keeps none: Antique Jaw
 * Fossil por-068 ("This card can't be affected by any Special Conditions"). Same choke point as TA-389 (Lisia's Appeal).
 */
const GRASS = 'sve-001';
const BELLSPROUT = 'asc-004'; // Basic
const BIG = 'mew-003'; // Venusaur ex
const JAW_FOSSIL = 'por-068';

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
function prizes(tag: string): PrizeRef[] {
  return [0, 1, 2].map(i => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
interface Opts { hand?: string[]; bActive?: PokemonInPlay; bBench?: PokemonInPlay[]; bHand?: string[] }
function board(active: PokemonInPlay, o: Opts = {}): NeutralState {
  const A: PlayerState = { active, bench: [], hand: cards('ah', o.hand ?? []), deck: cards('ad', Array(8).fill(GRASS)),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: o.bActive ?? mon('b1', [BIG]), bench: o.bBench ?? [], hand: cards('bh', o.bHand ?? []),
    deck: cards('bd', Array(8).fill(GRASS)), discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
function run(s: NeutralState, actions: unknown[]) {
  return step(s, actions as never);
}
const LASER = 'sfa-058';
describe('SD-26 Dangerous Laser through the special-conditions effect', () => {
  const play = [{ actor: 'A', type: 'playItem', card: 'ah0' }];
  it('Dangerous Laser on an Antique Jaw Fossil leaves it with no Special Condition [TA-644]', () => {
    const r = run(board(mon('a1', [BELLSPROUT]), { hand: [LASER], bActive: mon('b1', [JAW_FOSSIL]) }), play);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.B.active!.conditions).toEqual([]);
  });
  it('control: Dangerous Laser Burns and Confuses a Basic Pokémon [TA-644]', () => {
    const r = run(board(mon('a1', [BELLSPROUT]), { hand: [LASER], bActive: mon('b1', [BELLSPROUT]) }), play);
    expect([...r.state.players.B.active!.conditions].sort()).toEqual(['burned', 'confused']);
  });
});
