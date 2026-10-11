import { step } from '../driver';
import {
  NeutralState, NeutralAction, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-697 (B.80): Special Red Card cri-082 / cri-113 — "Your opponent shuffles their hand and puts it on the bottom of
 * their deck. If they put any cards on the bottom of their deck in this way, they draw 3 cards."
 *
 * At the shuffle pause the HAND is what the opponent has lifted: it is in transit {origin hand, destination {deck,
 * bottom}, visibility owner} and the deck projects as it is. The card used to stage the shuffle the TA-370/TA-379 way
 * (the untouched deck into a temp list, the hand into the emptied deck), so the wire showed the whole deck in transit
 * (origin deck) and the hand on deck:top, and the draw legs read transit -> hand. TA-598 fixed the identical staging on
 * Vivillon por-009 Grand Wing only (the hand under the untouched deck, ShuffleDeckPrompt {zone hand, bottomCount}); this
 * is that fix on the sibling card. Board = fz-refuzz-TA-326-cri-082 (results/fuzz-20261010-full/corpus).
 */

const RED_CARD = 'cri-082';
const RED_CARD_FA = 'cri-113';
const G = 'sve-001';
const R = 'sve-002';
const W = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function basic(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: G, faceUp: false }));
}

function board(redCard: string = RED_CARD): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 5, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: basic('a1', 'twm-025'), bench: [basic('ab0', 'por-063')],
        hand: [{ iid: 'Ah0', printing: redCard }, { iid: 'Ah1', printing: G }, { iid: 'Ah2', printing: R }, { iid: 'Ah3', printing: W }],
        deck: [{ iid: 'Ad0', printing: 'por-063' }, { iid: 'Ad1', printing: 'asc-136' }, { iid: 'Ad2', printing: 'blk-001' }, { iid: 'Ad3', printing: 'tef-135' },
          { iid: 'Ad4', printing: G }, { iid: 'Ad5', printing: R }, { iid: 'Ad6', printing: W }, { iid: 'Ad7', printing: 'sve-005' }, { iid: 'Ad8', printing: 'asc-004' }],
        prizes: prizes('Ap', 3),
      }),
      B: player({
        active: basic('b0', 'blk-001'), bench: [basic('bb0', 'asc-004')],
        hand: [{ iid: 'Bh0', printing: G }, { iid: 'Bh1', printing: G }, { iid: 'Bh2', printing: G }],
        deck: [{ iid: 'Bd0', printing: G }, { iid: 'Bd1', printing: R }, { iid: 'Bd2', printing: W }],
        prizes: prizes('Bp', 3),
      }),
    },
  };
}

const PLAY = { actor: 'A', type: 'playItem', card: 'Ah0' } as unknown as NeutralAction;
const ORDER = { actor: 'system', type: 'shuffle', order: ['Bh2', 'Bh1', 'Bh0'] } as unknown as NeutralAction;

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;
function legs(events: NeutralEvent[], iid: string): string[] {
  return events.filter((e): e is Moved => e.kind === 'moved' && (e as Moved).card === iid)
    .map(e => `${e.origin.zone}>${e.destination.zone}${e.destination.position ? ':' + e.destination.position : ''}:${e.visibility}`);
}

describe('TA-697 Special Red Card cri-082: the lifted HAND is in transit at the shuffle pause, the deck stays in place (B.80)', () => {
  it('at the pause: B.deck untouched, B.hand empty, B.transit = the hand {hand -> deck bottom, owner}; the shuffle is over the hand [TA-697 cri-082]', () => {
    const res = step(board(), [PLAY]);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending?.actor).toBe('system');
    const shuffle = res.pending?.legalActions[0] as { type: string; deck?: string[] } | undefined;
    expect(shuffle?.type).toBe('shuffle');
    expect([...(shuffle?.deck ?? [])].sort()).toEqual(['Bh0', 'Bh1', 'Bh2']);
    const B = res.state.players.B;
    expect(B.deck.map(c => c.iid)).withContext('the untouched deck projects as it is').toEqual(['Bd0', 'Bd1', 'Bd2']);
    expect(B.hand).toEqual([]);
    expect((B.transit ?? []).map(t => ({ iid: t.iid, origin: t.origin, destination: t.destination, visibility: t.visibility })))
      .withContext('the hand is what was lifted').toEqual([
        { iid: 'Bh0', origin: { zone: 'hand' }, destination: { zone: 'deck', position: 'bottom' }, visibility: 'owner' },
        { iid: 'Bh1', origin: { zone: 'hand' }, destination: { zone: 'deck', position: 'bottom' }, visibility: 'owner' },
        { iid: 'Bh2', origin: { zone: 'hand' }, destination: { zone: 'deck', position: 'bottom' }, visibility: 'owner' }]);
    // B.81: the legs of the pause are the hand's lift; the deck cards never move.
    for (const h of ['Bh0', 'Bh1', 'Bh2']) { expect(legs(res.events, h)).withContext(h).toEqual(['hand>transit:owner']); }
    for (const d of ['Bd0', 'Bd1', 'Bd2']) { expect(legs(res.events, d)).withContext(d).toEqual([]); }
  });

  it('after the order: the hand is bottomed in that order under the untouched deck and B draws the deck; the draws read deck -> hand, the hand transit -> deck:bottom [TA-697 cri-082]', () => {
    const res = step(board(), [PLAY, ORDER]);
    expect(res.status).toBe('awaitingAction');
    const B = res.state.players.B;
    expect(B.hand.map(c => c.iid).sort()).toEqual(['Bd0', 'Bd1', 'Bd2']);
    expect(B.deck.map(c => c.iid)).toEqual(['Bh2', 'Bh1', 'Bh0']);
    expect(B.transit ?? []).toEqual([]);
    expect(res.events.some(e => e.kind === 'shuffled' && (e as { zone?: string }).zone === 'hand')).toBe(true);
    for (const d of ['Bd0', 'Bd1', 'Bd2']) { expect(legs(res.events, d)).withContext(d).toEqual(['deck>hand:owner']); }
    for (const h of ['Bh0', 'Bh1', 'Bh2']) { expect(legs(res.events, h)).withContext(h).toEqual(['hand>transit:owner', 'transit>deck:bottom:owner']); }
  });

  it('cri-113 (the full-art print, the same class) projects the same pause [TA-697 cri-113]', () => {
    const res = step(board(RED_CARD_FA), [PLAY]);
    expect(res.pending?.actor).toBe('system');
    const B = res.state.players.B;
    expect(B.deck.map(c => c.iid)).toEqual(['Bd0', 'Bd1', 'Bd2']);
    expect((B.transit ?? []).map(t => `${t.iid}:${t.origin?.zone}>${t.destination?.zone}:${t.destination?.position}:${t.visibility}`))
      .toEqual(['Bh0:hand>deck:bottom:owner', 'Bh1:hand>deck:bottom:owner', 'Bh2:hand>deck:bottom:owner']);
  });
});
