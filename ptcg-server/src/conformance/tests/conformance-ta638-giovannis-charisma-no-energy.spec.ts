import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-638: Giovanni's Charisma mew-161 ("Put an Energy attached to your opponent's Active Pokémon into their hand.
 * If you do, attach an Energy card from your hand to your Active Pokémon.") has no operand when the opponent's
 * Active has no Energy attached (B.29), so it is not offered and a forced play is refused; the Supporter for the
 * turn is not spent. Board: the TA-533 board (r332, docs/fuzz-20260929-unlimited-classD) with B's Energy removed.
 */
const clone = (s: NeutralState): NeutralState => JSON.parse(JSON.stringify(s));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legal = (res: any): any[] => (res.pending && res.pending.legalActions) || [];
const GIO: NeutralState = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1s0", "printing": "asc-004"}], "energy": [{"iid": "a1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 30, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, {"stack": [{"iid": "ab2s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah2", "printing": "mew-161"}, {"iid": "ah3", "printing": "sve-001"}, {"iid": "ah4", "printing": "sve-005"}], "deck": [{"iid": "ad5", "printing": "sve-003"}, {"iid": "ad6", "printing": "sve-001"}, {"iid": "ad7", "printing": "sve-005"}, {"iid": "ad8", "printing": "asc-001"}, {"iid": "ad9", "printing": "asc-002"}, {"iid": "ad10", "printing": "asc-216"}, {"iid": "ad11", "printing": "asc-184"}, {"iid": "ad12", "printing": "asc-182"}, {"iid": "ad13", "printing": "asc-188"}, {"iid": "ad14", "printing": "sve-001"}, {"iid": "ad15", "printing": "sve-005"}, {"iid": "ad16", "printing": "sve-002"}, {"iid": "ad17", "printing": "sve-003"}, {"iid": "ad18", "printing": "sve-001"}, {"iid": "ad19", "printing": "sve-005"}, {"iid": "ad20", "printing": "sve-002"}, {"iid": "ad21", "printing": "sve-003"}, {"iid": "ad22", "printing": "sve-001"}], "discard": [{"iid": "ax23", "printing": "sve-002"}, {"iid": "ax24", "printing": "sve-004"}], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}, {"iid": "ap3", "printing": "sve-003", "faceUp": false}, {"iid": "ap4", "printing": "sve-003", "faceUp": false}, {"iid": "ap5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1s0", "printing": "asc-004"}], "energy": [{"iid": "b1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh2", "printing": "sve-001"}, {"iid": "bh3", "printing": "sve-005"}], "deck": [{"iid": "bd4", "printing": "sve-003"}, {"iid": "bd5", "printing": "sve-001"}, {"iid": "bd6", "printing": "sve-005"}, {"iid": "bd7", "printing": "asc-001"}, {"iid": "bd8", "printing": "asc-002"}, {"iid": "bd9", "printing": "asc-216"}, {"iid": "bd10", "printing": "asc-184"}, {"iid": "bd11", "printing": "asc-182"}, {"iid": "bd12", "printing": "asc-188"}, {"iid": "bd13", "printing": "sve-001"}, {"iid": "bd14", "printing": "sve-005"}, {"iid": "bd15", "printing": "sve-002"}, {"iid": "bd16", "printing": "sve-003"}, {"iid": "bd17", "printing": "sve-001"}, {"iid": "bd18", "printing": "sve-005"}, {"iid": "bd19", "printing": "sve-002"}, {"iid": "bd20", "printing": "sve-003"}, {"iid": "bd21", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}, {"iid": "bp3", "printing": "sve-003", "faceUp": false}, {"iid": "bp4", "printing": "sve-003", "faceUp": false}, {"iid": "bp5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const A = (o: object) => ({ actor: 'A', ...o }) as never;
const offersCharisma = (res: unknown): boolean =>
  legal(res).some((a: any) => a.type === 'playSupporter' && a.card === 'ah2');

describe('TA-638: Giovanni\'s Charisma needs an Energy on the opponent\'s Active', () => {
  const bare = (): NeutralState => {
    const s = clone(GIO);
    s.players.B.active!.energy = [];
    return s;
  };
  it('opponent\'s Active with no Energy: Charisma is not offered [TA-638]', () => {
    const res = step(bare(), []);
    expect(res.status).toBe('awaitingAction');
    expect(offersCharisma(res)).toBe(false);
  });
  it('opponent\'s Active with no Energy: a forced play is refused and the card stays in hand [TA-638]', () => {
    const res = step(bare(), [A({ type: 'playSupporter', card: 'ah2' })]);
    expect(res.status).toBe('invalidAction');
    expect(res.state.players.A.hand.map(c => c.iid)).toContain('ah2');
  });
  it('control: opponent\'s Active with an Energy: Charisma is offered and resolves [TA-638]', () => {
    expect(offersCharisma(step(GIO, []))).toBe(true);
    const res = step(GIO, [A({ type: 'attachEnergy', card: 'ah3', target: 'a1s0' }), A({ type: 'playSupporter', card: 'ah2' })]);
    expect(res.state.players.B.hand.map(c => c.iid)).toContain('b1e1');
    expect(res.state.players.A.discard.map(c => c.iid)).toContain('ah2');
  });
});
