import { importState } from '../state-adapter';
import { replay, step } from '../driver';
import { NeutralAction } from '../neutral-types';
import { materializeNeutral, BoardSpec } from './support/scenario-runner';
import { legalToNeutral, mulberry32 } from './support/generators';

/**
 * The ChoosePrizePrompt decomposer (Step C, Part 1). A non-terminal KO — defender survives on its
 * bench and the attacker still has >1 prize — raises a ChoosePrizePrompt (taking 1 of 6 prizes) plus a
 * ChoosePokemonPrompt (promote a new active). Both are now decomposable, so the adapter can drive past
 * the KO. (Before this decomposer, ChoosePrizePrompt classified as `unsupported` and the driver threw.)
 */

const L = 'Lightning Energy SVE';
const W = 'Water Energy SVE';

// A's Raichu (1 Lightning) "Ambushing Spark" hits 40; B's Ralts (70 HP) is pre-damaged to 60, so the
// attack KOs it. Both sides hold 6 prizes, so A's single KO prize is non-terminal -> ChoosePrizePrompt.
const KO_BOARD: BoardSpec = {
  turn: 3,
  players: {
    A: { active: { card: 'Raichu SIT', energy: [L] }, deck: [W, W], prizeCount: 6 },
    B: { active: { card: 'Ralts SIT', damage: 60 }, bench: [{ card: 'Rufflet SIT' }], deck: [W, W], prizeCount: 6 },
  },
};

const ATTACK: NeutralAction = { actor: 'A', type: 'declareAttack', source: 'A-act-s0', name: 'Ambushing Spark' };

/** Drive the attack's follow-up picks (prize, promote, any flips), first-legal each, to the next menu. */
function driveAfterAttack(initial = materializeNeutral(KO_BOARD)): NeutralAction[] {
  const rng = mulberry32(1); // only consumed by shuffle perms; none arise here
  const log: NeutralAction[] = [ATTACK];
  for (let i = 0; i < 10; i++) {
    const r = replay(importState(initial), log);
    expect(r.rejection).toBeUndefined();
    const pending = r.pending;
    if (pending === null || pending.descriptor === 'main') {
      break; // reached the next player's top-level menu (or gameOver) — KO fully resolved
    }
    log.push(legalToNeutral(pending.legalActions[0], pending.actor, rng));
  }
  return log;
}

describe('Conformance — ChoosePrizePrompt decomposer (non-terminal KO)', () => {

  it('takes a prize, promotes the bench, and the game continues', () => {
    const initial = materializeNeutral(KO_BOARD);
    const log = driveAfterAttack(initial);

    // the KO produced a choosePrize pick in the log
    expect(log.some(a => a.type === 'choosePrize')).toBe(true);

    const res = step(initial, log);
    expect(res.status).toBe('awaitingAction'); // not gameOver — A took only 1 of 6 prizes
    // B promoted its benched Rufflet into the active slot
    expect(res.state.players.B.active!.stack[0].printing).toBe('Rufflet SIT');
    // A took exactly one prize: 6 -> 5, and the prize card landed in A's hand
    expect(res.state.players.A.prizes.length).toBe(5);
    expect(res.state.players.A.hand.some(c => c.printing === W)).toBe(true);
  });

  it('enumerates every takeable prize pile as a choosePrize legal action', () => {
    const initial = materializeNeutral(KO_BOARD);
    // walk to A's prize decision
    const rng = mulberry32(1);
    const log: NeutralAction[] = [ATTACK];
    let prizePending = null;
    for (let i = 0; i < 10; i++) {
      const r = replay(importState(initial), log);
      const p = r.pending;
      if (p === null || p.descriptor === 'main') { break; }
      if (p.legalActions[0].type === 'choosePrize') { prizePending = p; break; }
      log.push(legalToNeutral(p.legalActions[0], p.actor, rng));
    }

    expect(prizePending).not.toBeNull();
    expect(prizePending!.actor).toBe('A');
    expect(prizePending!.legalActions.every(a => a.type === 'choosePrize')).toBe(true);
    expect(prizePending!.legalActions.length).toBe(6); // all six of A's prize piles are takeable
  });
});
