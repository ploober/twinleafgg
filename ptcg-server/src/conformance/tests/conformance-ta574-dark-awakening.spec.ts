import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-574 Team Rocket's Nidorina dri-115 Dark Awakening — "Choose up to 2 of your [D] Pokémon. For each of those
 * Pokémon, search your deck for a card that evolves from that Pokémon". The [D] is on the Pokémon in play, not on the
 * evolution: Morpeko V (Darkness) evolves into Lightning Morpeko VMAX. The gate required a DARKNESS evolution, so
 * (through Mew ex's Genome Hacking copy) the pick, the search and the shuffle were all skipped. Mutation guard: restore
 * the Darkness-evolution gate and the first cell reds.
 */
const MORPEKO: NeutralState = {
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
            "printing": "mew-151"
          }
        ],
        "energy": [
          {
            "iid": "a1e0",
            "printing": "sve-007"
          },
          {
            "iid": "a1e1",
            "printing": "sve-007"
          },
          {
            "iid": "a1e2",
            "printing": "sve-007"
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
      "bench": [
        {
          "stack": [
            {
              "iid": "ab1s0",
              "printing": "brs-095"
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
          },
          "faceDown": false
        }
      ],
      "hand": [],
      "deck": [
        {
          "iid": "ad0",
          "printing": "ssh-080"
        },
        {
          "iid": "ad1",
          "printing": "asc-004"
        },
        {
          "iid": "ad2",
          "printing": "asc-001"
        },
        {
          "iid": "ad3",
          "printing": "sve-001"
        },
        {
          "iid": "ad4",
          "printing": "sve-002"
        },
        {
          "iid": "ad5",
          "printing": "sve-005"
        },
        {
          "iid": "ad6",
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
            "printing": "dri-114"
          },
          {
            "iid": "b1s1",
            "printing": "dri-115"
          }
        ],
        "energy": [
          {
            "iid": "b1e0",
            "printing": "sve-007"
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
const NIDORAN: NeutralState = {
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
            "printing": "mew-151"
          }
        ],
        "energy": [
          {
            "iid": "a1e0",
            "printing": "sve-007"
          },
          {
            "iid": "a1e1",
            "printing": "sve-007"
          },
          {
            "iid": "a1e2",
            "printing": "sve-007"
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
      "bench": [
        {
          "stack": [
            {
              "iid": "ab1s0",
              "printing": "dri-114"
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
          },
          "faceDown": false
        }
      ],
      "hand": [],
      "deck": [
        {
          "iid": "ad0",
          "printing": "dri-115"
        },
        {
          "iid": "ad1",
          "printing": "asc-004"
        },
        {
          "iid": "ad2",
          "printing": "asc-001"
        },
        {
          "iid": "ad3",
          "printing": "sve-001"
        },
        {
          "iid": "ad4",
          "printing": "sve-002"
        },
        {
          "iid": "ad5",
          "printing": "sve-005"
        },
        {
          "iid": "ad6",
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
            "printing": "dri-114"
          },
          {
            "iid": "b1s1",
            "printing": "dri-115"
          }
        ],
        "energy": [
          {
            "iid": "b1e0",
            "printing": "sve-007"
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
const ATTACK = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Genome Hacking' } as unknown as NeutralAction;
const COPY = { actor: 'A', type: 'choose', target: 'b1s1', name: 'Dark Awakening' } as unknown as NeutralAction;
const targets = (b: NeutralState) => (step(b, [ATTACK, COPY]).pending?.legalActions ?? [])
  .map(a => (a as { target?: string }).target);

describe('TA-574: Dark Awakening evolves any [D] Pokémon, whatever the evolution\'s type', () => {
  it('Morpeko V (evolving into Lightning Morpeko VMAX) can be chosen [TA-574]', () => {
    expect(targets(MORPEKO)).toContain('ab1s0');
  });
  it('control: Team Rocket\'s Nidoran with a Darkness evolution in the deck [TA-574]', () => {
    expect(targets(NIDORAN)).toContain('ab1s0');
  });
});
