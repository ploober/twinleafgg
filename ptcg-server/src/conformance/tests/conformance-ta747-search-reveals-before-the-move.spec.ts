import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-747: upstream 95313f768 (ShowCardsPrompt animation) moved the reveal of searched cards after their move to the
 * hand, in 173 card files; the 2026-10-22 merge reversed it in the 20 in-pool ones (B.34, TA-265: the reveal precedes
 * the move). Earthen Vessel par-163: "Search your deck for up to 2 Basic Energy cards, reveal them, and put them into
 * your hand." The reveal of both cards comes before either reaches the hand. The other 19 cards are held by their
 * fix-signatures entries.
 */

const FILL = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a0', 'pal-090'), hand: [{ iid: 'ev', printing: 'par-163' }, { iid: 'fod', printing: FILL }],
        deck: cards('ad', ['sve-001', 'sve-002', 'pal-090', FILL, 'pal-090']), prizes: cards('ap', [FILL, FILL, FILL]).map(c => ({ ...c, faceUp: false })),
      }),
      B: player({ active: mon('b0', 'pal-090'), deck: cards('bd', [FILL, FILL, FILL]), prizes: cards('bp', [FILL, FILL, FILL]).map(c => ({ ...c, faceUp: false })) }),
    },
  } as NeutralState;
}

describe('TA-747 searched cards are revealed before they move to the hand', () => {
  it('[TA-747 par-163] Earthen Vessel reveals both Energy before either reaches the hand', () => {
    let actions = [{ actor: 'A', type: 'playItem', card: 'ev' } as never];
    let r = step(board(), actions);
    while (r.status === 'awaitingAction' && r.pending && r.pending.descriptor !== 'main' && !/huffle/.test(r.pending.descriptor) && actions.length < 5) {
      actions = [...actions, r.pending.legalActions[0] as never];
      r = step(board(), actions);
    }
    const events = r.events as Array<{ kind: string, cards?: string[], card?: string, destination?: { zone: string } }>;
    const reveal = events.findIndex(e => e.kind === 'reveal');
    const toHand = events.map((e, i) => (e.kind === 'moved' && e.destination?.zone === 'hand' ? i : -1)).filter(i => i >= 0);
    expect(events[reveal].cards?.length).toBe(2);
    expect(toHand.length).toBe(2);
    expect(toHand.every(i => i > reveal)).toBe(true);
  });
});
