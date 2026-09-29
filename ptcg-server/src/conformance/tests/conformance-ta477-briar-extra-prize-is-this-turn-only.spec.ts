import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-477 — Briar scr-132: "During THIS turn, if your opponent's Active Pokemon is Knocked Out by damage from an
 * attack used by your Tera Pokemon, take 1 more Prize card." twinleaf armed a card-instance flag on play and
 * cleared it only when a KO happened, so a Briar turn with no KO left it armed: two turns later an ordinary
 * Tera KO took an extra Prize. Found by the TA-471/TA-476 refuzz (results/refuzz-ta471-ta476-20260929).
 *
 * Mutation guard: drop the turn check in briar.ts and the later-turn cell goes red (2 Prizes). The same-turn
 * control pins that Briar still pays out on the turn it is played.
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
function cards(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: GRASS }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(`${tag}p`, n).map(c => ({ ...c, faceUp: false }));
}
function board(): NeutralState {
  const A: PlayerState = { active: mon('a0', CHARIZARD, [{ iid: 'ae0', printing: FIRE }, { iid: 'ae1', printing: FIRE }]), bench: [],
    hand: [{ iid: 'ah0', printing: BRIAR }], deck: cards('ad', 4), discard: [], lostZone: [], prizes: prizes('a', 6), flags: flags(0) };
  const B: PlayerState = { active: mon('b0', MUNKIDORI), bench: [mon('bb0', MUNKIDORI)], hand: [], deck: cards('bd', 4),
    discard: [], lostZone: [], prizes: prizes('b', 2), flags: flags(4) };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 5, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const briar = act({ actor: 'A', type: 'playSupporter', card: 'ah0' });
const endA = act({ actor: 'A', type: 'endTurn' });
const endB = act({ actor: 'B', type: 'endTurn' });
const attack = act({ actor: 'A', type: 'declareAttack', source: 'a0', name: 'Burning Darkness' });
const prize = act({ actor: 'A', type: 'takePrize', index: 0 });

/** Take every Prize A is offered after `actions`; return how many. */
function prizesTaken(actions: NeutralAction[]): number {
  const script = [...actions];
  for (let n = 0; n < 4; n++) {
    const r = step(board(), script);
    if (!(r.pending?.legalActions ?? []).some(a => a.type === 'takePrize' && a.actor === 'A')) {
      return n;
    }
    script.push(prize);
  }
  return -1;
}

describe('TA-477 Briar\'s extra Prize is for THIS turn only', () => {
  it('Briar on turn 5 with no KO; a Tera KO on turn 7 takes 1 Prize, not 2 [TA-477 scr-132]', () => {
    expect(prizesTaken([briar, endA, endB, attack])).toBe(1);
  });

  it('a Tera KO on the turn Briar is played takes 2 (control) [TA-477 scr-132]', () => {
    expect(prizesTaken([briar, attack])).toBe(2);
  });
});
