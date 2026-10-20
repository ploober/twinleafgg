import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-725: a main-menu action the adapter's own menu withholds was dispatched to the engine unchecked, so a legality gate
 * that lives in legal-actions.ts (TA-280's deck-0 gate; B.47) bound the offer but not the play. CF-12 / B.95: an action
 * that is not offered is invalidAction. Board: suite row ta632-obf-188-geeta-empty-deck-still-locks-attacks (A's deck
 * empty; Geeta obf-188 in hand; B.47 makes it unplayable). Rotomancer 2e659f4ba refuses it.
 */

const BOARD = {"schemaVersion": "0.1", "turn": 3, "activePlayer": "A", "firstPlayer": "B", "phase": "main", "outcome": "ongoing", "stadium": null, "format": "unlimited", "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "asc-004"}], "energy": [{"iid": "ae0", "printing": "sve-001"}], "tools": [], "damage": 0, "conditions": [], "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [{"stack": [{"iid": "ab1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}], "hand": [{"iid": "g", "printing": "obf-188"}], "deck": [], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-001", "faceUp": false}, {"iid": "ap1", "printing": "sve-001", "faceUp": false}, {"iid": "ap2", "printing": "sve-001", "faceUp": false}, {"iid": "ap3", "printing": "sve-001", "faceUp": false}, {"iid": "ap4", "printing": "sve-001", "faceUp": false}, {"iid": "ap5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [], "hand": [], "deck": [{"iid": "bd0", "printing": "sve-001"}, {"iid": "bd1", "printing": "sve-001"}, {"iid": "bd2", "printing": "sve-001"}, {"iid": "bd3", "printing": "sve-001"}, {"iid": "bd4", "printing": "sve-001"}, {"iid": "bd5", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-001", "faceUp": false}, {"iid": "bp1", "printing": "sve-001", "faceUp": false}, {"iid": "bp2", "printing": "sve-001", "faceUp": false}, {"iid": "bp3", "printing": "sve-001", "faceUp": false}, {"iid": "bp4", "printing": "sve-001", "faceUp": false}, {"iid": "bp5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}} as unknown as NeutralState;
const GEETA = { actor: 'A', type: 'playSupporter', card: 'g' } as unknown as NeutralAction;

describe('TA-725 a main-menu action the menu does not offer is invalidAction', () => {
  it('[TA-725 obf-188] Geeta at deck 0 is not offered, and playing it anyway is refused', () => {
    const root = step(BOARD, []);
    expect(root.pending!.legalActions.some(a => a.type === 'playSupporter')).toBe(false);
    const r = step(BOARD, [GEETA]);
    expect(r.status).toBe('invalidAction');
    expect(r.applied).toBe(0);
    expect(r.state.players.A.hand.map(c => c.iid)).toContain('g');
  });

  it('[TA-725 obf-188 control] an offered action (endTurn) is still applied', () => {
    const r = step(BOARD, [{ actor: 'A', type: 'endTurn' } as unknown as NeutralAction]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.applied).toBe(1);
  });

  it('[TA-725 actor] the right verb from the player whose turn it is not is refused', () => {
    const r = step(BOARD, [{ actor: 'B', type: 'endTurn' } as unknown as NeutralAction]);
    expect(r.status).toBe('invalidAction');
  });
});
