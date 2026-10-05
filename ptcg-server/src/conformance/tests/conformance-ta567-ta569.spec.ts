import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-567 Transformation Tome cri-083: "switch it with 1 of your Basic Pokémon in play" — playable only with a Pokémon
 * in play whose TOP card is Basic (#925: a card that obviously cannot do its job cannot be played). The check accepted
 * any stack CONTAINING a Basic, so with only a Charmeleon (on Charmander) in play it was offered and did nothing.
 * TA-568 Antique Cover Fossil scr-129 Protective Cover: "Prevent all effects of attacks used by your OPPONENT'S
 * Pokémon": its owner's own Share (Combee obf-008) must heal it.
 * TA-569 Combee obf-008 Share: "Heal 20 damage" (it healed 40).
 */
const TOME_EVOLVED: NeutralState = {
  "schemaVersion": "0.1",
  "turn": 5,
  "activePlayer": "A",
  "firstPlayer": "A",
  "phase": "main",
  "outcome": "ongoing",
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a0",
            "printing": "asc-020"
          },
          {
            "iid": "a0s",
            "printing": "asc-021"
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
      "bench": [],
      "hand": [
        {
          "iid": "Ah0",
          "printing": "cri-083"
        },
        {
          "iid": "Ah1",
          "printing": "cri-083"
        }
      ],
      "deck": [
        {
          "iid": "Ad0",
          "printing": "sve-003"
        },
        {
          "iid": "Ad1",
          "printing": "sve-003"
        },
        {
          "iid": "Ad2",
          "printing": "sve-003"
        },
        {
          "iid": "Ad3",
          "printing": "sve-003"
        }
      ],
      "discard": [
        {
          "iid": "Ax0",
          "printing": "blk-001"
        },
        {
          "iid": "Ax1",
          "printing": "asc-029"
        }
      ],
      "lostZone": [],
      "prizes": [
        {
          "iid": "Ap0",
          "printing": "sve-003",
          "faceUp": null
        },
        {
          "iid": "Ap1",
          "printing": "sve-003",
          "faceUp": null
        },
        {
          "iid": "Ap2",
          "printing": "sve-003",
          "faceUp": null
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
        "prizesTaken": 3,
        "vstarUsed": false
      }
    },
    "B": {
      "active": {
        "stack": [
          {
            "iid": "b0",
            "printing": "por-063"
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
      "bench": [],
      "hand": [],
      "deck": [
        {
          "iid": "Bd0",
          "printing": "sve-003"
        },
        {
          "iid": "Bd1",
          "printing": "sve-003"
        },
        {
          "iid": "Bd2",
          "printing": "sve-003"
        },
        {
          "iid": "Bd3",
          "printing": "sve-003"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "Bp0",
          "printing": "sve-003",
          "faceUp": null
        },
        {
          "iid": "Bp1",
          "printing": "sve-003",
          "faceUp": null
        },
        {
          "iid": "Bp2",
          "printing": "sve-003",
          "faceUp": null
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
        "prizesTaken": 3,
        "vstarUsed": false
      }
    }
  }
} as unknown as NeutralState;
const TOME_BASIC: NeutralState = {
  "schemaVersion": "0.1",
  "turn": 5,
  "activePlayer": "A",
  "firstPlayer": "A",
  "phase": "main",
  "outcome": "ongoing",
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a0",
            "printing": "asc-020"
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
      "bench": [],
      "hand": [
        {
          "iid": "Ah0",
          "printing": "cri-083"
        },
        {
          "iid": "Ah1",
          "printing": "cri-083"
        }
      ],
      "deck": [
        {
          "iid": "Ad0",
          "printing": "sve-003"
        },
        {
          "iid": "Ad1",
          "printing": "sve-003"
        },
        {
          "iid": "Ad2",
          "printing": "sve-003"
        },
        {
          "iid": "Ad3",
          "printing": "sve-003"
        }
      ],
      "discard": [
        {
          "iid": "Ax0",
          "printing": "blk-001"
        },
        {
          "iid": "Ax1",
          "printing": "asc-029"
        }
      ],
      "lostZone": [],
      "prizes": [
        {
          "iid": "Ap0",
          "printing": "sve-003",
          "faceUp": null
        },
        {
          "iid": "Ap1",
          "printing": "sve-003",
          "faceUp": null
        },
        {
          "iid": "Ap2",
          "printing": "sve-003",
          "faceUp": null
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
        "prizesTaken": 3,
        "vstarUsed": false
      }
    },
    "B": {
      "active": {
        "stack": [
          {
            "iid": "b0",
            "printing": "por-063"
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
      "bench": [],
      "hand": [],
      "deck": [
        {
          "iid": "Bd0",
          "printing": "sve-003"
        },
        {
          "iid": "Bd1",
          "printing": "sve-003"
        },
        {
          "iid": "Bd2",
          "printing": "sve-003"
        },
        {
          "iid": "Bd3",
          "printing": "sve-003"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "Bp0",
          "printing": "sve-003",
          "faceUp": null
        },
        {
          "iid": "Bp1",
          "printing": "sve-003",
          "faceUp": null
        },
        {
          "iid": "Bp2",
          "printing": "sve-003",
          "faceUp": null
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
        "prizesTaken": 3,
        "vstarUsed": false
      }
    }
  }
} as unknown as NeutralState;
const SHARE_FOSSIL: NeutralState = {
  "schemaVersion": "0.1",
  "format": "unlimited",
  "turn": 5,
  "activePlayer": "A",
  "firstPlayer": "B",
  "phase": "main",
  "outcome": "ongoing",
  "stadium": null,
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a0",
            "printing": "obf-008"
          }
        ],
        "energy": [
          {
            "iid": "ae1",
            "printing": "sve-001"
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
              "iid": "a1",
              "printing": "scr-129"
            }
          ],
          "energy": [],
          "tools": [],
          "damage": 30,
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
      "hand": [],
      "deck": [
        {
          "iid": "ad0",
          "printing": "sve-001"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "ap0",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap1",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap2",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap3",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap4",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap5",
          "printing": "sve-001",
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
            "iid": "b0",
            "printing": "twm-095"
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
      "bench": [],
      "hand": [],
      "deck": [
        {
          "iid": "bd0",
          "printing": "sve-001"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "bp0",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp1",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp2",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp3",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp4",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp5",
          "printing": "sve-001",
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
const SHARE_COMBEE: NeutralState = {
  "schemaVersion": "0.1",
  "format": "unlimited",
  "turn": 5,
  "activePlayer": "A",
  "firstPlayer": "B",
  "phase": "main",
  "outcome": "ongoing",
  "stadium": null,
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a0",
            "printing": "obf-008"
          }
        ],
        "energy": [
          {
            "iid": "ae1",
            "printing": "sve-001"
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
              "iid": "a1",
              "printing": "obf-008"
            }
          ],
          "energy": [],
          "tools": [],
          "damage": 30,
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
      "hand": [],
      "deck": [
        {
          "iid": "ad0",
          "printing": "sve-001"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "ap0",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap1",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap2",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap3",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap4",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "ap5",
          "printing": "sve-001",
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
            "iid": "b0",
            "printing": "twm-095"
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
      "bench": [],
      "hand": [],
      "deck": [
        {
          "iid": "bd0",
          "printing": "sve-001"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "bp0",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp1",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp2",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp3",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp4",
          "printing": "sve-001",
          "faceUp": false
        },
        {
          "iid": "bp5",
          "printing": "sve-001",
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
const SHARE = {"actor": "A", "type": "declareAttack", "source": "a0", "name": "Share"} as never;

const offersTome = (board: NeutralState) => (step(board, []).pending?.legalActions ?? [])
  .some(a => (a as { type: string }).type === 'playItem');
const benchDamage = (board: NeutralState) => step(board, [SHARE]).state.players.A.bench[0].damage;

describe('TA-567 / TA-568 / TA-569', () => {
  it('Transformation Tome is not offered when the only Pokémon in play is evolved [TA-567]', () => {
    expect(offersTome(TOME_EVOLVED)).toBe(false);
  });
  it('control: offered with a Basic Active [TA-567]', () => {
    expect(offersTome(TOME_BASIC)).toBe(true);
  });
  it('Share heals its owner\'s own Antique Cover Fossil: 30 -> 10 [TA-568]', () => {
    expect(benchDamage(SHARE_FOSSIL)).toBe(10);
  });
  it('Share heals 20, not 40: a Benched Combee at 30 -> 10 [TA-569]', () => {
    expect(benchDamage(SHARE_COMBEE)).toBe(10);
  });
});
