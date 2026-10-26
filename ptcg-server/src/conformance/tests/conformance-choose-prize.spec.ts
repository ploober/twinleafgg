import { importState } from '../state-adapter';
import { replay, step } from '../driver';
import { NeutralAction } from '../neutral-types';

// CF-60: damaged/ko name the affected Pokemon by its shared basic `iid`. Resolve back to the basic
// printing via the response state to keep this a per-printing assertion (the KO'd Ralts' basic card
// is in the discard after the KO).
function basicPrintingByIid(state: { players: Record<string, { active: { stack: { iid: string; printing: string }[] } | null; bench: { stack: { iid: string; printing: string }[] }[]; hand: { iid: string; printing: string }[]; deck: { iid: string; printing: string }[]; discard: { iid: string; printing: string }[]; lostZone: { iid: string; printing: string }[]; prizes: { iid: string; printing: string }[] }> }, iid: string | undefined): string | undefined {
  if (!iid) { return undefined; }
  for (const p of Object.keys(state.players)) {
    const side = state.players[p];
    for (const slot of [side.active, ...side.bench]) {
      if (slot) { for (const c of slot.stack) { if (c.iid === iid) { return slot.stack[0].printing; } } }
    }
    for (const zone of [side.hand, side.deck, side.discard, side.lostZone]) {
      for (const c of zone) { if (c.iid === iid) { return c.printing; } }
    }
    for (const pc of side.prizes) { if (pc.iid === iid) { return pc.printing; } }
  }
  return undefined;
}
import { materializeNeutral, BoardSpec } from './support/scenario-runner';
import { legalToNeutral, mulberry32 } from './support/generators';
import { toPrinting } from '../printing';
import { getCardByName } from '../../sets/tests/test-helpers';

/**
 * The ChoosePrizePrompt decomposer (Step C, Part 1). A non-terminal KO — defender survives on its
 * bench and the attacker still has >1 prize — raises a ChoosePrizePrompt (taking 1 of 6 prizes) plus a
 * ChoosePokemonPrompt (promote a new active). Both are now decomposable, so the adapter can drive past
 * the KO. (Before this decomposer, ChoosePrizePrompt classified as `unsupported` and the driver threw.)
 */

const L = 'Lightning Energy SVE'; // BoardSpec card names stay fullName (the native side resolves by name)
const W = 'Water Energy SVE';
const W_PRINTING = toPrinting(getCardByName('Water Energy SVE'));   // the projected set-number printing
const RUFFLET_PRINTING = toPrinting(getCardByName('Rufflet SIT'));

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

    // the KO produced a takePrize pick in the log
    expect(log.some(a => a.type === 'takePrize')).toBe(true);

    const res = step(initial, log);
    expect(res.status).toBe('awaitingAction'); // not gameOver — A took only 1 of 6 prizes
    // B promoted its benched Rufflet into the active slot
    expect(res.state.players.B.active!.stack[0].printing).toBe(RUFFLET_PRINTING);
    // A took exactly one prize: 6 -> 5, and the prize card landed in A's hand
    expect(res.state.players.A.prizes.length).toBe(5);
    expect(res.state.players.A.hand.some(c => c.printing === W_PRINTING)).toBe(true);

    // Significant events: the KO'd Pokemon is B's original active, identified by `player` + basic
    // `printing` (cid, the PROJECTED set-number id) — not the engine-private iid — preceded by the
    // lethal `damaged` on it.
    const koPrinting = toPrinting(getCardByName('Ralts SIT'));
    expect(res.events.some(e => e.kind === 'damaged'
      && basicPrintingByIid(res.state, (e as { target?: string }).target) === koPrinting && e.hp > 0)).toBe(true);
    expect(res.events.some(e => e.kind === 'ko'
      && basicPrintingByIid(res.state, (e as { target?: string }).target) === koPrinting)).toBe(true);
  });

  it('enumerates every takeable prize pile as a takePrize legal action', () => {
    const initial = materializeNeutral(KO_BOARD);
    // walk to A's prize decision
    const rng = mulberry32(1);
    const log: NeutralAction[] = [ATTACK];
    let prizePending = null;
    for (let i = 0; i < 10; i++) {
      const r = replay(importState(initial), log);
      const p = r.pending;
      if (p === null || p.descriptor === 'main') { break; }
      if (p.legalActions[0].type === 'takePrize') { prizePending = p; break; }
      log.push(legalToNeutral(p.legalActions[0], p.actor, rng));
    }

    expect(prizePending).not.toBeNull();
    expect(prizePending!.actor).toBe('A');
    expect(prizePending!.legalActions.every(a => a.type === 'takePrize')).toBe(true);
    expect(prizePending!.legalActions.length).toBe(6); // all six of A's prize piles are takeable
  });
});
