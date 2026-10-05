import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-571 Armarouge ssp-034 Crimson Blaster — "Discard all [R] Energy from this Pokémon". An Energy that provides [R]
 * is [R] Energy: Legacy Energy twm-167 and Luminous Energy pal-191 provide every type while attached (#1776: "provide
 * all types of Energy all the time when they are attached to a Pokemon, even if you don't want them to"). The attack
 * selected only cards NAMED "Fire Energy". Mutation guard: restore the name filter and the first two cells red.
 */
const LEGACY: NeutralState = {
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
            "printing": "pfl-019"
          },
          {
            "iid": "a1s1",
            "printing": "ssp-034"
          }
        ],
        "energy": [
          {
            "iid": "a1e0",
            "printing": "sve-002"
          },
          {
            "iid": "a1e1",
            "printing": "sve-002"
          },
          {
            "iid": "a1e2",
            "printing": "twm-167"
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
          "iid": "ah1",
          "printing": "sve-002"
        }
      ],
      "deck": [],
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
      "deck": [],
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
const LUMINOUS: NeutralState = {
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
            "printing": "pfl-019"
          },
          {
            "iid": "a1s1",
            "printing": "ssp-034"
          }
        ],
        "energy": [
          {
            "iid": "a1e0",
            "printing": "sve-002"
          },
          {
            "iid": "a1e1",
            "printing": "sve-002"
          },
          {
            "iid": "a1e2",
            "printing": "pal-191"
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
          "iid": "ah1",
          "printing": "sve-002"
        }
      ],
      "deck": [],
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
      "deck": [],
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
const WATER: NeutralState = {
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
            "printing": "pfl-019"
          },
          {
            "iid": "a1s1",
            "printing": "ssp-034"
          }
        ],
        "energy": [
          {
            "iid": "a1e0",
            "printing": "sve-002"
          },
          {
            "iid": "a1e1",
            "printing": "sve-002"
          },
          {
            "iid": "a1e2",
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
          "iid": "ah1",
          "printing": "sve-002"
        }
      ],
      "deck": [],
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
      "deck": [],
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
const ATTACK = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Crimson Blaster' } as never;

function attached(board: NeutralState): string[] {
  let res = step(board, [ATTACK]);
  const actions: never[] = [ATTACK];
  for (let i = 0; i < 4 && res.pending && res.pending.actor === 'A'; i++) {
    const a = res.pending.legalActions[0] as unknown as { type: string };
    if (a.type !== 'choose') { break; }
    actions.push({ ...(a as object), actor: 'A' } as never);
    res = step(board, actions);
  }
  return res.state.players.A.active!.energy.map(c => c.iid);
}

describe('TA-571: Crimson Blaster discards every Energy that provides [R]', () => {
  it('Legacy Energy is [R] Energy while attached: discarded [TA-571]', () => {
    expect(attached(LEGACY)).toEqual([]);
  });
  it('Luminous Energy is [R] Energy while attached: discarded [TA-571]', () => {
    expect(attached(LUMINOUS)).toEqual([]);
  });
  it('control: a Basic Water Energy stays [TA-571]', () => {
    expect(attached(WATER)).toEqual(['a1e2']);
  });
});
