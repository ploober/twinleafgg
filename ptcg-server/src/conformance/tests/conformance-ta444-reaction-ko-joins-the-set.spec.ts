import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-444 (B.51, owner 2026-09-19: MERGE): a Pokémon a Knock Out reaction Knocks Out joins the Knock Out set still being
 * ordered (Advanced Rulebook v3.4 I D: a Knock Out is checked "anytime a Pokémon's remaining HP becomes zero"; II E-04:
 * the current player orders those step-2 effects). Board (the n0211 carrier): A's Spinning Tail Knocks Out B's Maractus
 * jtg-008 and Feebas together; A picks Exploding Needles first, whose six counters bring A's Team Rocket's Arbok to 0 HP
 * while Diver's Catch is unresolved. The Arbok's reaction (Togekiss asc-082 Wonder Kiss, subject a0) joins Diver's Catch
 * in the set A orders. Twinleaf drained the original group first and then asked Diver's Catch's confirm alone.
 * Mutation guard: drop the merge callback in check-effect -> these cells red.
 */

const BOARD = {"schemaVersion": "0.1", "turn": 6, "activePlayer": "A", "firstPlayer": "B", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a0", "printing": "dri-112"}, {"iid": "a1", "printing": "dri-113"}], "energy": [{"iid": "ae0", "printing": "sve-007"}, {"iid": "ae1", "printing": "sve-007"}, {"iid": "ae2", "printing": "sve-007"}], "tools": [], "damage": 70, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [{"stack": [{"iid": "ab0", "printing": "dri-112"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}], "hand": [], "deck": [{"iid": "Ad0", "printing": "sve-007"}, {"iid": "Ad1", "printing": "sve-007"}, {"iid": "Ad2", "printing": "sve-007"}, {"iid": "Ad3", "printing": "sve-007"}], "discard": [], "lostZone": [], "prizes": [{"iid": "Ap0", "printing": "sve-007", "faceUp": null}, {"iid": "Ap1", "printing": "sve-007", "faceUp": null}, {"iid": "Ap2", "printing": "sve-007", "faceUp": null}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "prizesTaken": 3, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b0", "printing": "jtg-008"}], "energy": [], "tools": [], "damage": 80, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [{"stack": [{"iid": "bb0", "printing": "ssp-198"}], "energy": [{"iid": "be0", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, {"stack": [{"iid": "bb1", "printing": "dri-054"}, {"iid": "bb2", "printing": "dri-055"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, {"stack": [{"iid": "bb3", "printing": "asc-080"}, {"iid": "bb4", "printing": "asc-081"}, {"iid": "bb5", "printing": "asc-082"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}], "hand": [], "deck": [{"iid": "Bd0", "printing": "sve-003"}, {"iid": "Bd1", "printing": "sve-003"}, {"iid": "Bd2", "printing": "sve-003"}, {"iid": "Bd3", "printing": "sve-003"}], "discard": [], "lostZone": [], "prizes": [{"iid": "Bp0", "printing": "sve-003", "faceUp": null}, {"iid": "Bp1", "printing": "sve-003", "faceUp": null}, {"iid": "Bp2", "printing": "sve-003", "faceUp": null}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "prizesTaken": 3, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const act = (a: object) => a as unknown as NeutralAction;
const SPIN = act({ actor: 'A', type: 'declareAttack', source: 'a0', name: 'Spinning Tail' });
const NEEDLES = act({ actor: 'A', type: 'resolveNext', kind: 'abilityEffect', ability: 'Exploding Needles', source: 'b0', subject: 'b0' });
const KISS = act({ actor: 'A', type: 'resolveNext', kind: 'abilityEffect', ability: 'Wonder Kiss', source: 'bb3', subject: 'a0' });
const CATCH = act({ actor: 'A', type: 'resolveNext', kind: 'abilityEffect', ability: "Diver's Catch", source: 'bb1', subject: 'bb0' });

function offers(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.ability, a.subject].filter(x => x !== undefined).join(':')).sort() : [];
}

describe('TA-444 — a reaction-created Knock Out joins the set still being ordered (B.51 MERGE)', () => {
  it('after Exploding Needles, A orders Diver\'s Catch and the Arbok\'s Wonder Kiss together [TA-444 jtg-008]', () => {
    expect(offers(step(BOARD, [SPIN, NEEDLES]))).toEqual(['A:resolveNext:Diver\'s Catch:bb0', 'A:resolveNext:Wonder Kiss:a0']);
  });
  it('Wonder Kiss can be resolved before Diver\'s Catch [TA-444 jtg-008 kiss first]', () => {
    const r = step(BOARD, [SPIN, NEEDLES, KISS]);
    expect(r.status).not.toBe('invalidAction');
    expect((r as any).pending.actor).toBe('system');   // its coin flip
  });
  it('Diver\'s Catch first, then Wonder Kiss is still owed [TA-444 jtg-008 catch first]', () => {
    const r = step(BOARD, [SPIN, NEEDLES, CATCH]);
    expect(r.status).not.toBe('invalidAction');
  });
});
