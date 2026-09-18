import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-437 — Togekiss's Wonder Kiss ("Whenever your opponent's Active Pokémon gets Knocked Out, flip a
 * coin. If heads, take 1 more Prize card …") has no turn condition (#2043: "The KO can be during either
 * player's turn or during Pokémon Checkup, and it doesn't have to be from an attack"). The old gate
 * `state.phase !== ATTACK || activePlayer !== attacker` withheld the flip on a KO of the opponent's
 * Active outside the Togekiss owner's own attack step.
 *
 * Here B's Togekiss is in play; A's Active is Poisoned at lethal-minus-one and A ends its turn, so the
 * between-turns Checkup Knocks Out A's Active. Wonder Kiss must flip for B. Mutation guard: restore the
 * gate and no flip is raised (the Checkup phase is BETWEEN_TURNS, not ATTACK).
 */

const TOGEPI = 'ssp-070', TOGETIC = 'ssp-071', TOGEKISS = 'ssp-072';
const WATER = 'sve-003';
const FEEBAS = 'ssp-198'; // 30 HP basic

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function wd(ps: PlayerState, tag: string): PlayerState {
  return { ...ps, prizes: Array.from({ length: 3 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })), deck: Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })) };
}
const togekiss = (): PokemonInPlay => ({
  stack: [{ iid: 'bk0', printing: TOGEPI }, { iid: 'bk1', printing: TOGETIC }, { iid: 'bk2', printing: TOGEKISS }],
  energy: [], tools: [], damage: 0, conditions: [], markers: markers(),
});
const poisonedFeebas = (iid: string): PokemonInPlay => ({ stack: [{ iid, printing: FEEBAS }], energy: [], tools: [], damage: 20, conditions: ['poisoned'], markers: markers() });
const feebas = (iid: string): PokemonInPlay => ({ stack: [{ iid, printing: FEEBAS }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() });

function board(): NeutralState {
  // It is A's turn. A's Active Feebas is Poisoned at 20/30 damage — the Checkup will KO it. B's Active
  // is Togekiss. A has a Bench Feebas to promote into.
  return {
    schemaVersion: SCHEMA_VERSION, turn: 5, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: wd(player({ active: poisonedFeebas('a0'), bench: [feebas('ab0')] }), 'A'),
      B: wd(player({ active: togekiss() }), 'B'),
    },
  };
}
const endTurn: NeutralAction = { actor: 'A', type: 'endTurn' };
const kinds = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []).map((a: { type: string }) => a.type);

describe('TA-437 Wonder Kiss fires on a KO outside the owner\'s attack step', () => {
  it('a Checkup Poison KO of the opponent\'s Active raises Wonder Kiss\'s flip', () => {
    const r = step(board(), [endTurn]);
    expect(kinds(r)).toContain('flip');
    expect(r.pending!.actor).toBe('system');
  });
});
