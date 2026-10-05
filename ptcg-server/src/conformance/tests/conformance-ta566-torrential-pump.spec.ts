import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * Wellspring Mask Ogerpon ex twm-064 Torrential Pump — "You may shuffle 3 Energy attached to this Pokémon into your
 * deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon."
 * TA-566 (#2031): the damage is done while the Energy is still attached ("damage is still reduced for the DTE since
 * the detachment happens after damage is done"): with only Double Turbo Energy + Sparkling Crystal, 80 to the Active
 * and 100 to the Bench. The Bench 120 used to be placed after the shuffle, so DTE never reduced it.
 * TA-586 (B.77): the "may" is offered whenever the Energy can be shuffled, even with no Benched target ("if you do"
 * gates the damage on the shuffle, never the shuffle on the damage). The confirm used to be gated on a Bench.
 * Mutation guards: move the Bench hit back after the shuffle -> the #2031 cell reds; restore the Bench gate -> the
 * empty-Bench cell reds.
 */
const DTE_BOARD: NeutralState = {
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
            "printing": "twm-064"
          }
        ],
        "energy": [
          {
            "iid": "ae2",
            "printing": "brs-151"
          }
        ],
        "tools": [
          {
            "iid": "at1",
            "printing": "scr-142"
          }
        ],
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
          "iid": "ah4",
          "printing": "sve-001"
        },
        {
          "iid": "ah5",
          "printing": "sve-005"
        }
      ],
      "deck": [
        {
          "iid": "ad6",
          "printing": "sve-003"
        },
        {
          "iid": "ad7",
          "printing": "sve-001"
        },
        {
          "iid": "ad8",
          "printing": "sve-005"
        },
        {
          "iid": "ad9",
          "printing": "sve-002"
        },
        {
          "iid": "ad10",
          "printing": "sve-003"
        },
        {
          "iid": "ad11",
          "printing": "sve-001"
        },
        {
          "iid": "ad12",
          "printing": "sve-005"
        },
        {
          "iid": "ad13",
          "printing": "sve-002"
        },
        {
          "iid": "ad14",
          "printing": "sve-003"
        },
        {
          "iid": "ad15",
          "printing": "sve-001"
        },
        {
          "iid": "ad16",
          "printing": "sve-005"
        },
        {
          "iid": "ad17",
          "printing": "sve-002"
        },
        {
          "iid": "ad18",
          "printing": "sve-003"
        },
        {
          "iid": "ad19",
          "printing": "sve-001"
        },
        {
          "iid": "ad20",
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
              "printing": "tef-062"
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
              "printing": "tef-062"
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
            "printing": "twm-064"
          }
        ],
        "energy": [
          {
            "iid": "ae1",
            "printing": "sve-003"
          },
          {
            "iid": "ae2",
            "printing": "sve-003"
          },
          {
            "iid": "ae3",
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
          "iid": "ah4",
          "printing": "sve-001"
        },
        {
          "iid": "ah5",
          "printing": "sve-005"
        }
      ],
      "deck": [
        {
          "iid": "ad6",
          "printing": "sve-003"
        },
        {
          "iid": "ad7",
          "printing": "sve-001"
        },
        {
          "iid": "ad8",
          "printing": "sve-005"
        },
        {
          "iid": "ad9",
          "printing": "sve-002"
        },
        {
          "iid": "ad10",
          "printing": "sve-003"
        },
        {
          "iid": "ad11",
          "printing": "sve-001"
        },
        {
          "iid": "ad12",
          "printing": "sve-005"
        },
        {
          "iid": "ad13",
          "printing": "sve-002"
        },
        {
          "iid": "ad14",
          "printing": "sve-003"
        },
        {
          "iid": "ad15",
          "printing": "sve-001"
        },
        {
          "iid": "ad16",
          "printing": "sve-005"
        },
        {
          "iid": "ad17",
          "printing": "sve-002"
        },
        {
          "iid": "ad18",
          "printing": "sve-003"
        },
        {
          "iid": "ad19",
          "printing": "sve-001"
        },
        {
          "iid": "ad20",
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
              "printing": "tef-062"
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
              "printing": "tef-062"
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
const NO_BENCH: NeutralState = {
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
            "printing": "twm-064"
          }
        ],
        "energy": [
          {
            "iid": "ae1",
            "printing": "sve-003"
          },
          {
            "iid": "ae2",
            "printing": "sve-003"
          },
          {
            "iid": "ae3",
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
          "iid": "ah4",
          "printing": "sve-001"
        },
        {
          "iid": "ah5",
          "printing": "sve-005"
        }
      ],
      "deck": [
        {
          "iid": "ad6",
          "printing": "sve-003"
        },
        {
          "iid": "ad7",
          "printing": "sve-001"
        },
        {
          "iid": "ad8",
          "printing": "sve-005"
        },
        {
          "iid": "ad9",
          "printing": "sve-002"
        },
        {
          "iid": "ad10",
          "printing": "sve-003"
        },
        {
          "iid": "ad11",
          "printing": "sve-001"
        },
        {
          "iid": "ad12",
          "printing": "sve-005"
        },
        {
          "iid": "ad13",
          "printing": "sve-002"
        },
        {
          "iid": "ad14",
          "printing": "sve-003"
        },
        {
          "iid": "ad15",
          "printing": "sve-001"
        },
        {
          "iid": "ad16",
          "printing": "sve-005"
        },
        {
          "iid": "ad17",
          "printing": "sve-002"
        },
        {
          "iid": "ad18",
          "printing": "sve-003"
        },
        {
          "iid": "ad19",
          "printing": "sve-001"
        },
        {
          "iid": "ad20",
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
      "bench": [],
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
const ATTACK = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Torrential Pump' } as unknown as NeutralAction;
const YES = { actor: 'A', type: 'confirm', value: true } as unknown as NeutralAction;

/** Drive the attack with YES, answering every later decision of A or the system with its first option (a shuffle with its own deck). */
function drive(board: NeutralState, prefer?: string) {
  const actions: NeutralAction[] = [ATTACK, YES];
  let res = step(board, actions);
  for (let i = 0; i < 8 && res.pending && (res.pending.actor === 'A' || res.pending.actor === 'system'); i++) {
    const las = res.pending.legalActions as unknown as Array<{ type: string; target?: string; deck?: string[] }>;
    const pick = las.find(a => prefer !== undefined && a.target === prefer) ?? las[0];
    const next = pick.type === 'shuffle'
      ? { actor: 'system', type: 'shuffle', order: pick.deck ?? [] }
      : { ...pick, actor: res.pending.actor };
    actions.push(next as unknown as NeutralAction);
    res = step(board, actions);
  }
  return res;
}

describe('Torrential Pump: damage while the Energy is attached (#2031), and the offer without a Bench (B.77)', () => {
  it('Double Turbo Energy + Sparkling Crystal: 80 to the Active and 100 to the Bench [TA-566]', () => {
    const res = drive(DTE_BOARD, 'bb1');
    expect(res.state.players.B.active!.damage).toBe(80);
    expect(res.state.players.B.bench.find(p => p.stack[0].iid === 'bb1')!.damage).toBe(100);
  });

  it('control (3 Basic Water Energy): 100 to the Active and 120 to the Bench; the Energy is shuffled in [TA-566]', () => {
    const res = drive(CONTROL, 'bb1');
    expect(res.state.players.B.active!.damage).toBe(100);
    expect(res.state.players.B.bench.find(p => p.stack[0].iid === 'bb1')!.damage).toBe(120);
    expect(res.state.players.A.active!.energy).toEqual([]);
  });

  it('no opposing Benched Pokémon: the shuffle is still offered and done on yes [TA-586]', () => {
    const paused = step(NO_BENCH, [ATTACK]);
    expect((paused.pending?.legalActions ?? []).map(a => (a as { type: string }).type)).toContain('confirm');
    const res = drive(NO_BENCH);
    expect(res.state.players.B.active!.damage).toBe(100);
    expect(res.state.players.A.active!.energy).toEqual([]);
  });
});
