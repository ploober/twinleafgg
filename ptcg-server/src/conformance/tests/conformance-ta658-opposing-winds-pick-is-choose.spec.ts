import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-658: Unfezant tef-135 Opposing Winds ("You may put 2 Energy attached to your opponent's Active Pokémon into their
 * hand.") moves the picked Energy to the opponent's HAND, so the pick is a `choose` (CF-32 / CF-8), not a `discard` to
 * the discard pile (TA-650's shape). Board: the batch-10 re-fuzz row (B's Active holds three Energy, so the pick of 2
 * is a real decision).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legal = (res: any): any[] => (res.pending && res.pending.legalActions) || [];
const BOARD: NeutralState = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "B", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "tef-135"}], "energy": [{"iid": "a1e0", "printing": "sve-001"}, {"iid": "a1e1", "printing": "sve-001"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [], "hand": [], "deck": [{"iid": "ad0", "printing": "sve-001"}, {"iid": "ad1", "printing": "sve-001"}, {"iid": "ad2", "printing": "sve-001"}, {"iid": "ad3", "printing": "sve-001"}, {"iid": "ad4", "printing": "sve-001"}, {"iid": "ad5", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-001", "faceUp": false}, {"iid": "ap1", "printing": "sve-001", "faceUp": false}, {"iid": "ap2", "printing": "sve-001", "faceUp": false}, {"iid": "ap3", "printing": "sve-001", "faceUp": false}, {"iid": "ap4", "printing": "sve-001", "faceUp": false}, {"iid": "ap5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "mew-003"}], "energy": [{"iid": "b1e0", "printing": "sve-001"}, {"iid": "b1e1", "printing": "sve-005"}, {"iid": "b1e2", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "b2", "printing": "svi-061"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh0", "printing": "sve-001"}], "deck": [{"iid": "bd0", "printing": "sve-001"}, {"iid": "bd1", "printing": "sve-001"}, {"iid": "bd2", "printing": "sve-001"}, {"iid": "bd3", "printing": "sve-001"}, {"iid": "bd4", "printing": "sve-001"}, {"iid": "bd5", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-001", "faceUp": false}, {"iid": "bp1", "printing": "sve-001", "faceUp": false}, {"iid": "bp2", "printing": "sve-001", "faceUp": false}, {"iid": "bp3", "printing": "sve-001", "faceUp": false}, {"iid": "bp4", "printing": "sve-001", "faceUp": false}, {"iid": "bp5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const ACTIONS = [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Opposing Winds' }, { actor: 'A', type: 'confirm', value: true }] as never[];

describe('TA-658: Opposing Winds picks the Energy it returns to the hand', () => {
  it('the Energy pick is offered as choose, never discard [TA-658]', () => {
    const res = step(BOARD, ACTIONS);
    const types = legal(res).map((a: any) => a.type);
    expect(types.length).toBe(3);
    expect(types.every((t: string) => t === 'choose')).toBe(true);
  });
  it('the picked Energy go to the opponent\'s hand [TA-658]', () => {
    const res = step(BOARD, [...ACTIONS,
      { actor: 'A', type: 'choose', target: 'b1e0' } as never, { actor: 'A', type: 'choose', target: 'b1e1' } as never]);
    expect(res.state.players.B.hand.map(c => c.iid)).toEqual(jasmine.arrayContaining(['b1e0', 'b1e1']));
    expect(res.state.players.B.discard.map(c => c.iid)).not.toContain('b1e0');
  });
});

/**
 * TA-658 (same defect, Crocalor par-024 Rolling Fireball: "Put an Energy attached to this Pokémon into your hand."): the
 * pick is a `choose`, and by B.89 (1), (4) it is the attacker's Step-D choice, asked before the damage (recorded
 * `chosen`), with the Energy going to the hand after the damage.
 */
const CROC: NeutralState = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "B", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "par-024"}], "energy": [{"iid": "a1e0", "printing": "sve-002"}, {"iid": "a1e1", "printing": "sve-002"}, {"iid": "a1e2", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [], "hand": [], "deck": [{"iid": "ad0", "printing": "sve-001"}, {"iid": "ad1", "printing": "sve-001"}, {"iid": "ad2", "printing": "sve-001"}, {"iid": "ad3", "printing": "sve-001"}, {"iid": "ad4", "printing": "sve-001"}, {"iid": "ad5", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-001", "faceUp": false}, {"iid": "ap1", "printing": "sve-001", "faceUp": false}, {"iid": "ap2", "printing": "sve-001", "faceUp": false}, {"iid": "ap3", "printing": "sve-001", "faceUp": false}, {"iid": "ap4", "printing": "sve-001", "faceUp": false}, {"iid": "ap5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "mew-003"}], "energy": [{"iid": "b1e0", "printing": "sve-001"}, {"iid": "b1e1", "printing": "sve-005"}, {"iid": "b1e2", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "b2", "printing": "svi-061"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh0", "printing": "sve-001"}], "deck": [{"iid": "bd0", "printing": "sve-001"}, {"iid": "bd1", "printing": "sve-001"}, {"iid": "bd2", "printing": "sve-001"}, {"iid": "bd3", "printing": "sve-001"}, {"iid": "bd4", "printing": "sve-001"}, {"iid": "bd5", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-001", "faceUp": false}, {"iid": "bp1", "printing": "sve-001", "faceUp": false}, {"iid": "bp2", "printing": "sve-001", "faceUp": false}, {"iid": "bp3", "printing": "sve-001", "faceUp": false}, {"iid": "bp4", "printing": "sve-001", "faceUp": false}, {"iid": "bp5", "printing": "sve-001", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const ROLL = [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Rolling Fireball' }] as never[];

describe('TA-658: Rolling Fireball picks the Energy it returns to the hand', () => {
  it('the Energy pick is offered as choose before the damage [TA-658]', () => {
    const res = step(CROC, ROLL);
    const types = legal(res).map((a: any) => a.type);
    expect(types.length).toBe(3);
    expect(types.every((t: string) => t === 'choose')).toBe(true);
    expect(res.state.players.B.active!.damage).toBe(0);
  });
  it('the Energy goes to the hand after the damage [TA-658]', () => {
    const res = step(CROC, [...ROLL, { actor: 'A', type: 'choose', target: 'a1e2' } as never]);
    expect(res.state.players.A.hand.map(c => c.iid)).toContain('a1e2');
    expect(res.state.players.A.discard.map(c => c.iid)).not.toContain('a1e2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kinds = (res.events as any[]).map(e => e.kind === 'moved' && e.card === 'a1e2' ? 'move' : e.kind);
    expect(kinds).toContain('chosen');
    expect(kinds.indexOf('damaged')).toBeLessThan(kinds.indexOf('move'));
  });
});
