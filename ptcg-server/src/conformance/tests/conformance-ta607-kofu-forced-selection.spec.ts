import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

/**
 * TA-607 (CF-14 / B.11 forced-atomic, B.73 order step): Kofu scr-138 "Put 2 cards from your hand on the bottom of your
 * deck in any order." With exactly 2 cards left in hand the WHICH-2 selection has one outcome (both), and the order is
 * asked by its own decision right after, so the selection's pick order carries nothing: the selection collapses and
 * only the order step pends (rotomancer 766f5b3e7 does the same). B.80: the selected pair is in `transit` (origin
 * hand) at the order step. Control: with 3 cards in hand the selection is a real choice and still surfaces.
 *
 * Mutation guard: drop the `orderFollows` arm of choose-cards.ts forcedPickIndices (or the marker in kofu.ts) and the
 * forced cells red (the selection pends again, then a lone `choose ah3`).
 */
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

function kofuBoard(hand: string[], kofuPrinting = 'scr-138'): NeutralState {
  const players = JSON.parse(KOFU_PLAYERS);
  const byIid: { [k: string]: { iid: string; printing: string } } = {};
  for (const c of players.A.hand) { byIid[c.iid] = c; }
  byIid.ah4 = { iid: 'ah4', printing: kofuPrinting };
  players.A.hand = hand.map(i => byIid[i]);
  return {
    schemaVersion: '0.1', format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null, players,
  } as unknown as NeutralState;
}
const c = (t: string) => ({ actor: 'A', type: 'choose', target: t }) as unknown as NeutralAction;
const PLAY = { actor: 'A', type: 'playSupporter', card: 'ah4' } as unknown as NeutralAction;
function chooses(r: ReturnType<typeof step>): string[] {
  return (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'choose')
    .map(a => (a as { target?: string }).target as string).sort();
}
const transit = (r: ReturnType<typeof step>) => ((r.state.players.A as { transit?: Array<{ iid: string }> }).transit ?? []).map(x => x.iid);

describe('TA-607: Kofu with exactly 2 cards in hand asks only the order', () => {
  it('the forced selection collapses: the order step pends with the pair in transit [TA-607 scr-138]', () => {
    const r = step(kofuBoard(['ah4', 'ah2', 'ah3']), [PLAY]);
    expect(chooses(r)).toEqual(['ah2', 'ah3']);
    expect(transit(r)).toEqual(['ah2', 'ah3']);
    expect(r.state.players.A.hand.map(x => x.iid)).toEqual([]);
  });

  it('one order pick completes: ah2 placed first is the upper card, then draw 4 [TA-607 scr-138]', () => {
    const r = step(kofuBoard(['ah4', 'ah2', 'ah3']), [PLAY, c('ah2')]);
    expect(chooses(r)).toEqual([]);
    expect(r.state.players.A.deck.slice(-2).map(x => x.iid)).toEqual(['ah2', 'ah3']);
    expect(r.state.players.A.hand.map(x => x.iid)).toEqual(['ad5', 'ad6', 'ad7', 'ad8']);
  });

  it('the other order: ah3 first ends [.., ah3, ah2] [TA-607 scr-138]', () => {
    const r = step(kofuBoard(['ah4', 'ah2', 'ah3']), [PLAY, c('ah3')]);
    expect(r.state.players.A.deck.slice(-2).map(x => x.iid)).toEqual(['ah3', 'ah2']);
  });

  it('reprint KofuFA scr-165 collapses the same way [TA-607 scr-165]', () => {
    const r = step(kofuBoard(['ah4', 'ah2', 'ah3'], 'scr-165'), [PLAY, c('ah3')]);
    expect(chooses(r)).toEqual([]);
    expect(r.state.players.A.deck.slice(-2).map(x => x.iid)).toEqual(['ah3', 'ah2']);
  });

  it('control: 3 cards in hand still surface the selection, one pick at a time [TA-607 scr-138]', () => {
    const r0 = step(kofuBoard(['ah4', 'ah1', 'ah2', 'ah3']), [PLAY]);
    expect(chooses(r0)).toEqual(['ah1', 'ah2', 'ah3']);
    expect(transit(r0)).toEqual([]);
    const r1 = step(kofuBoard(['ah4', 'ah1', 'ah2', 'ah3']), [PLAY, c('ah1')]);
    expect(chooses(r1)).toEqual(['ah2', 'ah3']);
    expect(r1.state.players.A.hand.map(x => x.iid)).toEqual(['ah2', 'ah3']);
  });
});

describe('TA-583: the picked pair at the order step is in transit, not on the deck top (B.80)', () => {
  it('3 cards in hand, after choose ah1, ah2: pair in transit {origin hand}, deck untouched, ah3 in hand [TA-583 scr-138]', () => {
    const r = step(kofuBoard(['ah4', 'ah1', 'ah2', 'ah3']), [PLAY, c('ah1'), c('ah2')]);
    expect(chooses(r)).toEqual(['ah1', 'ah2']);
    const t = (r.state.players.A as { transit?: Array<{ iid: string; origin?: { zone: string } }> }).transit ?? [];
    expect(t.map(x => x.iid)).toEqual(['ah1', 'ah2']);
    expect(t.map(x => x.origin?.zone)).toEqual(['hand', 'hand']);
    expect(r.state.players.A.hand.map(x => x.iid)).toEqual(['ah3']);
    expect(r.state.players.A.deck.length).toBe(15);
    expect(r.state.players.A.deck[0].iid).toBe('ad5');
  });
});
