import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-572 Revavroom svi-142 Rumbling Engine: with an empty deck the Ability cannot draw, and "you cannot draw zero"
 * (#169) / no Ability is used for no effect (#13). The menu hid it, but a sent useAbility was ACCEPTED: the Energy was
 * discarded and nothing drawn. Mutation guard: drop the empty-deck refusal and the first cell reds.
 */
const EMPTY: NeutralState = {
  "schemaVersion": "0.1",
  "format": "unlimited",
  "turn": 3,
  "activePlayer": "A",
  "firstPlayer": "A",
  "phase": "main",
  "outcome": "ongoing",
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a1s0",
            "printing": "svi-142"
          }
        ],
        "energy": [
          {
            "iid": "a1e0",
            "printing": "sve-003"
          }
        ],
        "tools": [],
        "damage": 0,
        "conditions": [],
        "poisonDamagePerTurn": 10,
        "markers": {
          "playedOnTurn": 1,
          "movedToActiveOnTurn": -1,
          "damageTakenThisTurn": 0,
          "abilitiesUsedThisTurn": [],
          "cannotAttackNextTurn": false
        },
        "faceDown": false
      },
      "bench": [],
      "hand": [
        {
          "iid": "ah0",
          "printing": "sve-003"
        },
        {
          "iid": "ah1",
          "printing": "asc-004"
        },
        {
          "iid": "ah2",
          "printing": "asc-001"
        }
      ],
      "deck": [],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "ap0",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap1",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap2",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap3",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap4",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap5",
          "printing": "sve-003",
          "faceUp": false
        }
      ],
      "flags": {
        "supporterPlayedThisTurn": false,
        "energyAttachedThisTurn": false,
        "stadiumPlayedThisTurn": false,
        "retreatedThisTurn": false,
        "cardsPlayedThisTurn": 0,
        "prizesTakenThisTurn": 0,
        "prizesTakenLastTurn": 0,
        "vstarUsed": false
      }
    },
    "B": {
      "active": {
        "stack": [
          {
            "iid": "b1s0",
            "printing": "asc-004"
          }
        ],
        "energy": [
          {
            "iid": "b1e1",
            "printing": "sve-003"
          }
        ],
        "tools": [],
        "damage": 0,
        "conditions": [],
        "poisonDamagePerTurn": 10,
        "markers": {
          "playedOnTurn": 1,
          "movedToActiveOnTurn": -1,
          "damageTakenThisTurn": 0,
          "abilitiesUsedThisTurn": [],
          "cannotAttackNextTurn": false
        },
        "faceDown": false
      },
      "bench": [],
      "hand": [],
      "deck": [
        {
          "iid": "bd4",
          "printing": "sve-003"
        },
        {
          "iid": "bd5",
          "printing": "sve-001"
        },
        {
          "iid": "bd6",
          "printing": "sve-005"
        },
        {
          "iid": "bd7",
          "printing": "asc-001"
        },
        {
          "iid": "bd8",
          "printing": "asc-002"
        },
        {
          "iid": "bd9",
          "printing": "asc-216"
        },
        {
          "iid": "bd10",
          "printing": "asc-184"
        },
        {
          "iid": "bd11",
          "printing": "asc-182"
        },
        {
          "iid": "bd12",
          "printing": "asc-188"
        },
        {
          "iid": "bd13",
          "printing": "sve-001"
        },
        {
          "iid": "bd14",
          "printing": "sve-005"
        },
        {
          "iid": "bd15",
          "printing": "sve-002"
        },
        {
          "iid": "bd16",
          "printing": "sve-003"
        },
        {
          "iid": "bd17",
          "printing": "sve-001"
        },
        {
          "iid": "bd18",
          "printing": "sve-005"
        },
        {
          "iid": "bd19",
          "printing": "sve-002"
        },
        {
          "iid": "bd20",
          "printing": "sve-003"
        },
        {
          "iid": "bd21",
          "printing": "sve-001"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "bp0",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp1",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp2",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp3",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp4",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp5",
          "printing": "sve-003",
          "faceUp": false
        }
      ],
      "flags": {
        "supporterPlayedThisTurn": false,
        "energyAttachedThisTurn": false,
        "stadiumPlayedThisTurn": false,
        "retreatedThisTurn": false,
        "cardsPlayedThisTurn": 0,
        "prizesTakenThisTurn": 0,
        "prizesTakenLastTurn": 0,
        "vstarUsed": false
      }
    }
  },
  "activeEffects": []
} as unknown as NeutralState;
const STOCKED: NeutralState = {
  "schemaVersion": "0.1",
  "format": "unlimited",
  "turn": 3,
  "activePlayer": "A",
  "firstPlayer": "A",
  "phase": "main",
  "outcome": "ongoing",
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a1s0",
            "printing": "svi-142"
          }
        ],
        "energy": [
          {
            "iid": "a1e0",
            "printing": "sve-003"
          }
        ],
        "tools": [],
        "damage": 0,
        "conditions": [],
        "poisonDamagePerTurn": 10,
        "markers": {
          "playedOnTurn": 1,
          "movedToActiveOnTurn": -1,
          "damageTakenThisTurn": 0,
          "abilitiesUsedThisTurn": [],
          "cannotAttackNextTurn": false
        },
        "faceDown": false
      },
      "bench": [],
      "hand": [
        {
          "iid": "ah0",
          "printing": "sve-003"
        },
        {
          "iid": "ah1",
          "printing": "asc-004"
        },
        {
          "iid": "ah2",
          "printing": "asc-001"
        }
      ],
      "deck": [
        {
          "iid": "ad0",
          "printing": "asc-004"
        },
        {
          "iid": "ad1",
          "printing": "asc-001"
        },
        {
          "iid": "ad2",
          "printing": "sve-001"
        },
        {
          "iid": "ad3",
          "printing": "sve-002"
        },
        {
          "iid": "ad4",
          "printing": "sve-005"
        },
        {
          "iid": "ad5",
          "printing": "asc-004"
        },
        {
          "iid": "ad6",
          "printing": "asc-001"
        },
        {
          "iid": "ad7",
          "printing": "sve-005"
        },
        {
          "iid": "ad8",
          "printing": "sve-001"
        },
        {
          "iid": "ad9",
          "printing": "asc-004"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "ap0",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap1",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap2",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap3",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap4",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "ap5",
          "printing": "sve-003",
          "faceUp": false
        }
      ],
      "flags": {
        "supporterPlayedThisTurn": false,
        "energyAttachedThisTurn": false,
        "stadiumPlayedThisTurn": false,
        "retreatedThisTurn": false,
        "cardsPlayedThisTurn": 0,
        "prizesTakenThisTurn": 0,
        "prizesTakenLastTurn": 0,
        "vstarUsed": false
      }
    },
    "B": {
      "active": {
        "stack": [
          {
            "iid": "b1s0",
            "printing": "asc-004"
          }
        ],
        "energy": [
          {
            "iid": "b1e1",
            "printing": "sve-003"
          }
        ],
        "tools": [],
        "damage": 0,
        "conditions": [],
        "poisonDamagePerTurn": 10,
        "markers": {
          "playedOnTurn": 1,
          "movedToActiveOnTurn": -1,
          "damageTakenThisTurn": 0,
          "abilitiesUsedThisTurn": [],
          "cannotAttackNextTurn": false
        },
        "faceDown": false
      },
      "bench": [],
      "hand": [],
      "deck": [
        {
          "iid": "bd4",
          "printing": "sve-003"
        },
        {
          "iid": "bd5",
          "printing": "sve-001"
        },
        {
          "iid": "bd6",
          "printing": "sve-005"
        },
        {
          "iid": "bd7",
          "printing": "asc-001"
        },
        {
          "iid": "bd8",
          "printing": "asc-002"
        },
        {
          "iid": "bd9",
          "printing": "asc-216"
        },
        {
          "iid": "bd10",
          "printing": "asc-184"
        },
        {
          "iid": "bd11",
          "printing": "asc-182"
        },
        {
          "iid": "bd12",
          "printing": "asc-188"
        },
        {
          "iid": "bd13",
          "printing": "sve-001"
        },
        {
          "iid": "bd14",
          "printing": "sve-005"
        },
        {
          "iid": "bd15",
          "printing": "sve-002"
        },
        {
          "iid": "bd16",
          "printing": "sve-003"
        },
        {
          "iid": "bd17",
          "printing": "sve-001"
        },
        {
          "iid": "bd18",
          "printing": "sve-005"
        },
        {
          "iid": "bd19",
          "printing": "sve-002"
        },
        {
          "iid": "bd20",
          "printing": "sve-003"
        },
        {
          "iid": "bd21",
          "printing": "sve-001"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "bp0",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp1",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp2",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp3",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp4",
          "printing": "sve-003",
          "faceUp": false
        },
        {
          "iid": "bp5",
          "printing": "sve-003",
          "faceUp": false
        }
      ],
      "flags": {
        "supporterPlayedThisTurn": false,
        "energyAttachedThisTurn": false,
        "stadiumPlayedThisTurn": false,
        "retreatedThisTurn": false,
        "cardsPlayedThisTurn": 0,
        "prizesTakenThisTurn": 0,
        "prizesTakenLastTurn": 0,
        "vstarUsed": false
      }
    }
  },
  "activeEffects": []
} as unknown as NeutralState;
const USE = {"actor": "A", "type": "useAbility", "source": "a1s0", "ability": "Rumbling Engine"} as never;

describe('TA-572: Rumbling Engine is refused with an empty deck', () => {
  it('empty deck: the use is rejected and nothing is discarded [TA-572]', () => {
    const res = step(EMPTY, [USE]);
    expect(res.status).toBe('invalidAction');
    expect(res.state.players.A.discard.length).toBe(EMPTY.players.A.discard.length);
  });
  it('control: a stocked deck accepts it [TA-572]', () => {
    expect(step(STOCKED, [USE]).status).not.toBe('invalidAction');
  });
});
