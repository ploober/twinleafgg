import { step } from '../driver';
import { NeutralState, NeutralEvent } from '../neutral-types';

/**
 * TA-318(b) residual: moving damage counters is a RELOCATION, not damage. Munkidori twm-095 Adrena-Brain moves its own
 * counters through PlaceDamageCountersEffect, which logs LOG_PLAYER_PLACES_DAMAGE_COUNTERS, so the adapter's
 * relocation test (no damage log at all) failed and the move surfaced as `damaged` on both Pokémon; rotomancer emits
 * none. A dispatch whose only damage logs are placements summing to the drop elsewhere is a relocation. Mutation guard:
 * drop that branch in events.ts and this cell reds.
 */
const BOARD: NeutralState = {
  "schemaVersion": "0.1",
  "format": "unlimited",
  "turn": 4,
  "activePlayer": "B",
  "firstPlayer": "B",
  "phase": "main",
  "outcome": "ongoing",
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a1",
            "printing": "svi-021"
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
              "iid": "ep1",
              "printing": "dri-071"
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
              "iid": "ep2",
              "printing": "dri-001"
            }
          ],
          "energy": [
            {
              "iid": "e1",
              "printing": "sve-001"
            },
            {
              "iid": "e2",
              "printing": "sve-001"
            },
            {
              "iid": "e3",
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
        }
      ],
      "hand": [],
      "deck": [
        {
          "iid": "ad0",
          "printing": "sve-003"
        },
        {
          "iid": "ad1",
          "printing": "sve-003"
        },
        {
          "iid": "ad2",
          "printing": "sve-003"
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
            "iid": "m1",
            "printing": "twm-095"
          }
        ],
        "energy": [
          {
            "iid": "bd",
            "printing": "sve-007"
          },
          {
            "iid": "bp",
            "printing": "sve-005"
          }
        ],
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
      },
      "bench": [],
      "hand": [],
      "deck": [
        {
          "iid": "bd0",
          "printing": "sve-003"
        },
        {
          "iid": "bd1",
          "printing": "sve-003"
        },
        {
          "iid": "bd2",
          "printing": "sve-003"
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

describe('TA-318(b) residual: a logged counter move is not damage', () => {
  it('Adrena-Brain moves 10 from Munkidori to the opposing Active: no damaged / healed events [TA-603]', () => {
    const res = step(BOARD, [
      { actor: 'B', type: 'useAbility', source: 'm1', ability: 'Adrena-Brain' } as never,
      { actor: 'B', type: 'placeCounter', target: 'a1', op: 'placeCounters' } as never,
      { actor: 'B', type: 'confirm', value: false } as never]);
    expect(res.state.players.A.active!.damage).toBe(10);
    expect((res.events as NeutralEvent[]).filter(e => e.kind === 'damaged' || e.kind === 'healed')).toEqual([]);
  });
});
