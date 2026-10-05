import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-564: Iron Thorns tef-062 Destructo-Press — "This attack does 70 damage for each Future card you find there. Then,
 * discard the revealed Future cards." A Future card is any card with the Future tag: Techno Radar par-180 and Future
 * Booster Energy Capsule par-164 are Future Trainers. The attack filtered `instanceof PokemonCard`, so it did 70 and
 * shuffled the two Trainers back. Mutation guard: restore the PokemonCard filter and the first cell reds.
 */
const DEFECT: NeutralState = {
  "schemaVersion": "0.1",
  "turn": 3,
  "activePlayer": "A",
  "firstPlayer": "B",
  "phase": "main",
  "outcome": "ongoing",
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a1",
            "printing": "tef-062"
          }
        ],
        "energy": [
          {
            "iid": "ae1",
            "printing": "sve-004"
          },
          {
            "iid": "ae2",
            "printing": "sve-004"
          },
          {
            "iid": "ae3",
            "printing": "sve-004"
          },
          {
            "iid": "ae4",
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
        }
      },
      "bench": [
        {
          "stack": [
            {
              "iid": "ab1",
              "printing": "asc-004"
            }
          ],
          "energy": [],
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
          }
        }
      ],
      "hand": [
        {
          "iid": "ah5",
          "printing": "sve-001"
        },
        {
          "iid": "ah6",
          "printing": "sve-005"
        }
      ],
      "deck": [
        {
          "iid": "ad7",
          "printing": "par-180"
        },
        {
          "iid": "ad8",
          "printing": "par-164"
        },
        {
          "iid": "ad9",
          "printing": "tef-062"
        },
        {
          "iid": "ad10",
          "printing": "sve-002"
        },
        {
          "iid": "ad11",
          "printing": "sve-003"
        },
        {
          "iid": "ad12",
          "printing": "sve-001"
        },
        {
          "iid": "ad13",
          "printing": "sve-005"
        },
        {
          "iid": "ad14",
          "printing": "sve-002"
        },
        {
          "iid": "ad15",
          "printing": "sve-003"
        },
        {
          "iid": "ad16",
          "printing": "sve-001"
        },
        {
          "iid": "ad17",
          "printing": "sve-005"
        },
        {
          "iid": "ad18",
          "printing": "sve-002"
        },
        {
          "iid": "ad19",
          "printing": "sve-003"
        },
        {
          "iid": "ad20",
          "printing": "sve-001"
        },
        {
          "iid": "ad21",
          "printing": "sve-005"
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
            "iid": "b1",
            "printing": "asc-121"
          }
        ],
        "energy": [
          {
            "iid": "be1",
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
        }
      },
      "bench": [
        {
          "stack": [
            {
              "iid": "bb1",
              "printing": "asc-004"
            }
          ],
          "energy": [],
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
          }
        }
      ],
      "hand": [
        {
          "iid": "bh2",
          "printing": "sve-001"
        },
        {
          "iid": "bh3",
          "printing": "sve-005"
        }
      ],
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
          "printing": "sve-002"
        },
        {
          "iid": "bd8",
          "printing": "sve-003"
        },
        {
          "iid": "bd9",
          "printing": "sve-001"
        },
        {
          "iid": "bd10",
          "printing": "sve-005"
        },
        {
          "iid": "bd11",
          "printing": "sve-002"
        },
        {
          "iid": "bd12",
          "printing": "sve-003"
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
  "activeEffects": [],
  "format": "unlimited"
} as unknown as NeutralState;
const CONTROL: NeutralState = {
  "schemaVersion": "0.1",
  "turn": 3,
  "activePlayer": "A",
  "firstPlayer": "B",
  "phase": "main",
  "outcome": "ongoing",
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a1",
            "printing": "tef-062"
          }
        ],
        "energy": [
          {
            "iid": "ae1",
            "printing": "sve-004"
          },
          {
            "iid": "ae2",
            "printing": "sve-004"
          },
          {
            "iid": "ae3",
            "printing": "sve-004"
          },
          {
            "iid": "ae4",
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
        }
      },
      "bench": [
        {
          "stack": [
            {
              "iid": "ab1",
              "printing": "asc-004"
            }
          ],
          "energy": [],
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
          }
        }
      ],
      "hand": [
        {
          "iid": "ah5",
          "printing": "sve-001"
        },
        {
          "iid": "ah6",
          "printing": "sve-005"
        }
      ],
      "deck": [
        {
          "iid": "ad7",
          "printing": "sve-003"
        },
        {
          "iid": "ad8",
          "printing": "sve-001"
        },
        {
          "iid": "ad9",
          "printing": "tef-062"
        },
        {
          "iid": "ad10",
          "printing": "sve-002"
        },
        {
          "iid": "ad11",
          "printing": "sve-003"
        },
        {
          "iid": "ad12",
          "printing": "sve-001"
        },
        {
          "iid": "ad13",
          "printing": "sve-005"
        },
        {
          "iid": "ad14",
          "printing": "sve-002"
        },
        {
          "iid": "ad15",
          "printing": "sve-003"
        },
        {
          "iid": "ad16",
          "printing": "sve-001"
        },
        {
          "iid": "ad17",
          "printing": "sve-005"
        },
        {
          "iid": "ad18",
          "printing": "sve-002"
        },
        {
          "iid": "ad19",
          "printing": "sve-003"
        },
        {
          "iid": "ad20",
          "printing": "sve-001"
        },
        {
          "iid": "ad21",
          "printing": "sve-005"
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
            "iid": "b1",
            "printing": "asc-121"
          }
        ],
        "energy": [
          {
            "iid": "be1",
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
        }
      },
      "bench": [
        {
          "stack": [
            {
              "iid": "bb1",
              "printing": "asc-004"
            }
          ],
          "energy": [],
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
          }
        }
      ],
      "hand": [
        {
          "iid": "bh2",
          "printing": "sve-001"
        },
        {
          "iid": "bh3",
          "printing": "sve-005"
        }
      ],
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
          "printing": "sve-002"
        },
        {
          "iid": "bd8",
          "printing": "sve-003"
        },
        {
          "iid": "bd9",
          "printing": "sve-001"
        },
        {
          "iid": "bd10",
          "printing": "sve-005"
        },
        {
          "iid": "bd11",
          "printing": "sve-002"
        },
        {
          "iid": "bd12",
          "printing": "sve-003"
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
  "activeEffects": [],
  "format": "unlimited"
} as unknown as NeutralState;
const ATTACK = {"actor": "A", "type": "declareAttack", "source": "a1", "name": "Destructo-Press"} as never;

function shuffled(board: NeutralState) {
  const paused = step(board, [ATTACK]);
  const deck = (paused.pending?.legalActions?.[0] as unknown as { deck?: string[] } | undefined)?.deck ?? [];
  return step(board, [ATTACK, { actor: 'system', type: 'shuffle', order: deck } as never]);
}

describe('TA-564: Destructo-Press counts and discards every revealed Future card', () => {
  it('two Future Trainers and a Future Pokémon in the top 5: 210 damage, all three discarded [TA-564]', () => {
    const res = shuffled(DEFECT);
    expect(res.state.players.B.active!.damage).toBe(210);
    expect(res.state.players.A.discard.map(c => c.printing).sort()).toEqual(['par-164', 'par-180', 'tef-062']);
  });

  it('control: only the Pokémon is Future -> 70 and one discard [TA-564]', () => {
    const res = shuffled(CONTROL);
    expect(res.state.players.B.active!.damage).toBe(70);
    expect(res.state.players.A.discard.map(c => c.printing)).toEqual(['tef-062']);
  });
});
