import { step } from '../driver';
import { NeutralState } from '../neutral-types';

/**
 * TA-565: Moltres mew-146 Blazing Flight — "Discard 2 [R] Energy from this Pokémon. This attack does 120 damage to 1
 * of your opponent's Benched Pokémon." The discard is not conditional on a Bench; the attack returned before the
 * discard prompt when the opponent had no Benched Pokémon. Mutation guard: restore the early return and the cell reds.
 */
const NOBENCH: NeutralState = {
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
            "printing": "mew-146"
          }
        ],
        "energy": [
          {
            "iid": "ae1",
            "printing": "sve-002"
          },
          {
            "iid": "ae2",
            "printing": "sve-002"
          },
          {
            "iid": "ae3",
            "printing": "sve-002"
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
          "iid": "ah1",
          "printing": "sve-003"
        }
      ],
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
        },
        {
          "iid": "ad3",
          "printing": "sve-003"
        },
        {
          "iid": "ad4",
          "printing": "sve-003"
        },
        {
          "iid": "ad5",
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
        "vstarUsed": false,
        "prizesTaken": 5
      }
    },
    "B": {
      "active": {
        "stack": [
          {
            "iid": "b1",
            "printing": "twm-187"
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
          "iid": "bh1",
          "printing": "sve-003"
        },
        {
          "iid": "bh2",
          "printing": "sve-003"
        },
        {
          "iid": "bh3",
          "printing": "sve-003"
        },
        {
          "iid": "bh4",
          "printing": "sve-003"
        }
      ],
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
        },
        {
          "iid": "bd3",
          "printing": "sve-003"
        },
        {
          "iid": "bd4",
          "printing": "sve-003"
        },
        {
          "iid": "bd5",
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
        "vstarUsed": false,
        "prizesTaken": 5
      }
    }
  },
  "activeEffects": [],
  "format": "unlimited"
} as unknown as NeutralState;
const ATTACK = {"actor": "A", "type": "declareAttack", "source": "a1", "name": "Blazing Flight"} as never;

describe('TA-565: Blazing Flight discards its 2 [R] Energy even with no opposing Bench', () => {
  it('no Benched Pokémon: the discard is still asked, and two Fire Energy leave Moltres [TA-565]', () => {
    const paused = step(NOBENCH, [ATTACK]);
    expect(paused.pending?.actor).toBe('A');
    expect((paused.pending?.legalActions ?? []).every(a => (a as { type: string }).type === 'discard')).toBe(true);
    const picks = (paused.pending?.legalActions ?? []).slice(0, 2).map(a => ({ ...(a as object) }) as never);
    const one = step(NOBENCH, [ATTACK, picks[0]]);
    const second = (one.pending?.legalActions ?? [])[0] as never;
    const done = step(NOBENCH, [ATTACK, picks[0], second]);
    expect(done.state.players.A.discard.length).toBe(2);
    expect(done.state.players.A.active!.energy.length).toBe(NOBENCH.players.A.active!.energy.length - 2);
  });
});
