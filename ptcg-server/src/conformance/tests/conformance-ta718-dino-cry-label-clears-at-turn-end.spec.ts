import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-718: Koraidon ex paf-245 Dino Cry ("Once during your turn, you may attach up to 2 Basic [F] Energy cards from your
 * discard pile to your Basic [F] Pokémon in any way you like. If you use this Ability, your turn ends.") ends the turn
 * inside its own body; the engine marked the "once during your turn" use AFTER the body returned, i.e. on the opponent's
 * turn, past the end-of-turn clear. B.92: the label clears when the turn ends. Board: the Unlimited fuzz row enum-paf-245
 * (results/fuzz-20261020-graviton-unlimited-enum); rotomancer 936314650 projects [] on B's turn.
 */

const BOARD = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1s0", "printing": "paf-245"}], "energy": [{"iid": "a1e1", "printing": "sve-006"}, {"iid": "a1e2", "printing": "sve-006"}, {"iid": "a1e3", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah4", "printing": "sve-001"}, {"iid": "ah5", "printing": "sve-005"}], "deck": [{"iid": "ad6", "printing": "sve-003"}, {"iid": "ad7", "printing": "sve-001"}, {"iid": "ad8", "printing": "sve-005"}, {"iid": "ad9", "printing": "asc-001"}, {"iid": "ad10", "printing": "asc-002"}, {"iid": "ad11", "printing": "asc-216"}, {"iid": "ad12", "printing": "asc-184"}, {"iid": "ad13", "printing": "asc-182"}, {"iid": "ad14", "printing": "asc-188"}, {"iid": "ad15", "printing": "sve-001"}, {"iid": "ad16", "printing": "sve-005"}, {"iid": "ad17", "printing": "sve-002"}, {"iid": "ad18", "printing": "sve-003"}, {"iid": "ad19", "printing": "sve-001"}, {"iid": "ad20", "printing": "sve-005"}, {"iid": "ad21", "printing": "sve-002"}, {"iid": "ad22", "printing": "sve-003"}, {"iid": "ad23", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}, {"iid": "ap3", "printing": "sve-003", "faceUp": false}, {"iid": "ap4", "printing": "sve-003", "faceUp": false}, {"iid": "ap5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1s0", "printing": "asc-004"}], "energy": [{"iid": "b1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh2", "printing": "sve-001"}, {"iid": "bh3", "printing": "sve-005"}], "deck": [{"iid": "bd4", "printing": "sve-003"}, {"iid": "bd5", "printing": "sve-001"}, {"iid": "bd6", "printing": "sve-005"}, {"iid": "bd7", "printing": "asc-001"}, {"iid": "bd8", "printing": "asc-002"}, {"iid": "bd9", "printing": "asc-216"}, {"iid": "bd10", "printing": "asc-184"}, {"iid": "bd11", "printing": "asc-182"}, {"iid": "bd12", "printing": "asc-188"}, {"iid": "bd13", "printing": "sve-001"}, {"iid": "bd14", "printing": "sve-005"}, {"iid": "bd15", "printing": "sve-002"}, {"iid": "bd16", "printing": "sve-003"}, {"iid": "bd17", "printing": "sve-001"}, {"iid": "bd18", "printing": "sve-005"}, {"iid": "bd19", "printing": "sve-002"}, {"iid": "bd20", "printing": "sve-003"}, {"iid": "bd21", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}, {"iid": "bp3", "printing": "sve-003", "faceUp": false}, {"iid": "bp4", "printing": "sve-003", "faceUp": false}, {"iid": "bp5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const ACTIONS = [{"actor": "A", "type": "retreat", "to": 0}, {"actor": "A", "type": "discard", "target": "a1e1", "owner": "A", "op": "discard", "destination": "discardPile"}, {"actor": "A", "type": "discard", "target": "a1e3", "owner": "A", "op": "discard", "destination": "discardPile"}, {"actor": "A", "type": "useAbility", "source": "a1s0", "ability": "Dino Cry"}] as unknown as NeutralAction[];

describe('TA-718 Dino Cry: the use label does not survive the turn end the Ability causes', () => {
  it('[TA-718 paf-245 control] Dino Cry is used: its Energy is attached and the turn passes to B', () => {
    const r = step(BOARD, ACTIONS);
    expect(r.applied).toBe(ACTIONS.length);
    expect(r.state.activePlayer).toBe('B');
    expect(r.events.some(e => e.kind === 'turnEnded')).toBe(true);
    expect(r.events.some(e => e.kind === 'abilityUsed')).toBe(true);
  });

  it('[TA-718 paf-245] on B\'s turn no Pokémon of A is labelled with Dino Cry', () => {
    const r = step(BOARD, ACTIONS);
    const A = r.state.players.A;
    const mons = [A.active!, ...A.bench];
    expect(mons.map(m => m.markers.abilitiesUsedThisTurn)).toEqual(mons.map(() => []));
  });

  // Re-fuzz results/fuzz-20261020-graviton-unlimited-refuzz (85a60e9e5 x f3e92fdba), fz-enum-paf-245-divergence-8bfa91:
  // with two Basic [F] Energy in the discard pile the attach is a real pick, A's turn has not ended, and B.57 (a)
  // labels the use at the announcement; rotomancer projects [Dino Cry] there.
  const TWO = ACTIONS.map(a => (a as { target?: string }).target === 'a1e3' ? { ...a, target: 'a1e2' } as NeutralAction : a);

  it('[TA-718 paf-245 open pick] while A picks the Energy, Koraidon ex is labelled with Dino Cry', () => {
    const r = step(BOARD, TWO);
    expect(r.applied).toBe(TWO.length);
    expect(r.state.activePlayer).toBe('A');
    expect(r.pending?.actor).toBe('A');
    const koraidon = r.state.players.A.bench.find(m => m.stack.some(c => c.printing === 'paf-245'))!;
    expect(koraidon.markers.abilitiesUsedThisTurn).toEqual(['Dino Cry']);
  });
});
