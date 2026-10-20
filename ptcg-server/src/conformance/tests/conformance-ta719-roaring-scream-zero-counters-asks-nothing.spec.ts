import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-719: Scream Tail par-086 Roaring Scream ("This attack does 20 damage to 1 of your opponent's Pokémon for each damage
 * counter on this Pokémon.") with no damage counters on Scream Tail asked a target for its 0 damage. B.25 reaches a
 * Step-D choice (owner-confirmed reading, rotomancer N-0329): every target leaves the same board, so nothing is asked
 * (TA-512 fixed the same shape on United Thunder). Board: the Unlimited fuzz row enum-par-086.
 */

const BOARD = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1s0", "printing": "par-086"}], "energy": [{"iid": "a1e1", "printing": "sve-005"}, {"iid": "a1e2", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah3", "printing": "sve-001"}, {"iid": "ah4", "printing": "sve-005"}], "deck": [{"iid": "ad5", "printing": "sve-003"}, {"iid": "ad6", "printing": "sve-001"}, {"iid": "ad7", "printing": "sve-005"}, {"iid": "ad8", "printing": "asc-001"}, {"iid": "ad9", "printing": "asc-002"}, {"iid": "ad10", "printing": "asc-216"}, {"iid": "ad11", "printing": "asc-184"}, {"iid": "ad12", "printing": "asc-182"}, {"iid": "ad13", "printing": "asc-188"}, {"iid": "ad14", "printing": "sve-001"}, {"iid": "ad15", "printing": "sve-005"}, {"iid": "ad16", "printing": "sve-002"}, {"iid": "ad17", "printing": "sve-003"}, {"iid": "ad18", "printing": "sve-001"}, {"iid": "ad19", "printing": "sve-005"}, {"iid": "ad20", "printing": "sve-002"}, {"iid": "ad21", "printing": "sve-003"}, {"iid": "ad22", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}, {"iid": "ap3", "printing": "sve-003", "faceUp": false}, {"iid": "ap4", "printing": "sve-003", "faceUp": false}, {"iid": "ap5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1s0", "printing": "asc-004"}], "energy": [{"iid": "b1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh2", "printing": "sve-001"}, {"iid": "bh3", "printing": "sve-005"}], "deck": [{"iid": "bd4", "printing": "sve-003"}, {"iid": "bd5", "printing": "sve-001"}, {"iid": "bd6", "printing": "sve-005"}, {"iid": "bd7", "printing": "asc-001"}, {"iid": "bd8", "printing": "asc-002"}, {"iid": "bd9", "printing": "asc-216"}, {"iid": "bd10", "printing": "asc-184"}, {"iid": "bd11", "printing": "asc-182"}, {"iid": "bd12", "printing": "asc-188"}, {"iid": "bd13", "printing": "sve-001"}, {"iid": "bd14", "printing": "sve-005"}, {"iid": "bd15", "printing": "sve-002"}, {"iid": "bd16", "printing": "sve-003"}, {"iid": "bd17", "printing": "sve-001"}, {"iid": "bd18", "printing": "sve-005"}, {"iid": "bd19", "printing": "sve-002"}, {"iid": "bd20", "printing": "sve-003"}, {"iid": "bd21", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}, {"iid": "bp3", "printing": "sve-003", "faceUp": false}, {"iid": "bp4", "printing": "sve-003", "faceUp": false}, {"iid": "bp5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const ATTACK = {"actor": "A", "type": "declareAttack", "source": "a1s0", "name": "Roaring Scream"} as unknown as NeutralAction;

function board(damage: number): NeutralState {
  const s = JSON.parse(JSON.stringify(BOARD)) as NeutralState;
  s.players.A.active!.damage = damage;
  return s;
}

describe('TA-719 Roaring Scream: no target is asked when Scream Tail has no damage counters', () => {
  it('[TA-719 par-086] 0 damage counters: no pick, the attack ends and B\'s turn starts', () => {
    const r = step(board(0), [ATTACK]);
    expect(r.applied).toBe(1);
    expect(r.state.activePlayer).toBe('B');
    expect(r.events.some(e => e.kind === 'damaged')).toBe(false);
  });

  it('[TA-719 par-086 control] 3 damage counters: the target is asked', () => {
    const r = step(board(30), [ATTACK]);
    expect(r.pending!.actor).toBe('A');
    expect(r.pending!.legalActions.every(a => a.type === 'choose')).toBe(true);
  });
});
