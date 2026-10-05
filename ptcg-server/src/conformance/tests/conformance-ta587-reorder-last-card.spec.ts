import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-587: an N-card "in any order" placement is N-1 picks — the last card has one place left, a forced non-decision
 * collapsed under CF-14 (B.73, owner addendum 2026-10-02). Kofu scr-138 put 2 cards from the hand on the bottom "in any
 * order": twinleaf asked for the second card after the first was placed. Mutation guard: complete only at n picks
 * again (order-cards.ts) and this cell reds.
 */
function kofuBoard(): NeutralState {
  return {
    schemaVersion: '0.1', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: JSON.parse(KOFU_PLAYERS),
  } as unknown as NeutralState;
}
const KOFU_PLAYERS = JSON.stringify({
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
});
const c = (t: string) => ({ actor: 'A', type: 'choose', target: t }) as unknown as NeutralAction;
const PLAY = { actor: 'A', type: 'playSupporter', card: 'ah4' } as unknown as NeutralAction;

describe('TA-587: a reorder asks N-1 placements', () => {
  it('Kofu: after placing ah1 the last card is not asked; the draw follows [TA-587]', () => {
    const res = step(kofuBoard(), [PLAY, c('ah1'), c('ah2'), c('ah1')]);
    expect((res.pending?.legalActions ?? []).some(a => (a as { type: string; target?: string }).type === 'choose')).toBe(false);
    expect(res.state.players.A.deck.slice(-2).map(x => x.iid)).toEqual(['ah1', 'ah2']);
  });
});
