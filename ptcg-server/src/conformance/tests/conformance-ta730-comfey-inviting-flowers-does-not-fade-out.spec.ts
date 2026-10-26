import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-730: Lillie's Comfey jtg-068 Fade Out ("Put this Pokémon and all attached cards into your hand.") was armed by an
 * instance flag set when the attack is used and fired at the next AfterAttackEffect. The main menu's attack probes run
 * on a state clone that shares the Card instances, so probing Fade Out armed the real card, and the next attack it made,
 * Inviting Flowers, bounced Comfey into the hand. Re-fuzz results/fuzz-20261020-graviton-unlimited-refuzz (85a60e9e5 x
 * f3e92fdba), fz-atk-jtg-068-fade-out-divergence-6af5f3; rotomancer keeps Comfey Active and passes the turn.
 *
 * The cause is the probe, not the card: Finizen obf-060 (fz-enum-obf-060-divergence-d739bb) has the same shape, Valiant
 * Evolution arms `usedSpinTurn` and the next AfterAttackEffect switches and searches, so a probed Valiant Evolution made
 * Razor Fin switch Finizen out. Its cell runs with no change to the card: a probe must leave the shared Cards as it found them.
 */

const BOARD = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1s0", "printing": "jtg-068"}], "energy": [{"iid": "a1e0", "printing": "sve-005"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah1", "printing": "sve-002"}], "deck": [{"iid": "ad1", "printing": "sve-002"}, {"iid": "ad2", "printing": "sve-002"}, {"iid": "ad3", "printing": "sve-002"}, {"iid": "ad4", "printing": "sve-002"}, {"iid": "ad5", "printing": "sve-002"}, {"iid": "ad6", "printing": "sve-002"}, {"iid": "ad7", "printing": "sve-002"}, {"iid": "ad8", "printing": "sve-002"}, {"iid": "ad9", "printing": "sve-002"}, {"iid": "ad10", "printing": "sve-002"}, {"iid": "ad11", "printing": "sve-002"}, {"iid": "ad12", "printing": "sve-002"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap1", "printing": "sve-002", "faceUp": false}, {"iid": "ap2", "printing": "sve-002", "faceUp": false}, {"iid": "ap3", "printing": "sve-002", "faceUp": false}, {"iid": "ap4", "printing": "sve-002", "faceUp": false}, {"iid": "ap5", "printing": "sve-002", "faceUp": false}, {"iid": "ap6", "printing": "sve-002", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1s0", "printing": "meg-181"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh1", "printing": "sve-002"}], "deck": [{"iid": "bd1", "printing": "sve-002"}, {"iid": "bd2", "printing": "sve-002"}, {"iid": "bd3", "printing": "sve-002"}, {"iid": "bd4", "printing": "sve-002"}, {"iid": "bd5", "printing": "sve-002"}, {"iid": "bd6", "printing": "sve-002"}, {"iid": "bd7", "printing": "sve-002"}, {"iid": "bd8", "printing": "sve-002"}, {"iid": "bd9", "printing": "sve-002"}, {"iid": "bd10", "printing": "sve-002"}, {"iid": "bd11", "printing": "sve-002"}, {"iid": "bd12", "printing": "sve-002"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp1", "printing": "sve-002", "faceUp": false}, {"iid": "bp2", "printing": "sve-002", "faceUp": false}, {"iid": "bp3", "printing": "sve-002", "faceUp": false}, {"iid": "bp4", "printing": "sve-002", "faceUp": false}, {"iid": "bp5", "printing": "sve-002", "faceUp": false}, {"iid": "bp6", "printing": "sve-002", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const ACTIONS = [{"actor": "A", "type": "declareAttack", "source": "a1s0", "name": "Inviting Flowers"}, {"actor": "A", "type": "confirm", "value": true}, {"actor": "system", "type": "shuffle", "order": ["ad1", "ad2", "ad3", "ad4", "ad5", "ad6", "ad7", "ad8", "ad9", "ad10", "ad11", "ad12"]}] as unknown as NeutralAction[];

describe('TA-730 Inviting Flowers is not Fade Out', () => {
  it('[TA-730 jtg-068] after Inviting Flowers Comfey stays Active and the turn passes', () => {
    const r = step(BOARD, ACTIONS);
    expect(r.applied).toBe(ACTIONS.length);
    expect(r.state.players.A.active!.stack.map(c => c.printing)).toEqual(['jtg-068']);
    expect(r.state.activePlayer).toBe('B');
  });

  it('[TA-730 jtg-068 control] Fade Out still puts Comfey and its Energy into the hand', () => {
    const r = step(BOARD, [{ actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Fade Out' } as unknown as NeutralAction]);
    expect(r.state.players.A.active).toBeFalsy();
    expect(r.state.players.A.hand.map(c => c.printing)).toContain('jtg-068');
  });
});

const FINIZEN = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1s0", "printing": "obf-060"}], "energy": [{"iid": "a1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah2", "printing": "sve-001"}, {"iid": "ah3", "printing": "sve-005"}], "deck": [{"iid": "ad4", "printing": "sve-003"}, {"iid": "ad5", "printing": "sve-001"}, {"iid": "ad6", "printing": "sve-005"}, {"iid": "ad7", "printing": "asc-001"}, {"iid": "ad8", "printing": "asc-002"}, {"iid": "ad9", "printing": "asc-216"}, {"iid": "ad10", "printing": "asc-184"}, {"iid": "ad11", "printing": "asc-182"}, {"iid": "ad12", "printing": "asc-188"}, {"iid": "ad13", "printing": "sve-001"}, {"iid": "ad14", "printing": "sve-005"}, {"iid": "ad15", "printing": "sve-002"}, {"iid": "ad16", "printing": "sve-003"}, {"iid": "ad17", "printing": "sve-001"}, {"iid": "ad18", "printing": "sve-005"}, {"iid": "ad19", "printing": "sve-002"}, {"iid": "ad20", "printing": "sve-003"}, {"iid": "ad21", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap0", "printing": "sve-003", "faceUp": false}, {"iid": "ap1", "printing": "sve-003", "faceUp": false}, {"iid": "ap2", "printing": "sve-003", "faceUp": false}, {"iid": "ap3", "printing": "sve-003", "faceUp": false}, {"iid": "ap4", "printing": "sve-003", "faceUp": false}, {"iid": "ap5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1s0", "printing": "asc-004"}], "energy": [{"iid": "b1e1", "printing": "sve-003"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh2", "printing": "sve-001"}, {"iid": "bh3", "printing": "sve-005"}], "deck": [{"iid": "bd4", "printing": "sve-003"}, {"iid": "bd5", "printing": "sve-001"}, {"iid": "bd6", "printing": "sve-005"}, {"iid": "bd7", "printing": "asc-001"}, {"iid": "bd8", "printing": "asc-002"}, {"iid": "bd9", "printing": "asc-216"}, {"iid": "bd10", "printing": "asc-184"}, {"iid": "bd11", "printing": "asc-182"}, {"iid": "bd12", "printing": "asc-188"}, {"iid": "bd13", "printing": "sve-001"}, {"iid": "bd14", "printing": "sve-005"}, {"iid": "bd15", "printing": "sve-002"}, {"iid": "bd16", "printing": "sve-003"}, {"iid": "bd17", "printing": "sve-001"}, {"iid": "bd18", "printing": "sve-005"}, {"iid": "bd19", "printing": "sve-002"}, {"iid": "bd20", "printing": "sve-003"}, {"iid": "bd21", "printing": "sve-001"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp0", "printing": "sve-003", "faceUp": false}, {"iid": "bp1", "printing": "sve-003", "faceUp": false}, {"iid": "bp2", "printing": "sve-003", "faceUp": false}, {"iid": "bp3", "printing": "sve-003", "faceUp": false}, {"iid": "bp4", "printing": "sve-003", "faceUp": false}, {"iid": "bp5", "printing": "sve-003", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;

describe('TA-730 a menu probe leaves the shared Card instances as it found them', () => {
  it('[TA-730 obf-060] Razor Fin does 10 and Finizen stays Active; the turn passes', () => {
    const r = step(FINIZEN, [{ actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Razor Fin' } as unknown as NeutralAction]);
    expect(r.state.players.A.active!.stack.map(c => c.printing)).toEqual(['obf-060']);
    expect(r.state.players.B.active!.damage).toBe(10);
    expect(r.state.activePlayer).toBe('B');
  });
});

// TA-733 (B.95 / CF-12): the Finizen row's corpus script was recorded on the defective trace and carries a `shuffle`
// after Razor Fin. With no system decision pending that action was not offered: invalidAction, not an engine fault.
// Rotomancer f3e92fdba answers invalidAction (NOT_YOUR_TURN) at index 1.
describe('TA-733 a system action with no system decision pending is refused', () => {
  it('[TA-733 obf-060] Razor Fin then a stray shuffle: invalidAction at index 1', () => {
    const r = step(FINIZEN, [
      { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Razor Fin' },
      { actor: 'system', type: 'shuffle', order: [] },
    ] as unknown as NeutralAction[]);
    expect(r.status).toBe('invalidAction');
    expect(r.applied).toBe(1);
    expect(r.state.activePlayer).toBe('B');
  });
});

// TA-730's census (2026-10-21): two more in-pool cards arm a field on themselves when an attack is used. Both leaked under
// a menu probe before the fix (driven against the pre-fix store.ts) and are clean with it.
describe('TA-730 census: a probe does not arm Mimikyu ex or Ting-Lu', () => {
  const ENERGY = ['sve-006', 'sve-006', 'sve-003', 'sve-004', 'sve-005'].map((p, i) => ({ iid: 'e' + i, printing: p }));
  const with_ = (active: string, edit: (s: NeutralState) => void = () => undefined): NeutralState => {
    const s = JSON.parse(JSON.stringify(FINIZEN)) as NeutralState;
    s.players.A.active!.stack = [{ iid: 'x', printing: active }];
    s.players.A.active!.energy = ENERGY as never;
    edit(s);
    return s;
  };

  it('[TA-730 svp-004] Mimikyu ex ends its turn without attacking: no Void Return switch is asked', () => {
    const r = step(with_('svp-004'), [{ actor: 'A', type: 'endTurn' } as unknown as NeutralAction]);
    expect(r.state.activePlayer).toBe('B');
    expect(r.pending?.actor).toBe('B');
  });

  it('[TA-730 twm-110] Ting-Lu Hammer In with a Stadium in play: the Stadium stays (Ground Crasher was not used)', () => {
    const r = step(with_('twm-110', s => { s.players.A.hand.push({ iid: 'st', printing: 'mew-157' } as never); }), [
      { actor: 'A', type: 'playStadium', card: 'st' },
      { actor: 'A', type: 'declareAttack', source: 'x', name: 'Hammer In' },
      { actor: 'A', type: 'takePrize', index: 0 },
      { actor: 'B', type: 'promoteBench', target: 'bb1s0' },
    ] as unknown as NeutralAction[]);
    expect(r.applied).toBe(4);
    expect(r.state.activePlayer).toBe('B');
    expect((r.state as unknown as { stadium: { iid: string } | null }).stadium?.iid).toBe('st');
  });
});
