import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-471 — "supporter played THIS TURN" must hold for the whole turn, including the attacking player's own
 * Knock Out window. Briar scr-132 then Charizard ex obf-125 Burning Darkness KOs B's Active: A is still taking
 * Prizes on turn 5, yet twinleaf projected `supporterPlayedThisTurn: false` there, because the EndTurnEffect
 * handler zeroed `supporterTurn` BEFORE the attack-KO prize prompts resolved. The same handler already defers
 * the prizesTaken rotation to `initNextTurn` for exactly this reason; the supporter reset now sits beside it.
 *
 * Mutation guard: move `player.supporterTurn = 0` back into the EndTurnEffect handler and the KO-window cell
 * goes red. The turn-advance cell pins that the flag still clears when the turn actually ends.
 */

const CHARIZARD = 'obf-125';
const BRIAR = 'scr-132';
const MUNKIDORI = 'twm-095';
const FIRE = 'sve-002';
const GRASS = 'sve-001';

function flags(prizesTaken: number): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false, prizesTaken } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
// A's discard holds a Pokemon only because twinleaf's Briar.canPlay demands one (TA-476, a separate defect).
function board(): NeutralState {
  const A: PlayerState = { active: mon('a0', CHARIZARD, [{ iid: 'ae0', printing: FIRE }, { iid: 'ae1', printing: FIRE }]), bench: [],
    hand: [{ iid: 'ah0', printing: BRIAR }], deck: [{ iid: 'ad0', printing: GRASS }], discard: [{ iid: 'adc0', printing: MUNKIDORI }], lostZone: [],
    prizes: prizes('a', 6), flags: flags(0) };
  const B: PlayerState = { active: mon('b0', MUNKIDORI), bench: [mon('bb0', MUNKIDORI)], hand: [],
    deck: [{ iid: 'bd0', printing: GRASS }], discard: [], lostZone: [], prizes: prizes('b', 2), flags: flags(4) };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 5, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const briar = act({ actor: 'A', type: 'playSupporter', card: 'ah0' });
const attack = act({ actor: 'A', type: 'declareAttack', source: 'a0', name: 'Burning Darkness' });
const prize = act({ actor: 'A', type: 'takePrize', index: 0 });
const promote = act({ actor: 'B', type: 'promoteBench', target: 'bb0' });

describe('TA-471 supporter flag survives the attacking player\'s KO window', () => {
  it('at A\'s takePrize pending after the KO it is still turn 5 and A has played a Supporter [TA-471 scr-132]', () => {
    const r = step(board(), [briar, attack]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.turn).toBe(5);
    expect(r.pending?.legalActions.some(a => a.type === 'takePrize')).toBe(true);
    expect(r.state.players.A.flags.supporterPlayedThisTurn).toBe(true);
  });

  it('the flag clears when the turn actually advances (control) [TA-471 scr-132]', () => {
    const r = step(board(), [briar, attack, prize, prize, promote]);
    expect(r.state.turn).toBe(6);
    expect(r.state.activePlayer).toBe('B');
    expect(r.state.players.A.flags.supporterPlayedThisTurn).toBe(false);
    expect(r.state.players.A.prizes.length).toBe(4);
  });
});
