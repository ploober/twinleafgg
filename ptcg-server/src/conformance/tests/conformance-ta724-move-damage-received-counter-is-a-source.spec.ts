import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-724: the move-damage decomposer counted a source's movable counters as damage − counters moved FROM it, reading the
 * prompt-open damage and never adding counters moved TO it. B.80 (5) defines the board between the picks: after one
 * transfer the counter is on the Benched Pokémon, so it is a legal source for the next. Alakazam twm-082 Strange Hacking
 * ("You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.")
 * applies its transfers one at a time on the live board. Board: the Unlimited fuzz row atk-twm-082-psychic (B's Active
 * 30 damage, B's Bench bb1s0 none); rotomancer 936314650 offers bb1s0 after the first transfer.
 */

const BOARD = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1s0", "printing": "meg-054"}, {"iid": "a1s1", "printing": "meg-055"}, {"iid": "a1s2", "printing": "twm-082"}], "energy": [{"iid": "a1e0", "printing": "sve-005"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah1", "printing": "sve-002"}], "deck": [{"iid": "ad1", "printing": "sve-002"}, {"iid": "ad2", "printing": "sve-002"}, {"iid": "ad3", "printing": "sve-002"}, {"iid": "ad4", "printing": "sve-002"}, {"iid": "ad5", "printing": "sve-002"}, {"iid": "ad6", "printing": "sve-002"}, {"iid": "ad7", "printing": "sve-002"}, {"iid": "ad8", "printing": "sve-002"}, {"iid": "ad9", "printing": "sve-002"}, {"iid": "ad10", "printing": "sve-002"}, {"iid": "ad11", "printing": "sve-002"}, {"iid": "ad12", "printing": "sve-002"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap1", "printing": "sve-002", "faceUp": false}, {"iid": "ap2", "printing": "sve-002", "faceUp": false}, {"iid": "ap3", "printing": "sve-002", "faceUp": false}, {"iid": "ap4", "printing": "sve-002", "faceUp": false}, {"iid": "ap5", "printing": "sve-002", "faceUp": false}, {"iid": "ap6", "printing": "sve-002", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1s0", "printing": "meg-181"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh1", "printing": "sve-002"}], "deck": [{"iid": "bd1", "printing": "sve-002"}, {"iid": "bd2", "printing": "sve-002"}, {"iid": "bd3", "printing": "sve-002"}, {"iid": "bd4", "printing": "sve-002"}, {"iid": "bd5", "printing": "sve-002"}, {"iid": "bd6", "printing": "sve-002"}, {"iid": "bd7", "printing": "sve-002"}, {"iid": "bd8", "printing": "sve-002"}, {"iid": "bd9", "printing": "sve-002"}, {"iid": "bd10", "printing": "sve-002"}, {"iid": "bd11", "printing": "sve-002"}, {"iid": "bd12", "printing": "sve-002"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp1", "printing": "sve-002", "faceUp": false}, {"iid": "bp2", "printing": "sve-002", "faceUp": false}, {"iid": "bp3", "printing": "sve-002", "faceUp": false}, {"iid": "bp4", "printing": "sve-002", "faceUp": false}, {"iid": "bp5", "printing": "sve-002", "faceUp": false}, {"iid": "bp6", "printing": "sve-002", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const ACTIONS = [{"actor": "A", "type": "declareAttack", "source": "a1s0", "name": "Strange Hacking"}, {"actor": "B", "type": "attachEnergy", "card": "bh1", "target": "b1s0"}, {"actor": "B", "type": "declareAttack", "source": "b1s0", "name": "Strafe"}, {"actor": "system", "type": "flip", "face": "tails"}, {"actor": "A", "type": "declareAttack", "source": "a1s0", "name": "Strange Hacking"}, {"actor": "A", "type": "choose", "target": "b1s0"}] as unknown as NeutralAction[];
const sources = (r: ReturnType<typeof step>) =>
  r.pending!.legalActions.filter(a => a.type === 'choose').map(a => (a as { target: string }).target).sort();

describe('TA-724 / TA-783 move-damage: a Pokémon that only received a counter in this move is not a source (B.126)', () => {
  it('[TA-724 twm-082 control] before any transfer only the damaged Active is a source', () => {
    const r = step(BOARD, ACTIONS.slice(0, ACTIONS.length - 1));
    expect(sources(r)).toEqual(['b1s0']);
  });

  it('[TA-783 twm-082] after b1s0 > bb1s0 only b1s0 is a source; bb1s0 is only planned to receive (B.126)', () => {
    const r = step(BOARD, ACTIONS);
    // TA-767 / B.118 (owner 2026-10-23): an attack's counter moves are applied after the last pick, so the board between
    // the picks still shows the counter on the Active (B.80 (5)'s moved board no longer holds for an attack's moves).
    // B.126 (owner 2026-10-25) supersedes TA-724's ask: a source has counters at the start of the effect, less those
    // already planned to leave it; a Pokémon only planned to receive counters is not a source.
    expect(r.state.players.B.bench[0].damage).toBe(0);
    expect(sources(r)).toEqual(['b1s0']);
    const back = step(BOARD, [...ACTIONS, { actor: 'A', type: 'choose', target: 'bb1s0' } as unknown as NeutralAction]);
    expect(back.status).toBe('invalidAction');
  });

  it('[TA-783 twm-082 own counters] a Pokémon that had a counter and received one gives up only its own one (B.126)', () => {
    const board = JSON.parse(JSON.stringify(BOARD)) as NeutralState;
    board.players.B.active!.damage = 30;
    board.players.B.bench[0].damage = 10;
    const hack = [{ actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Strange Hacking' },
      { actor: 'A', type: 'choose', target: 'b1s0' }] as unknown as NeutralAction[];
    // each source's one destination is the other Pokémon, so the placement collapses (CF-14)
    expect(sources(step(board, hack))).toEqual(['b1s0', 'bb1s0']);
    const once = step(board, [...hack, { actor: 'A', type: 'choose', target: 'bb1s0' } as unknown as NeutralAction]);
    expect(sources(once)).toEqual(['b1s0']);
  });
});

// Re-fuzz results/fuzz-20261020-graviton-unlimited-refuzz (85a60e9e5 x f3e92fdba), fz-atk-twm-082-strange-hacking-divergence-35c6e2:
// B's Active carries the only counter. "Any number of damage counters" counts the counters on the board, so once as many
// transfers as there were counters are done the move ends; rotomancer f3e92fdba ends it there and passes the turn.
const ONE_COUNTER = {"schemaVersion": "0.1", "format": "unlimited", "turn": 3, "activePlayer": "A", "firstPlayer": "A", "phase": "main", "outcome": "ongoing", "players": {"A": {"active": {"stack": [{"iid": "a1s0", "printing": "meg-054"}, {"iid": "a1s1", "printing": "meg-055"}, {"iid": "a1s2", "printing": "twm-082"}], "energy": [{"iid": "a1e0", "printing": "sve-005"}], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "ab1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "ah1", "printing": "sve-002"}], "deck": [{"iid": "ad1", "printing": "sve-002"}, {"iid": "ad2", "printing": "sve-002"}, {"iid": "ad3", "printing": "sve-002"}, {"iid": "ad4", "printing": "sve-002"}, {"iid": "ad5", "printing": "sve-002"}, {"iid": "ad6", "printing": "sve-002"}, {"iid": "ad7", "printing": "sve-002"}, {"iid": "ad8", "printing": "sve-002"}, {"iid": "ad9", "printing": "sve-002"}, {"iid": "ad10", "printing": "sve-002"}, {"iid": "ad11", "printing": "sve-002"}, {"iid": "ad12", "printing": "sve-002"}], "discard": [], "lostZone": [], "prizes": [{"iid": "ap1", "printing": "sve-002", "faceUp": false}, {"iid": "ap2", "printing": "sve-002", "faceUp": false}, {"iid": "ap3", "printing": "sve-002", "faceUp": false}, {"iid": "ap4", "printing": "sve-002", "faceUp": false}, {"iid": "ap5", "printing": "sve-002", "faceUp": false}, {"iid": "ap6", "printing": "sve-002", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}, "B": {"active": {"stack": [{"iid": "b1s0", "printing": "meg-181"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}, "bench": [{"stack": [{"iid": "bb1s0", "printing": "asc-004"}], "energy": [], "tools": [], "damage": 0, "conditions": [], "poisonDamagePerTurn": 10, "markers": {"playedOnTurn": 1, "movedToActiveOnTurn": -1, "damageTakenThisTurn": 0, "abilitiesUsedThisTurn": [], "cannotAttackNextTurn": false}, "faceDown": false}], "hand": [{"iid": "bh1", "printing": "sve-002"}], "deck": [{"iid": "bd1", "printing": "sve-002"}, {"iid": "bd2", "printing": "sve-002"}, {"iid": "bd3", "printing": "sve-002"}, {"iid": "bd4", "printing": "sve-002"}, {"iid": "bd5", "printing": "sve-002"}, {"iid": "bd6", "printing": "sve-002"}, {"iid": "bd7", "printing": "sve-002"}, {"iid": "bd8", "printing": "sve-002"}, {"iid": "bd9", "printing": "sve-002"}, {"iid": "bd10", "printing": "sve-002"}, {"iid": "bd11", "printing": "sve-002"}, {"iid": "bd12", "printing": "sve-002"}], "discard": [], "lostZone": [], "prizes": [{"iid": "bp1", "printing": "sve-002", "faceUp": false}, {"iid": "bp2", "printing": "sve-002", "faceUp": false}, {"iid": "bp3", "printing": "sve-002", "faceUp": false}, {"iid": "bp4", "printing": "sve-002", "faceUp": false}, {"iid": "bp5", "printing": "sve-002", "faceUp": false}, {"iid": "bp6", "printing": "sve-002", "faceUp": false}], "flags": {"supporterPlayedThisTurn": false, "energyAttachedThisTurn": false, "stadiumPlayedThisTurn": false, "retreatedThisTurn": false, "cardsPlayedThisTurn": 0, "prizesTakenThisTurn": 0, "prizesTakenLastTurn": 0, "vstarUsed": false}}}, "activeEffects": []} as unknown as NeutralState;
const ONE_ACTIONS = [{"actor": "A", "type": "declareAttack", "source": "a1s0", "name": "Psychic"}, {"actor": "B", "type": "endTurn"}, {"actor": "A", "type": "declareAttack", "source": "a1s0", "name": "Strange Hacking"}, {"actor": "A", "type": "choose", "target": "b1s0"}] as unknown as NeutralAction[];

describe('TA-724 move-damage: the transfers stop at the number of counters on the board', () => {
  it('[TA-724 twm-082 one counter] after the only counter moves, the move ends and the turn passes', () => {
    const r = step(ONE_COUNTER, ONE_ACTIONS);
    expect(r.applied).toBe(ONE_ACTIONS.length);
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.players.B.bench[0].damage).toBe(10);
    expect(r.state.activePlayer).toBe('B');
  });
});
