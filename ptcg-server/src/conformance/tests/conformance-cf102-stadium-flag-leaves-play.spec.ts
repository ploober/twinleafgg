import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * CF-102 / B.111 (owner 2026-10-20): `stadiumUsedThisTurn` is "this player has already activated the in-play Stadium's
 * once-per-turn effect this turn", and the cap rides on the physical card (#926 / #975). It resets when the player plays
 * a new Stadium AND when the Stadium that was used leaves play. Blowtorch pfl-086 ("… or discard a Stadium in play.")
 * discarding B's Artazon pal-171 after A used it leaves no Stadium in play: A's flag reads false. Rotomancer 936314650
 * already reset it; twinleaf 6729a1223 kept it true (fuzz row results/fuzz-20261020-graviton-unlimited-enum, ta554 seed).
 */

const BOARD: NeutralState = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "stadium": {"iid": "st0", "printing": "pal-171", "owner": "B"}, "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [], "hand": [{"iid": "ah0", "printing": "pfl-086"}, {"iid": "ah1", "printing": "sve-002"}], "deck": [{"iid": "ad0", "printing": "sve-001"}, {"iid": "ad1", "printing": "sve-001"}, {"iid": "ad2", "printing": "sve-001"}, {"iid": "ad3", "printing": "sve-001"}, {"iid": "ad4", "printing": "sve-001"}, {"iid": "ad5", "printing": "sve-001"}, {"iid": "ad6", "printing": "sve-001"}, {"iid": "ad7", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-001", "faceUp": false}, {"iid": "ap1", "printing": "sve-001", "faceUp": false}, {"iid": "ap2", "printing": "sve-001", "faceUp": false}, {"iid": "ap3", "printing": "sve-001", "faceUp": false}, {"iid": "ap4", "printing": "sve-001", "faceUp": false}, {"iid": "ap5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "prizesTaken": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "mew-003"}], "energy": [{"iid": "b1e0", "printing": "pal-190"}, {"iid": "b1e1", "printing": "sve-001"}], "tools": [{"iid": "b1t0", "printing": "pal-173"}], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [], "hand": [], "deck": [{"iid": "bd0", "printing": "sve-001"}, {"iid": "bd1", "printing": "sve-001"}, {"iid": "bd2", "printing": "sve-001"}, {"iid": "bd3", "printing": "sve-001"}, {"iid": "bd4", "printing": "sve-001"}, {"iid": "bd5", "printing": "sve-001"}, {"iid": "bd6", "printing": "sve-001"}, {"iid": "bd7", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-001", "faceUp": false}, {"iid": "bp1", "printing": "sve-001", "faceUp": false}, {"iid": "bp2", "printing": "sve-001", "faceUp": false}, {"iid": "bp3", "printing": "sve-001", "faceUp": false}, {"iid": "bp4", "printing": "sve-001", "faceUp": false}, {"iid": "bp5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "prizesTaken": 0, "vstarUsed": false}}}, "activeEffects": []};
const ACTIONS: NeutralAction[] = [{"actor": "A", "type": "useStadium"}, {"actor": "system", "type": "shuffle", "order": ["ad0", "ad1", "ad2", "ad3", "ad4", "ad5", "ad6", "ad7"]}, {"actor": "A", "type": "playItem", "card": "ah0"}, {"actor": "A", "type": "discard", "target": "st0", "owner": "B", "op": "discard", "destination": "discardPile"}];

describe('CF-102 / B.111: stadiumUsedThisTurn resets when the used Stadium leaves play', () => {
  it('[TA-726 pfl-086 control] after using Artazon, the flag is up while Artazon is in play', () => {
    const r = step(BOARD, ACTIONS.slice(0, 2));
    expect(r.state.stadium).not.toBeNull();
    expect(r.state.players.A.flags.stadiumUsedThisTurn).toBe(true);
  });

  it('[TA-726 pfl-086] Blowtorch discards Artazon: no Stadium in play, A.flags.stadiumUsedThisTurn is false', () => {
    const r = step(BOARD, ACTIONS);
    expect(r.applied).toBe(ACTIONS.length);
    expect(r.state.stadium).toBeNull();
    expect(r.state.players.A.flags.stadiumUsedThisTurn ?? false).toBe(false);
  });
});
