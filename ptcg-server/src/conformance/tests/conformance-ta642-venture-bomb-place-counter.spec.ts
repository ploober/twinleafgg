import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-642: Team Rocket's Venture Bomb dri-179 ("Flip a coin. If heads, put 2 damage counters on 1 of your opponent's
 * Pokémon.") places damage counters on the picked Pokémon, so the pick is offered as `placeCounter` (CF-32), not
 * `choose`; its prompt now declares `operation: 'placeCounters'`. Board: scenario
 * ta264-dri-179-venture-bomb-tails-lethal-counters-emit-damaged-before-ko.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legal = (res: any): any[] => (res.pending && res.pending.legalActions) || [];
const BOMB: NeutralState = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "stadium": null, "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 40, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [{"stack": [{"iid": "ab0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}], "hand": [{"iid": "ah0", "printing": "dri-179"}], "deck": [{"iid": "ad0", "printing": "sve-003"}, {"iid": "ad1", "printing": "sve-003"}, {"iid": "ad2", "printing": "sve-003"}, {"iid": "ad3", "printing": "sve-003"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-001", "faceUp": false}, {"iid": "ap1", "printing": "sve-001", "faceUp": false}, {"iid": "ap2", "printing": "sve-001", "faceUp": false}, {"iid": "ap3", "printing": "sve-001", "faceUp": false}, {"iid": "ap4", "printing": "sve-001", "faceUp": false}, {"iid": "ap5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}, "bench": [{"stack": [{"iid": "bb0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}}], "hand": [], "deck": [{"iid": "bd0", "printing": "sve-003"}, {"iid": "bd1", "printing": "sve-003"}, {"iid": "bd2", "printing": "sve-003"}, {"iid": "bd3", "printing": "sve-003"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-001", "faceUp": false}, {"iid": "bp1", "printing": "sve-001", "faceUp": false}, {"iid": "bp2", "printing": "sve-001", "faceUp": false}, {"iid": "bp3", "printing": "sve-001", "faceUp": false}, {"iid": "bp4", "printing": "sve-001", "faceUp": false}, {"iid": "bp5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}} as unknown as NeutralState;
const act = (o: object) => o as never;

describe('TA-642: Venture Bomb\'s heads pick is a damage-counter placement', () => {
  it('heads: the target pick is offered as placeCounter, never choose [TA-642]', () => {
    const res = step(BOMB, [act({ actor: 'A', type: 'playItem', card: 'ah0' }), act({ actor: 'system', type: 'flip', face: 'heads' })]);
    expect(res.status).toBe('awaitingAction');
    const types = legal(res).map((a: any) => a.type);
    expect(types).toContain('placeCounter');
    expect(types).not.toContain('choose');
    expect(legal(res).filter((a: any) => a.type === 'placeCounter').every((a: any) => a.op === 'placeCounters')).toBe(true);
  });
});
