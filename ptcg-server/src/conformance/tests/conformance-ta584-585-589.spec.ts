import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-584 Terapagos ssp-161 Prism Charge — "up to 3 Basic Energy cards of different types": after a Grass is attached the
 * second Grass is not offered (differentTypes). TA-585 Great Haul Net cri-078 — an Item's "up to 3" has a floor of 1
 * (#2301): with only Pokémon in the discard there is no stop before a pick. TA-589 Celebratory Fanfare mep-028 — "If a
 * player healed any damage in this way, their turn ends": with nothing to heal the Stadium is not offered (B.41).
 */
const PRISM: NeutralState = {
  "schemaVersion": "0.1",
  "turn": 3,
  "activePlayer": "A",
  "firstPlayer": "A",
  "phase": "main",
  "outcome": "ongoing",
  "activeEffects": [],
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a1s0",
            "printing": "ssp-161"
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
        }
      },
      "bench": [
        {
          "stack": [
            {
              "iid": "ab1s0",
              "printing": "scr-128"
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
          "iid": "ah1",
          "printing": "sve-002"
        }
      ],
      "deck": [
        {
          "iid": "ad1",
          "printing": "sve-001"
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
          "printing": "sve-003"
        },
        {
          "iid": "ad5",
          "printing": "sve-003"
        },
        {
          "iid": "ad6",
          "printing": "sve-003"
        },
        {
          "iid": "ad7",
          "printing": "sve-003"
        },
        {
          "iid": "ad8",
          "printing": "sve-003"
        },
        {
          "iid": "ad9",
          "printing": "sve-003"
        },
        {
          "iid": "ad10",
          "printing": "sve-003"
        },
        {
          "iid": "ad11",
          "printing": "sve-003"
        },
        {
          "iid": "ad12",
          "printing": "sve-003"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "ap1",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "ap2",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "ap3",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "ap4",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "ap5",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "ap6",
          "printing": "sve-002",
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
            "printing": "meg-181"
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
      },
      "bench": [
        {
          "stack": [
            {
              "iid": "bb1s0",
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
          "iid": "bh1",
          "printing": "sve-002"
        }
      ],
      "deck": [
        {
          "iid": "bd1",
          "printing": "sve-002"
        },
        {
          "iid": "bd2",
          "printing": "sve-002"
        },
        {
          "iid": "bd3",
          "printing": "sve-002"
        },
        {
          "iid": "bd4",
          "printing": "sve-002"
        },
        {
          "iid": "bd5",
          "printing": "sve-002"
        },
        {
          "iid": "bd6",
          "printing": "sve-002"
        },
        {
          "iid": "bd7",
          "printing": "sve-002"
        },
        {
          "iid": "bd8",
          "printing": "sve-002"
        },
        {
          "iid": "bd9",
          "printing": "sve-002"
        },
        {
          "iid": "bd10",
          "printing": "sve-002"
        },
        {
          "iid": "bd11",
          "printing": "sve-002"
        },
        {
          "iid": "bd12",
          "printing": "sve-002"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "bp1",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "bp2",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "bp3",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "bp4",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "bp5",
          "printing": "sve-002",
          "faceUp": false
        },
        {
          "iid": "bp6",
          "printing": "sve-002",
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
  }
} as unknown as NeutralState;
const HAUL: NeutralState = {
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
            "printing": "asc-004"
          }
        ],
        "energy": [
          {
            "iid": "ae20",
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
        },
        {
          "stack": [
            {
              "iid": "ab2",
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
          "iid": "ah4",
          "printing": "cri-078"
        },
        {
          "iid": "ah1",
          "printing": "sve-001"
        },
        {
          "iid": "ah2",
          "printing": "sve-005"
        },
        {
          "iid": "ah3",
          "printing": "asc-004"
        }
      ],
      "deck": [
        {
          "iid": "ad5",
          "printing": "sve-001"
        },
        {
          "iid": "ad6",
          "printing": "sve-002"
        },
        {
          "iid": "ad7",
          "printing": "sve-003"
        },
        {
          "iid": "ad8",
          "printing": "sve-004"
        },
        {
          "iid": "ad9",
          "printing": "sve-005"
        },
        {
          "iid": "ad10",
          "printing": "sve-001"
        },
        {
          "iid": "ad11",
          "printing": "sve-002"
        },
        {
          "iid": "ad12",
          "printing": "sve-003"
        },
        {
          "iid": "ad13",
          "printing": "sve-004"
        },
        {
          "iid": "ad14",
          "printing": "sve-005"
        },
        {
          "iid": "ad15",
          "printing": "asc-004"
        },
        {
          "iid": "ad16",
          "printing": "asc-004"
        },
        {
          "iid": "ad17",
          "printing": "asc-004"
        },
        {
          "iid": "ad18",
          "printing": "por-083"
        },
        {
          "iid": "ad19",
          "printing": "por-083"
        }
      ],
      "discard": [
        {
          "iid": "ax1",
          "printing": "pre-027"
        },
        {
          "iid": "ax2",
          "printing": "pre-027"
        }
      ],
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
            "printing": "asc-004"
          }
        ],
        "energy": [
          {
            "iid": "be19",
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
        },
        {
          "stack": [
            {
              "iid": "bb2",
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
          "iid": "bh1",
          "printing": "sve-001"
        },
        {
          "iid": "bh2",
          "printing": "sve-005"
        },
        {
          "iid": "bh3",
          "printing": "asc-004"
        }
      ],
      "deck": [
        {
          "iid": "bd4",
          "printing": "sve-001"
        },
        {
          "iid": "bd5",
          "printing": "sve-002"
        },
        {
          "iid": "bd6",
          "printing": "sve-003"
        },
        {
          "iid": "bd7",
          "printing": "sve-004"
        },
        {
          "iid": "bd8",
          "printing": "sve-005"
        },
        {
          "iid": "bd9",
          "printing": "sve-001"
        },
        {
          "iid": "bd10",
          "printing": "sve-002"
        },
        {
          "iid": "bd11",
          "printing": "sve-003"
        },
        {
          "iid": "bd12",
          "printing": "sve-004"
        },
        {
          "iid": "bd13",
          "printing": "sve-005"
        },
        {
          "iid": "bd14",
          "printing": "asc-004"
        },
        {
          "iid": "bd15",
          "printing": "asc-004"
        },
        {
          "iid": "bd16",
          "printing": "asc-004"
        },
        {
          "iid": "bd17",
          "printing": "por-083"
        },
        {
          "iid": "bd18",
          "printing": "por-083"
        }
      ],
      "discard": [
        {
          "iid": "bx20",
          "printing": "asc-004"
        },
        {
          "iid": "bx21",
          "printing": "por-083"
        }
      ],
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
const FANFARE: NeutralState = {
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
            "printing": "asc-004"
          }
        ],
        "energy": [
          {
            "iid": "ae20",
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
        },
        {
          "stack": [
            {
              "iid": "ab2",
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
          "iid": "ah4",
          "printing": "scr-138"
        },
        {
          "iid": "ah1",
          "printing": "sve-001"
        },
        {
          "iid": "ah2",
          "printing": "sve-005"
        },
        {
          "iid": "ah3",
          "printing": "asc-004"
        }
      ],
      "deck": [
        {
          "iid": "ad5",
          "printing": "sve-001"
        },
        {
          "iid": "ad6",
          "printing": "sve-002"
        },
        {
          "iid": "ad7",
          "printing": "sve-003"
        },
        {
          "iid": "ad8",
          "printing": "sve-004"
        },
        {
          "iid": "ad9",
          "printing": "sve-005"
        },
        {
          "iid": "ad10",
          "printing": "sve-001"
        },
        {
          "iid": "ad11",
          "printing": "sve-002"
        },
        {
          "iid": "ad12",
          "printing": "sve-003"
        },
        {
          "iid": "ad13",
          "printing": "sve-004"
        },
        {
          "iid": "ad14",
          "printing": "sve-005"
        },
        {
          "iid": "ad15",
          "printing": "asc-004"
        },
        {
          "iid": "ad16",
          "printing": "asc-004"
        },
        {
          "iid": "ad17",
          "printing": "asc-004"
        },
        {
          "iid": "ad18",
          "printing": "por-083"
        },
        {
          "iid": "ad19",
          "printing": "por-083"
        }
      ],
      "discard": [
        {
          "iid": "ax21",
          "printing": "asc-004"
        },
        {
          "iid": "ax22",
          "printing": "por-083"
        }
      ],
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
            "printing": "asc-004"
          }
        ],
        "energy": [
          {
            "iid": "be19",
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
        },
        {
          "stack": [
            {
              "iid": "bb2",
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
          "iid": "bh1",
          "printing": "sve-001"
        },
        {
          "iid": "bh2",
          "printing": "sve-005"
        },
        {
          "iid": "bh3",
          "printing": "asc-004"
        }
      ],
      "deck": [
        {
          "iid": "bd4",
          "printing": "sve-001"
        },
        {
          "iid": "bd5",
          "printing": "sve-002"
        },
        {
          "iid": "bd6",
          "printing": "sve-003"
        },
        {
          "iid": "bd7",
          "printing": "sve-004"
        },
        {
          "iid": "bd8",
          "printing": "sve-005"
        },
        {
          "iid": "bd9",
          "printing": "sve-001"
        },
        {
          "iid": "bd10",
          "printing": "sve-002"
        },
        {
          "iid": "bd11",
          "printing": "sve-003"
        },
        {
          "iid": "bd12",
          "printing": "sve-004"
        },
        {
          "iid": "bd13",
          "printing": "sve-005"
        },
        {
          "iid": "bd14",
          "printing": "asc-004"
        },
        {
          "iid": "bd15",
          "printing": "asc-004"
        },
        {
          "iid": "bd16",
          "printing": "asc-004"
        },
        {
          "iid": "bd17",
          "printing": "por-083"
        },
        {
          "iid": "bd18",
          "printing": "por-083"
        }
      ],
      "discard": [
        {
          "iid": "bx20",
          "printing": "asc-004"
        },
        {
          "iid": "bx21",
          "printing": "por-083"
        }
      ],
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
  "format": "standard",
  "stadium": {
    "iid": "st0",
    "printing": "mep-028",
    "owner": "A"
  }
} as unknown as NeutralState;
const types = (r: { pending?: { legalActions?: unknown[] } | null }) =>
  (r.pending?.legalActions ?? []) as Array<{ type: string; card?: string; value?: boolean; target?: string }>;

describe('TA-584 / TA-585 / TA-589', () => {
  it('Prism Charge: after a Grass is attached the second Grass is not offered [TA-584]', () => {
    const atk = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Prism Charge' } as never;
    // TA-772 / B.116: one Tera Pokémon is the only target, so each card is asked alone (choose {target: card}).
    const first = types(step(PRISM, [atk])).find(a => a.type === 'choose' && a.target === 'ad1');
    expect(first).toBeDefined();
    const after = types(step(PRISM, [atk, { ...first, actor: 'A' } as never]));
    expect(after.some(a => a.type === 'choose' && a.target === 'ad2')).toBe(false);
    expect(after.some(a => a.type === 'choose' && a.target === 'ad3')).toBe(true);
  });
  it('Great Haul Net: no stop before the first pick (floor 1) [TA-585]', () => {
    const r = types(step(HAUL, [{ actor: 'A', type: 'playItem', card: 'ah4' } as never]));
    expect(r.some(a => a.type === 'choose')).toBe(true);
    expect(r.some(a => a.type === 'confirm' && a.value === false)).toBe(false);
  });
  it('Great Haul Net stays in resolving until its shuffle completes (#919), then goes to the discard pile [TA-585]', () => {
    const acts = [{ actor: 'A', type: 'playItem', card: 'ah4' } as never, { actor: 'A', type: 'choose', target: 'ax1' } as never,
      { actor: 'A', type: 'choose', target: 'ax2' } as never];
    const paused = step(HAUL, acts);
    expect((paused.state.players.A.resolving ?? []).map(c => c.iid)).toEqual(['ah4']);
    expect(paused.state.players.A.discard.map(c => c.iid)).not.toContain('ah4');
    const deck = (paused.pending?.legalActions?.[0] as unknown as { deck?: string[] }).deck ?? [];
    const done = step(HAUL, [...acts, { actor: 'system', type: 'shuffle', order: deck } as never]);
    expect(done.state.players.A.discard.map(c => c.iid)).toContain('ah4');
  });

  it('Celebratory Fanfare: not offered with nothing to heal [TA-589]', () => {
    expect(types(step(FANFARE, [])).some(a => a.type === 'useStadium')).toBe(false);
  });
  it('Celebratory Fanfare control: offered at 30 damage, heals to 20 and ends the turn [TA-589]', () => {
    const board = JSON.parse(JSON.stringify(FANFARE)) as NeutralState;
    board.players.A.active!.damage = 30;
    expect(types(step(board, [])).some(a => a.type === 'useStadium')).toBe(true);
    const r = step(board, [{ actor: 'A', type: 'useStadium' } as never]);
    expect(r.state.players.A.active!.damage).toBe(20);
    expect(r.state.activePlayer).toBe('B');
  });
});
