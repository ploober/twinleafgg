import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-656: a mode menu left with ONE option is a decision with one resolution (CF-14), so it is applied with no pending.
 * Kieran twm-154 ("Choose 1: Switch your Active Pokemon with 1 of your Benched Pokemon. / During this turn, attacks used
 * by your Pokemon do 30 more damage to your opponent's Active Pokemon ex and Active Pokemon V") with no Benched Pokemon:
 * the Switch mode can achieve nothing and is withheld (B.91), so the boost applies directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legal = (res: any): any[] => (res.pending && res.pending.legalActions) || [];
const NO_BENCH: NeutralState = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "stadium": null, "players": {"A": {"active": {"stack": [{"iid": "a1", "printing": "asc-004"}], "energy": [{"iid": "a1e0", "printing": "sve-001"}, {"iid": "a1e1", "printing": "sve-001"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [], "hand": [{"iid": "ah0", "printing": "twm-154"}, {"iid": "ah1", "printing": "sve-001"}], "deck": [{"iid": "ad0", "printing": "sve-001"}, {"iid": "ad1", "printing": "sve-001"}, {"iid": "ad2", "printing": "sve-001"}, {"iid": "ad3", "printing": "sve-001"}, {"iid": "ad4", "printing": "sve-001"}, {"iid": "ad5", "printing": "sve-001"}, {"iid": "ad6", "printing": "sve-001"}, {"iid": "ad7", "printing": "sve-001"}, {"iid": "ad8", "printing": "sve-001"}, {"iid": "ad9", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1", "printing": "mew-003"}], "energy": [{"iid": "b1e0", "printing": "sve-002"}, {"iid": "b1e1", "printing": "sve-004"}], "tools": [{"iid": "b1t0", "printing": "asc-181"}], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1", "printing": "asc-004"}], "energy": [{"iid": "bb1e0", "printing": "sve-005"}], "tools": [{"iid": "bb1t0", "printing": "asc-181"}], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, {"stack": [{"iid": "bb2", "printing": "asc-004"}], "energy": [{"iid": "bb2e0", "printing": "sve-006"}], "tools": [{"iid": "bb2t0", "printing": "asc-181"}], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh0", "printing": "sve-001"}, {"iid": "bh1", "printing": "sve-005"}, {"iid": "bh2", "printing": "asc-004"}, {"iid": "bh3", "printing": "meg-131"}], "deck": [{"iid": "bd0", "printing": "sve-001"}, {"iid": "bd1", "printing": "sve-001"}, {"iid": "bd2", "printing": "sve-001"}, {"iid": "bd3", "printing": "sve-001"}, {"iid": "bd4", "printing": "sve-001"}, {"iid": "bd5", "printing": "sve-001"}, {"iid": "bd6", "printing": "sve-001"}, {"iid": "bd7", "printing": "sve-001"}, {"iid": "bd8", "printing": "sve-001"}, {"iid": "bd9", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}} as unknown as NeutralState;
const play = [{ actor: 'A', type: 'playSupporter', card: 'ah0' } as never];

describe('TA-656: a one-option mode menu collapses', () => {
  it('Kieran with no Benched Pokemon: no selectOption is pended, the turn menu is back [TA-656]', () => {
    const res = step(NO_BENCH, play);
    expect(legal(res).some((a: any) => a.type === 'selectOption')).toBe(false);
    expect(legal(res).some((a: any) => a.type === 'endTurn')).toBe(true);
    expect(res.state.players.A.discard.map(c => c.iid)).toContain('ah0');
  });
  it('control: with a Benched Pokemon both modes are offered [TA-656]', () => {
    const s = JSON.parse(JSON.stringify(NO_BENCH));
    s.players.A.bench = [JSON.parse(JSON.stringify(s.players.A.active))];
    s.players.A.bench[0].stack[0].iid = 'ab1'; s.players.A.bench[0].energy = [];
    const opts = legal(step(s, play)).filter((a: any) => a.type === 'selectOption');
    expect(opts.length).toBe(2);
  });
});
