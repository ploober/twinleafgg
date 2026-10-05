import { step } from '../driver';
import { NeutralState, NeutralEvent } from '../neutral-types';

/**
 * TA-573 Ethan's Pinsir dri-001 Rallying Horn — "If any of your Ethan's Pokémon were Knocked Out by damage from an
 * attack from your opponent's Pokémon during their last turn, this attack does 100 more damage." The same Pokémon must
 * be both Ethan's AND Knocked Out by attack damage. B's Munkidori KOs Ethan's Pichu with Adrena-Brain COUNTERS, then
 * Mind Bend KOs a non-Ethan's Pokémon by damage: the prefab paired the player-level "an attack did damage" flag with
 * the Ethan's tag of any KO, so Rallying Horn did 170. Mutation guard: read the player-level flag again and the first
 * cell reds.
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
const DEFECT = [{"actor": "B", "type": "useAbility", "source": "m1", "ability": "Adrena-Brain"}, {"actor": "B", "type": "placeCounter", "target": "ep1", "op": "placeCounters"}, {"actor": "B", "type": "choose", "target": "m1"}, {"actor": "B", "type": "choose", "target": "m1"}, {"actor": "B", "type": "takePrize", "index": 0}, {"actor": "B", "type": "declareAttack", "source": "m1", "name": "Mind Bend"}, {"actor": "B", "type": "takePrize", "index": 0}, {"actor": "A", "type": "promoteBench", "target": "ep2"}, {"actor": "A", "type": "declareAttack", "source": "ep2", "name": "Rallying Horn"}] as never[];
const CONTROL = [{"actor": "B", "type": "declareAttack", "source": "m1", "name": "Mind Bend"}, {"actor": "B", "type": "takePrize", "index": 0}, {"actor": "A", "type": "promoteBench", "target": "ep2"}, {"actor": "A", "type": "declareAttack", "source": "ep2", "name": "Rallying Horn"}] as never[];
const hornHit = (acts: never[]) => (step(BOARD, acts).events as NeutralEvent[])
  .filter(e => e.kind === 'damaged' && (e as { target?: string }).target === 'm1').map(e => (e as { hp?: number }).hp).pop();

describe('TA-573: Rallying Horn needs an Ethan\'s Pokémon Knocked Out BY ATTACK DAMAGE', () => {
  it('Ethan\'s Pichu KO\'d by counters, a non-Ethan\'s Pokémon KO\'d by damage: no bonus, 70 [TA-573]', () => {
    expect(hornHit(DEFECT)).toBe(70);
  });
  it('control: no counter KO -> 70 [TA-573]', () => {
    expect(hornHit(CONTROL)).toBe(70);
  });
});
