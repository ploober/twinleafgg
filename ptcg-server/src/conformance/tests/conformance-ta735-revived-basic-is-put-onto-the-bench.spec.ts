import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-735: Ho-Oh cri-010 Flames of Revival, Kingdra ex sfa-012 King's Order and Duskull pre-035 Come and Get You moved the
 * revived Pokemon from the discard pile with MOVE_CARDS, so nothing that watches a Pokemon being put onto the Bench saw
 * it: Risky Ruins meg-127 ("Whenever any player puts a Basic non-[D] Pokemon onto their Bench, put 2 damage counters on
 * that Pokemon") placed none. Alomomola blk-024 already dispatched PlayPokemonFromDiscardEffect, which Risky Ruins reads.
 * Board: bug report 1502973487520813156 re-boarded in pool (2026-10-21); rotomancer f3e92fdba puts the 2 counters.
 */

const BOARD = {"schemaVersion": "0.1", "turn": 3, "activePlayer": "A", "firstPlayer": "B", "phase": "main", "outcome": "ongoing", "stadium": {"iid": "st0", "printing": "meg-127", "owner": "A"}, "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "cri-010"}], "energy": [{"iid": "ae9", "printing": "sve-002"}], "tools": [], "damage": 0, "conditions": [], "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [], "hand": [], "deck": [{"iid": "ad0", "printing": "sve-003"}, {"iid": "ad1", "printing": "sve-003"}, {"iid": "ad2", "printing": "sve-003"}, {"iid": "ad3", "printing": "sve-003"}, {"iid": "ad4", "printing": "sve-003"}, {"iid": "ad5", "printing": "sve-003"}, {"iid": "ad6", "printing": "sve-003"}, {"iid": "ad7", "printing": "sve-003"}, {"iid": "ad8", "printing": "sve-003"}, {"iid": "ad9", "printing": "sve-003"}], "discard": [{"iid": "ac0", "printing": "asc-004"}, {"iid": "ac1", "printing": "asc-004"}], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}, {"iid": "ap3", "printing": "sve-003", "faceUp": false}, {"iid": "ap4", "printing": "sve-003", "faceUp": false}, {"iid": "ap5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [], "hand": [], "deck": [{"iid": "bd0", "printing": "sve-003"}, {"iid": "bd1", "printing": "sve-003"}, {"iid": "bd2", "printing": "sve-003"}, {"iid": "bd3", "printing": "sve-003"}, {"iid": "bd4", "printing": "sve-003"}, {"iid": "bd5", "printing": "sve-003"}, {"iid": "bd6", "printing": "sve-003"}, {"iid": "bd7", "printing": "sve-003"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}, {"iid": "bp3", "printing": "sve-003", "faceUp": false}, {"iid": "bp4", "printing": "sve-003", "faceUp": false}, {"iid": "bp5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": [], "format": "unlimited"} as unknown as NeutralState;
const withAttacker = (printing: string, energy: string, revive: string): NeutralState => {
  const s = JSON.parse(JSON.stringify(BOARD)) as NeutralState;
  s.players.A.active!.stack = [{ iid: 'a1', printing }];
  s.players.A.active!.energy = [{ iid: 'ae9', printing: energy }];
  s.players.A.discard = s.players.A.discard.map(c => c.iid === 'ac0' || c.iid === 'ac1' ? { ...c, printing: revive } : c);
  return s;
};
const revive = (name: string) => [
  { actor: 'A', type: 'declareAttack', source: 'a1', name },
  { actor: 'A', type: 'choose', target: 'ac0' },
  { actor: 'A', type: 'confirm', value: false },
] as unknown as NeutralAction[];
const benched = (r: ReturnType<typeof step>) => r.state.players.A.bench.map(b => [b.stack[b.stack.length - 1].iid, b.damage]);

describe('TA-735 a Pokemon revived onto the Bench is put onto the Bench (Risky Ruins sees it)', () => {
  it('[TA-735 cri-010] Ho-Oh Flames of Revival under Risky Ruins: the revived Basic takes 2 counters', () => {
    const r = step(withAttacker('cri-010', 'sve-002', 'asc-004'), revive('Flames of Revival'));
    expect(benched(r)).toEqual([['ac0', 20]]);
  });
  it('[TA-735 pre-035] Duskull Come and Get You under Risky Ruins: the revived Duskull takes 2 counters', () => {
    const r = step(withAttacker('pre-035', 'sve-005', 'pre-035'), revive('Come and Get You'));
    expect(benched(r)).toEqual([['ac0', 20]]);
  });
  it('[TA-735 sfa-012] Kingdra ex King\'s Order under Risky Ruins: the revived Water Basic takes 2 counters', () => {
    const r = step(withAttacker('sfa-012', 'sve-003', 'obf-060'), revive("King's Order"));
    expect(benched(r)).toEqual([['ac0', 20]]);
  });
});

// TA-736: Risky Ruins placed its counters with no log, so the adapter emitted no `damaged` event for them; rotomancer
// f3e92fdba emits damaged {target: ac0, hp: 20} (the re-boarded report row, 2026-10-21).
describe('TA-736 Risky Ruins\' counters are reported as damage', () => {
  it('[TA-736 meg-127] the revived Basic\'s 2 counters emit damaged {target, hp: 20}', () => {
    const r = step(withAttacker('cri-010', 'sve-002', 'asc-004'), revive('Flames of Revival'));
    const dmg = r.events.filter(e => e.kind === 'damaged').map(e => [(e as { target?: string }).target, (e as { hp?: number }).hp]);
    expect(dmg).toEqual([['ac0', 20]]);
  });
});
