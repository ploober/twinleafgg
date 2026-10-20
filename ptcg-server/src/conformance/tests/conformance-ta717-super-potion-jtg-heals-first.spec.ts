import { step } from '../driver';
import { NeutralState, NeutralAction, NeutralEvent } from '../neutral-types';

/**
 * TA-717: Super Potion jtg-158 ("Heal 60 damage from 1 of your Pokémon. If you healed any damage in this way, discard an
 * Energy from that Pokémon.") reused the XY class ("Discard an Energy … in order to heal 60"): it was withheld from a
 * damaged Pokémon with no Energy, and it asked the Energy before healing. Board: the Unlimited fuzz row enum-jtg-158
 * (results/fuzz-20261020-graviton-unlimited-enum); A's Benched ab1s0 has 30 damage and no Energy, ab2s0 none.
 * Rotomancer 936314650: offered with no Energy; heals 30 first, then discards (forced with one Energy).
 */

const BOARD = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1s0", "printing": "asc-004"}], "energy": [{"iid": "a1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 30, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, {"stack": [{"iid": "ab2s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah2", "printing": "jtg-158"}, {"iid": "ah3", "printing": "sve-001"}, {"iid": "ah4", "printing": "sve-005"}], "deck": [{"iid": "ad5", "printing": "sve-003"}, {"iid": "ad6", "printing": "sve-001"}, {"iid": "ad7", "printing": "sve-005"}, {"iid": "ad8", "printing": "asc-001"}, {"iid": "ad9", "printing": "asc-002"}, {"iid": "ad10", "printing": "asc-216"}, {"iid": "ad11", "printing": "asc-184"}, {"iid": "ad12", "printing": "asc-182"}, {"iid": "ad13", "printing": "asc-188"}, {"iid": "ad14", "printing": "sve-001"}, {"iid": "ad15", "printing": "sve-005"}, {"iid": "ad16", "printing": "sve-002"}, {"iid": "ad17", "printing": "sve-003"}, {"iid": "ad18", "printing": "sve-001"}, {"iid": "ad19", "printing": "sve-005"}, {"iid": "ad20", "printing": "sve-002"}, {"iid": "ad21", "printing": "sve-003"}, {"iid": "ad22", "printing": "sve-001"}], "discard": [{"iid": "ax23", "printing": "sve-002"}, {"iid": "ax24", "printing": "sve-004"}], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}, {"iid": "ap3", "printing": "sve-003", "faceUp": false}, {"iid": "ap4", "printing": "sve-003", "faceUp": false}, {"iid": "ap5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1s0", "printing": "asc-004"}], "energy": [{"iid": "b1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh2", "printing": "sve-001"}, {"iid": "bh3", "printing": "sve-005"}], "deck": [{"iid": "bd4", "printing": "sve-003"}, {"iid": "bd5", "printing": "sve-001"}, {"iid": "bd6", "printing": "sve-005"}, {"iid": "bd7", "printing": "asc-001"}, {"iid": "bd8", "printing": "asc-002"}, {"iid": "bd9", "printing": "asc-216"}, {"iid": "bd10", "printing": "asc-184"}, {"iid": "bd11", "printing": "asc-182"}, {"iid": "bd12", "printing": "asc-188"}, {"iid": "bd13", "printing": "sve-001"}, {"iid": "bd14", "printing": "sve-005"}, {"iid": "bd15", "printing": "sve-002"}, {"iid": "bd16", "printing": "sve-003"}, {"iid": "bd17", "printing": "sve-001"}, {"iid": "bd18", "printing": "sve-005"}, {"iid": "bd19", "printing": "sve-002"}, {"iid": "bd20", "printing": "sve-003"}, {"iid": "bd21", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}, {"iid": "bp3", "printing": "sve-003", "faceUp": false}, {"iid": "bp4", "printing": "sve-003", "faceUp": false}, {"iid": "bp5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;

function board(edit: (s: NeutralState) => void = () => undefined): NeutralState {
  const s = JSON.parse(JSON.stringify(BOARD)) as NeutralState;
  edit(s);
  return s;
}
const A = (r: ReturnType<typeof step>) => r.state.players.A;
const ab1 = (r: ReturnType<typeof step>) => A(r).bench.find(p => p.stack[0].iid === 'ab1s0')!;
const play: NeutralAction = { actor: 'A', type: 'playItem', card: 'ah2' };
const discarded = (r: ReturnType<typeof step>, card: string) => r.events.findIndex(e => e.kind === 'moved'
  && (e as Extract<NeutralEvent, { kind: 'moved' }>).card === card
  && (e as Extract<NeutralEvent, { kind: 'moved' }>).destination.zone === 'discardPile');

describe('TA-717 Super Potion jtg-158: heal first, then discard an Energy only if it healed', () => {
  it('[TA-717 jtg-158 no-energy] a damaged Pokémon with no Energy: offered, heals, discards nothing', () => {
    const root = step(board(), []);
    expect(root.pending!.legalActions).toContain(jasmine.objectContaining({ type: 'playItem', card: 'ah2' }));
    const r = step(board(), [play]);
    expect(r.applied).toBe(1);
    expect(ab1(r).damage).toBe(0);
    expect(A(r).discard.map(c => c.iid)).toEqual(jasmine.arrayContaining(['ah2']));
    expect(A(r).discard.length).toBe(BOARD.players.A.discard.length + 1);
  });

  it('[TA-717 jtg-158 one-energy] one Energy: heal 30, then that Energy is discarded', () => {
    const r = step(board(), [{ actor: 'A', type: 'attachEnergy', card: 'ah3', target: 'ab1s0' }, play]);
    expect(r.applied).toBe(2);
    expect(ab1(r).damage).toBe(0);
    expect(ab1(r).energy).toEqual([]);
    expect(A(r).discard.map(c => c.iid)).toEqual(jasmine.arrayContaining(['ah2', 'ah3']));
    const healed = r.events.findIndex(e => e.kind === 'healed');
    expect(healed).toBeGreaterThanOrEqual(0);
    expect(healed).toBeLessThan(discarded(r, 'ah3'));
  });

  it('[TA-717 jtg-158 two-energy] two Energy: the heal is applied before the discard pick', () => {
    const b = board(s => { s.players.A.bench[0].energy = [{ iid: 'be0', printing: 'sve-001' }, { iid: 'be1', printing: 'sve-005' }]; });
    const r = step(b, [play]);
    expect(ab1(r).damage).toBe(0);
    const targets = r.pending!.legalActions.map(a => (a as { target?: string }).target);
    expect(targets).toEqual(jasmine.arrayContaining(['be0', 'be1']));
  });

  it('[TA-717 jtg-158 control] no damaged Pokémon: not offered', () => {
    const root = step(board(s => { s.players.A.bench[0].damage = 0; }), []);
    expect(root.pending!.legalActions).not.toContain(jasmine.objectContaining({ type: 'playItem', card: 'ah2' }));
  });
});
