import { step } from '../driver';
import { NeutralState, NeutralEvent } from '../neutral-types';

/**
 * TA-577: a Knock Out made by a Knock Out REACTION joins the same Knock Out group (Advanced Rulebook KO steps 3-4: all
 * Knocked Out Pokémon are discarded at the same time and both players take Prizes; both winning is a tie, B.51).
 * Team Rocket's Arbok dri-113 Spinning Tail Knocks Out B's Maractus jtg-008 and a Benched Pokémon; Maractus's
 * Exploding Needles puts Arbok at 0 HP. A has 2 Prizes left, B has 1. Twinleaf fixed the victim list BEFORE the
 * reactions, so Arbok was Knocked Out only after A's Prizes and the win check: gameOver winA with Arbok still Active.
 * Mutation guard: drop the re-collection after resolveKnockOutReactions (check-effect.ts) and the first cell reds.
 */
const BOARD: NeutralState = {
  "schemaVersion": "0.1",
  "turn": 6,
  "activePlayer": "A",
  "firstPlayer": "B",
  "phase": "main",
  "outcome": "ongoing",
  "players": {
    "A": {
      "active": {
        "stack": [
          {
            "iid": "a0",
            "printing": "dri-112"
          },
          {
            "iid": "a1",
            "printing": "dri-113"
          }
        ],
        "energy": [
          {
            "iid": "ae0",
            "printing": "sve-007"
          },
          {
            "iid": "ae1",
            "printing": "sve-007"
          },
          {
            "iid": "ae2",
            "printing": "sve-007"
          }
        ],
        "tools": [],
        "damage": 70,
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
              "iid": "ab0",
              "printing": "dri-112"
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
          "iid": "Ad0",
          "printing": "sve-007"
        },
        {
          "iid": "Ad1",
          "printing": "sve-007"
        },
        {
          "iid": "Ad2",
          "printing": "sve-007"
        },
        {
          "iid": "Ad3",
          "printing": "sve-007"
        }
      ],
      "discard": [],
      "lostZone": [],
      "prizes": [
        {
          "iid": "Ap0",
          "printing": "sve-007",
          "faceUp": null
        },
        {
          "iid": "Ap1",
          "printing": "sve-007",
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
            "printing": "jtg-008"
          }
        ],
        "energy": [],
        "tools": [],
        "damage": 80,
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
              "iid": "bb0",
              "printing": "ssp-198"
            }
          ],
          "energy": [
            {
              "iid": "be0",
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
        {
          "stack": [
            {
              "iid": "bb1",
              "printing": "dri-054"
            },
            {
              "iid": "bb2",
              "printing": "dri-055"
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
  },
  "activeEffects": []
} as unknown as NeutralState;
const ACTIONS = [{"actor": "A", "type": "declareAttack", "source": "a0", "name": "Spinning Tail"}, {"actor": "A", "type": "resolveNext", "kind": "abilityEffect", "ability": "Exploding Needles", "source": "b0", "subject": "b0"}] as never[];
const ACCEPT = { actor: 'B', type: 'confirm', value: true } as never;
const kos = (events: NeutralEvent[]) => events.filter(e => e.kind === 'ko').map(e => (e as { target?: string }).target);

describe('TA-577: a Knock Out made by a Knock Out reaction joins the same group', () => {
  it('Exploding Needles KOs the Attacking Arbok in the same group: B takes its Prize too, and the race ties [TA-577]', () => {
    const afterReaction = step(BOARD, [...ACTIONS, ACCEPT]);
    expect(kos(afterReaction.events).sort()).toEqual(['a0', 'b0', 'bb0']);
    expect(afterReaction.state.players.A.active).toBeNull();
    const takeAll = [...ACTIONS, ACCEPT,
      { actor: 'B', type: 'takePrize', index: 0 } as never,
      { actor: 'A', type: 'takePrize', index: 0 } as never,
      { actor: 'A', type: 'takePrize', index: 0 } as never];
    const end = step(BOARD, takeAll);
    expect(end.state.players.B.prizes).toEqual([]);
    expect(end.state.players.A.prizes).toEqual([]);
    expect(end.state.outcome).toBe('tie');
  });

  it('control: with 3 Prizes left A does not win, and Arbok is still Knocked Out in the same group [TA-577]', () => {
    const board = JSON.parse(JSON.stringify(BOARD)) as NeutralState;
    board.players.A.prizes.push({ iid: 'Ap2', printing: board.players.A.prizes[0].printing, faceUp: false });
    const afterReaction = step(board, [...ACTIONS, ACCEPT]);
    expect(kos(afterReaction.events).sort()).toEqual(['a0', 'b0', 'bb0']);
  });
});
