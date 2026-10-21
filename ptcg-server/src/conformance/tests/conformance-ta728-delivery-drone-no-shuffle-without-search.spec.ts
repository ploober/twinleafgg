import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-728 (TA-722's census, 2026-10-20): Delivery Drone pal-178 ("Flip 2 coins. If both of them are heads, search your deck
 * for a card and put it into your hand. Then, shuffle your deck.") shuffled the deck when the flips were not both heads.
 * B.44: "Then, shuffle your deck" rides on the search having been performed. Driven on :8090 b84900e99 x :8099
 * f3e92fdba: rotomancer shuffles nothing on two tails. Board: the Poké Ball row's board with Delivery Drone in hand.
 */

const BOARD = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1s0", "printing": "asc-004"}], "energy": [{"iid": "a1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 30, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, {"stack": [{"iid": "ab2s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah2", "printing": "pal-178"}, {"iid": "ah3", "printing": "sve-001"}, {"iid": "ah4", "printing": "sve-005"}], "deck": [{"iid": "ad5", "printing": "sve-003"}, {"iid": "ad6", "printing": "sve-001"}, {"iid": "ad7", "printing": "sve-005"}, {"iid": "ad8", "printing": "asc-001"}, {"iid": "ad9", "printing": "asc-002"}, {"iid": "ad10", "printing": "asc-216"}, {"iid": "ad11", "printing": "asc-184"}, {"iid": "ad12", "printing": "asc-182"}, {"iid": "ad13", "printing": "asc-188"}, {"iid": "ad14", "printing": "sve-001"}, {"iid": "ad15", "printing": "sve-005"}, {"iid": "ad16", "printing": "sve-002"}, {"iid": "ad17", "printing": "sve-003"}, {"iid": "ad18", "printing": "sve-001"}, {"iid": "ad19", "printing": "sve-005"}, {"iid": "ad20", "printing": "sve-002"}, {"iid": "ad21", "printing": "sve-003"}, {"iid": "ad22", "printing": "sve-001"}], "discard": [{"iid": "ax23", "printing": "sve-002"}, {"iid": "ax24", "printing": "sve-004"}], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}, {"iid": "ap3", "printing": "sve-003", "faceUp": false}, {"iid": "ap4", "printing": "sve-003", "faceUp": false}, {"iid": "ap5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1s0", "printing": "asc-004"}], "energy": [{"iid": "b1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh2", "printing": "sve-001"}, {"iid": "bh3", "printing": "sve-005"}], "deck": [{"iid": "bd4", "printing": "sve-003"}, {"iid": "bd5", "printing": "sve-001"}, {"iid": "bd6", "printing": "sve-005"}, {"iid": "bd7", "printing": "asc-001"}, {"iid": "bd8", "printing": "asc-002"}, {"iid": "bd9", "printing": "asc-216"}, {"iid": "bd10", "printing": "asc-184"}, {"iid": "bd11", "printing": "asc-182"}, {"iid": "bd12", "printing": "asc-188"}, {"iid": "bd13", "printing": "sve-001"}, {"iid": "bd14", "printing": "sve-005"}, {"iid": "bd15", "printing": "sve-002"}, {"iid": "bd16", "printing": "sve-003"}, {"iid": "bd17", "printing": "sve-001"}, {"iid": "bd18", "printing": "sve-005"}, {"iid": "bd19", "printing": "sve-002"}, {"iid": "bd20", "printing": "sve-003"}, {"iid": "bd21", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}, {"iid": "bp3", "printing": "sve-003", "faceUp": false}, {"iid": "bp4", "printing": "sve-003", "faceUp": false}, {"iid": "bp5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const PLAY = { actor: 'A', type: 'playItem', card: 'ah2' } as unknown as NeutralAction;
const flip = (face: 'heads' | 'tails') => ({ actor: 'system', type: 'flip', face }) as unknown as NeutralAction;
const shuffled = (r: ReturnType<typeof step>) => r.events.some(e => e.kind === 'shuffled')
  || r.pending?.actor === 'system';

describe('TA-728 Delivery Drone: no shuffle unless both flips are heads', () => {
  it('[TA-728 pal-178] tails, tails: no shuffle', () => {
    const r = step(BOARD, [PLAY, flip('tails'), flip('tails')]);
    expect(r.applied).toBe(3);
    expect(shuffled(r)).toBe(false);
  });

  it('[TA-728 pal-178 one-heads] heads, tails: no shuffle', () => {
    const r = step(BOARD, [PLAY, flip('heads'), flip('tails')]);
    expect(shuffled(r)).toBe(false);
  });

  it('[TA-728 pal-178 control] heads, heads: the search is asked', () => {
    const r = step(BOARD, [PLAY, flip('heads'), flip('heads')]);
    expect(r.pending!.actor).toBe('A');
    expect(r.pending!.descriptor).toContain('Choose cards');
  });
});
