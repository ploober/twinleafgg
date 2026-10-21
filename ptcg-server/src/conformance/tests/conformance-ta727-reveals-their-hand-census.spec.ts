import { step } from '../driver';
import { NeutralState, NeutralAction, NeutralEvent } from '../neutral-types';

/**
 * TA-727 (TA-720's census, 2026-10-20): four more in-pool cards whose text has the opponent reveal their hand opened a
 * pick over the hand with no ShowCardsPrompt, so twinleaf emitted no reveal (B.97). Driven on :8090 b84900e99 x :8099
 * f3e92fdba: Erika's Invitation mew-160, Grabber mew-162 and Mr. Mime tef-063 Look-Alike Show emit none on twinleaf and
 * reveal the whole hand on rotomancer; Lillie's Ribombee jtg-067 Inviting Wink has the same code shape.
 * Board: the Eri row's board (tr-bench-pre-136) with the card under test swapped in.
 */

const BASE = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "B", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "asc-004"}], "energy": [{"iid": "ae20", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, {"stack": [{"iid": "ab2", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah4", "printing": "pre-136"}, {"iid": "ah1", "printing": "sve-001"}, {"iid": "ah2", "printing": "sve-005"}, {"iid": "ah3", "printing": "asc-004"}], "deck": [{"iid": "ad5", "printing": "sve-001"}, {"iid": "ad6", "printing": "sve-002"}, {"iid": "ad7", "printing": "sve-003"}, {"iid": "ad8", "printing": "sve-004"}, {"iid": "ad9", "printing": "sve-005"}, {"iid": "ad10", "printing": "sve-001"}, {"iid": "ad11", "printing": "sve-002"}, {"iid": "ad12", "printing": "sve-003"}, {"iid": "ad13", "printing": "sve-004"}, {"iid": "ad14", "printing": "sve-005"}, {"iid": "ad15", "printing": "asc-004"}, {"iid": "ad16", "printing": "asc-004"}, {"iid": "ad17", "printing": "asc-004"}, {"iid": "ad18", "printing": "por-083"}, {"iid": "ad19", "printing": "por-083"}], "discard": [{"iid": "ax21", "printing": "asc-004"}, {"iid": "ax22", "printing": "por-083"}], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}, {"iid": "ap3", "printing": "sve-003", "faceUp": false}, {"iid": "ap4", "printing": "sve-003", "faceUp": false}, {"iid": "ap5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "asc-004"}], "energy": [{"iid": "be19", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, {"stack": [{"iid": "bb2", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh1", "printing": "sve-001"}, {"iid": "bh2", "printing": "sve-005"}, {"iid": "bh3", "printing": "asc-004"}], "deck": [{"iid": "bd4", "printing": "sve-001"}, {"iid": "bd5", "printing": "sve-002"}, {"iid": "bd6", "printing": "sve-003"}, {"iid": "bd7", "printing": "sve-004"}, {"iid": "bd8", "printing": "sve-005"}, {"iid": "bd9", "printing": "sve-001"}, {"iid": "bd10", "printing": "sve-002"}, {"iid": "bd11", "printing": "sve-003"}, {"iid": "bd12", "printing": "sve-004"}, {"iid": "bd13", "printing": "sve-005"}, {"iid": "bd14", "printing": "asc-004"}, {"iid": "bd15", "printing": "asc-004"}, {"iid": "bd16", "printing": "asc-004"}, {"iid": "bd17", "printing": "por-083"}, {"iid": "bd18", "printing": "por-083"}], "discard": [{"iid": "bx20", "printing": "asc-004"}, {"iid": "bx21", "printing": "por-083"}], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}, {"iid": "bp3", "printing": "sve-003", "faceUp": false}, {"iid": "bp4", "printing": "sve-003", "faceUp": false}, {"iid": "bp5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
type Reveal = Extract<NeutralEvent, { kind: 'reveal' }>;
const reveals = (r: ReturnType<typeof step>) => (r.events.filter(e => e.kind === 'reveal') as Reveal[])
  .map(e => ({ owner: e.owner, from: e.from, cards: [...e.cards].sort() }));
function board(edit: (s: NeutralState) => void): NeutralState {
  const s = JSON.parse(JSON.stringify(BASE)) as NeutralState;
  s.players.B.hand = [{ iid: 'bh1', printing: 'sve-001' }, { iid: 'bh2', printing: 'asc-004' }];
  edit(s);
  return s;
}
const act = (a: object) => a as unknown as NeutralAction;
const WHOLE_HAND = [{ owner: 'B', from: 'hand', cards: ['bh1', 'bh2'] }];

describe('TA-727 "your opponent reveals their hand" reveals it before the pick', () => {
  it('[TA-727 mew-160] Erika\'s Invitation reveals the whole hand', () => {
    const r = step(board(s => { s.players.A.hand[0].printing = 'mew-160'; }), [act({ actor: 'A', type: 'playSupporter', card: 'ah4' })]);
    expect(reveals(r)).toEqual(WHOLE_HAND);
  });

  it('[TA-727 mew-162] Grabber reveals the whole hand', () => {
    const r = step(board(s => { s.players.A.hand[0].printing = 'mew-162'; }), [act({ actor: 'A', type: 'playItem', card: 'ah4' })]);
    expect(reveals(r)).toEqual(WHOLE_HAND);
  });

  it('[TA-727 tef-063] Mr. Mime Look-Alike Show reveals the whole hand', () => {
    const r = step(board(s => {
      s.players.A.active!.stack = [{ iid: 'mm', printing: 'tef-063' }];
      s.players.A.active!.energy = [{ iid: 'me0', printing: 'sve-005' }];
    }), [act({ actor: 'A', type: 'declareAttack', source: 'mm', name: 'Look-Alike Show' })]);
    expect(reveals(r)).toEqual(WHOLE_HAND);
  });

  it('[TA-727 jtg-067] Lillie\'s Ribombee Inviting Wink, accepted, reveals the whole hand', () => {
    const b = board(s => {
      s.players.A.bench[0].stack = [{ iid: 'cf', printing: 'jtg-066' }];
      s.players.A.hand[0].printing = 'jtg-067';
    });
    const r = step(b, [act({ actor: 'A', type: 'evolve', card: 'ah4', target: 'cf' }), act({ actor: 'A', type: 'confirm', value: true })]);
    expect(r.applied).toBe(2);
    expect(reveals(r)).toEqual(WHOLE_HAND);
  });

  it('[TA-727 jtg-067 control] Inviting Wink declined: nothing is revealed', () => {
    const b = board(s => {
      s.players.A.bench[0].stack = [{ iid: 'cf', printing: 'jtg-066' }];
      s.players.A.hand[0].printing = 'jtg-067';
    });
    const r = step(b, [act({ actor: 'A', type: 'evolve', card: 'ah4', target: 'cf' }), act({ actor: 'A', type: 'confirm', value: false })]);
    expect(reveals(r)).toEqual([]);
  });
});
