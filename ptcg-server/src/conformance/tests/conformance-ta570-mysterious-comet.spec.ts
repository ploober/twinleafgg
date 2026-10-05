import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-570 Starmie mew-121 Mysterious Comet: "put 2 damage counters on 1 of your opponent's Pokémon. If you placed any
 * damage counters in this way, discard this Pokémon". The counters were a raw `damage += 20` (no protection: Stealthy
 * Hood unb-186 / Hide 'n' Sneak did nothing, #1768) and Starmie was discarded unconditionally. Now the placement goes
 * through PlaceDamageCountersEffect and the discard follows only a placement. Mutation guard: restore the raw write
 * and the Hood cell reds.
 */
const HOOD: NeutralState = {
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
      "bench": [
        {
          "stack": [
            {
              "iid": "a1",
              "printing": "mew-120"
            },
            {
              "iid": "a1s",
              "printing": "mew-121"
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
            "printing": "crz-059"
          }
        ],
        "energy": [],
        "tools": [
          {
            "iid": "bt",
            "printing": "unb-186"
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
const NOHOOD: NeutralState = {
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
      "bench": [
        {
          "stack": [
            {
              "iid": "a1",
              "printing": "mew-120"
            },
            {
              "iid": "a1s",
              "printing": "mew-121"
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
            "printing": "crz-059"
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
const USE = {"actor": "A", "type": "useAbility", "source": "a1", "ability": "Mysterious Comet"} as never;

function used(board: NeutralState) {
  let res = step(board, [USE]);
  const acts: never[] = [USE];
  for (let i = 0; i < 3 && res.pending && res.pending.actor === 'A'; i++) {
    const a = (res.pending.legalActions as unknown as Array<{ type: string; target?: string }>).find(x => x.target === 'b0');
    if (!a) { break; }
    acts.push({ ...a, actor: 'A' } as never);
    res = step(board, acts);
  }
  return res;
}

describe('TA-570: Mysterious Comet places its counters as an Ability, and discards Starmie only if it placed any', () => {
  it('Stealthy Hood on the target: no counters, and Starmie stays in play [TA-570]', () => {
    const res = used(HOOD);
    expect(res.state.players.B.active!.damage).toBe(0);
    expect(res.state.players.A.bench.map(p => p.stack[0].iid)).toContain('a1');
  });
  it('control: 2 counters, Starmie discarded [TA-570]', () => {
    const res = used(NOHOOD);
    expect(res.state.players.B.active!.damage).toBe(20);
    expect(res.state.players.A.discard.map(c => c.iid)).toContain('a1');
  });
});
