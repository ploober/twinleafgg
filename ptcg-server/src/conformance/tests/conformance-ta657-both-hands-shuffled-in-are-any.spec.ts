import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-657 (B.87): "Each player shuffles their hand into their deck" (Judge por-076; also Harlequin wht-083, Unfair Stamp
 * twm-165, Team Rocket's Archer dri-170) shuffles BOTH decks in the same effect, one shuffle at a time; every hand card
 * put into a deck is recorded at `position: any`, the second player's too, from the first pause on (B.90).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deckLegs = (res: any): any[] => (res.events || []).filter((e: any) => e.kind === 'moved' && e.destination && e.destination.zone === 'deck');
const JUDGE: NeutralState = {"schemaVersion": "0.1", "turn": 3, "activePlayer": "A", "firstPlayer": "B", "phase": "main", "outcome": "ongoing", "stadium": null, "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [], "hand": [{"iid": "sup", "printing": "por-076"}, {"iid": "x0", "printing": "sve-002"}, {"iid": "x1", "printing": "sve-002"}], "deck": [{"iid": "ad0", "printing": "sve-001"}, {"iid": "ad1", "printing": "sve-001"}, {"iid": "ad2", "printing": "sve-001"}, {"iid": "ad3", "printing": "sve-001"}, {"iid": "ad4", "printing": "sve-001"}, {"iid": "ad5", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-001", "faceUp": false}, {"iid": "ap1", "printing": "sve-001", "faceUp": false}, {"iid": "ap2", "printing": "sve-001", "faceUp": false}, {"iid": "ap3", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [], "hand": [{"iid": "y0", "printing": "sve-003"}, {"iid": "y1", "printing": "sve-003"}, {"iid": "y2", "printing": "sve-003"}], "deck": [{"iid": "bd0", "printing": "sve-001"}, {"iid": "bd1", "printing": "sve-001"}, {"iid": "bd2", "printing": "sve-001"}, {"iid": "bd3", "printing": "sve-001"}, {"iid": "bd4", "printing": "sve-001"}, {"iid": "bd5", "printing": "sve-001"}, {"iid": "bd6", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-001", "faceUp": false}, {"iid": "bp1", "printing": "sve-001", "faceUp": false}, {"iid": "bp2", "printing": "sve-001", "faceUp": false}, {"iid": "bp3", "printing": "sve-001", "faceUp": false}, {"iid": "bp4", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}} as unknown as NeutralState;
const ACTIONS = [{"actor": "A", "type": "playSupporter", "card": "sup"}, {"actor": "system", "type": "shuffle", "order": ["x1", "ad0", "ad1", "ad2", "ad3", "ad4", "ad5", "x0"]}, {"actor": "system", "type": "shuffle", "order": ["y0", "y1", "y2", "bd0", "bd1", "bd2", "bd3", "bd4", "bd5", "bd6"]}] as never[];

describe('TA-657: both hands shuffled in are recorded at deck:any', () => {
  it('at the first shuffle pause every hand-to-deck leg, both players, is any [TA-657]', () => {
    const legs = deckLegs(step(JUDGE, ACTIONS.slice(0, 1)));
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.filter((e: any) => e.destination.position !== 'any').map((e: any) => e.card)).toEqual([]);
    expect(new Set(legs.map((e: any) => e.owner)).size).toBe(2);
  });
});
