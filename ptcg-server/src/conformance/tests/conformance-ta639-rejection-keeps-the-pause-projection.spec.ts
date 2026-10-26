import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-639: an invalidAction response reports `applied` = the actions applied before the refused one, so its board and
 * trace are the applied prefix's: the same board (with the pause's fix-ups, CF-1 / B.80) and the same events (with the
 * pause's own events and moved legs, B.81) as the response to that prefix. Twinleaf built the rejection from the
 * rolled-back store with the open decision's picks dropped: Veluza par-054 Fillet Memento after one Energy moved to a2,
 * then a refused move to a3 (one Benched Pokemon only, FX-0419), answered with both Water still on the Active and no
 * `moved` a1e0, though its own applied-2 response shows a1e0 on a2. Board: rf3-07 (re-fuzz batch3-refuzz-20261006).
 */
const BOARD: NeutralState = {"schemaVersion": "0.1", "stadium": null, "format": "unlimited", "turn": 4, "activePlayer": "B", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "par-054"}], "energy": [{"iid": "a1e0", "printing": "sve-003"}, {"iid": "a1e1", "printing": "sve-003"}], "tools": [], "damage": 90, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "a2", "printing": "twm-118"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, {"stack": [{"iid": "a3", "printing": "twm-118"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah0", "printing": "sve-003"}], "deck": [{"iid": "ad0", "printing": "sve-003"}, {"iid": "ad1", "printing": "sve-003"}, {"iid": "ad2", "printing": "sve-003"}, {"iid": "ad3", "printing": "sve-003"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}, {"iid": "ap3", "printing": "sve-003", "faceUp": false}, {"iid": "ap4", "printing": "sve-003", "faceUp": false}, {"iid": "ap5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "asc-062"}], "energy": [{"iid": "b1e0", "printing": "sve-004"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [], "hand": [{"iid": "bh0", "printing": "sve-003"}], "deck": [{"iid": "bd0", "printing": "sve-003"}, {"iid": "bd1", "printing": "sve-003"}, {"iid": "bd2", "printing": "sve-003"}, {"iid": "bd3", "printing": "sve-003"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}, {"iid": "bp3", "printing": "sve-003", "faceUp": false}, {"iid": "bp4", "printing": "sve-003", "faceUp": false}, {"iid": "bp5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []};
const A = (o: object) => ({ actor: 'A', ...o }) as never;
const ATTACK = { actor: 'B', type: 'declareAttack', source: 'b1', name: 'Pouncing Trap' } as never;
// TA-769 / B.120 (amended, owner 2026-10-25): the Energy are picked first, then the one Benched Pokémon; the first pick
// names a1e0 alone and holds it (in transit, B.80) until the Pokémon is chosen. The refused action is a (card, Pokémon)
// pair, which is no longer offered.
const TO_A2 = A({ type: 'choose', target: 'a1e0' });
const TO_A3 = A({ type: 'moveEnergy', card: 'a1e1', target: 'a3', source: 'a1' });
const energyOn = (s: NeutralState, iid: string): string[] => {
  const p = s.players.A;
  const mon = [p.active, ...p.bench].find(m => m !== null && m.stack[0].iid === iid);
  return mon ? mon.energy.map(e => e.iid) : [];
};

describe('TA-639: a rejected action at a pause reports the applied prefix\'s projected board and trace', () => {
  it('Fillet Memento: the refused pair keeps a1e0 held, as at the applied-2 pause [TA-639]', () => {
    const prefix = step(BOARD, [ATTACK, TO_A2]);
    const res = step(BOARD, [ATTACK, TO_A2, TO_A3]);
    expect(res.status).toBe('invalidAction');
    expect(res.applied).toBe(2);
    const held = (st: NeutralState) => (st.players.A.transit ?? []).map(t => t.iid);
    expect(held(prefix.state)).toContain('a1e0');
    expect(held(res.state)).toContain('a1e0');
    expect(energyOn(res.state, 'a1')).not.toContain('a1e0');
    expect(res.state).toEqual(prefix.state);
  });
  it('Fillet Memento: the refused step\'s events equal the applied-2 response\'s, its moved a1e0 leg included [TA-639]', () => {
    const prefix = step(BOARD, [ATTACK, TO_A2]);
    const res = step(BOARD, [ATTACK, TO_A2, TO_A3]);
    expect(res.events).toEqual(prefix.events);
    expect(res.events.some(e => e.kind === 'moved' && (e as { card?: string }).card === 'a1e0')).toBe(true);
  });
  it('control: a top-level action refused at a quiescent boundary reports the prefix\'s board and events [TA-639]', () => {
    const prefix = step(BOARD, []);
    const res = step(BOARD, [A({ type: 'endTurn' })]);
    expect(res.status).toBe('invalidAction');
    expect(res.applied).toBe(0);
    expect(res.state).toEqual(prefix.state);
    expect(res.events).toEqual(prefix.events);
  });
});
