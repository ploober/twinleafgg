import { step } from '../driver';
import {
  NeutralState, NeutralAction, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-704 — CF-70 / B.81: Energy Swatter por-073 advertises its pick as a discard and its leg as `top` on an empty deck.
 *
 * Card text (card-data/final/por.json): "Your opponent reveals their hand, and you choose an Energy card you find
 * there and put it on the bottom of their deck."
 *
 * The card asked its pick with CHOOSE_CARD_TO_DISCARD, which the adapter surfaces as `discard {op: discard,
 * destination: discardPile}` (CF-70) and projects into the discard pile — for an effect that puts the card on the
 * BOTTOM of the opponent's deck (the vocabulary has `op: moveTo`, `destination: deckBottom`). And the card moved it
 * with a plain MOVE_CARDS, so on an EMPTY deck (the landed card is the whole deck, top ≡ bottom) the `moved` leg's
 * position read `top`; the text says bottom.
 */

const SWATTER = 'por-073';
const BELLSPROUT = 'asc-004';
const G = 'sve-001';
const W = 'sve-003';
const P = 'sve-005';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: W, faceUp: false }));
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}

/** A's turn; B's hand holds two Energy and a Basic; B's deck is `bDeck`. */
function board(bDeck: CardRef[]): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', BELLSPROUT), bench: [mon('ab1', BELLSPROUT)],
        hand: [{ iid: 'ah1', printing: SWATTER }, { iid: 'ah2', printing: G }], deck: [{ iid: 'ad1', printing: G }, { iid: 'ad2', printing: G }], prizes: prizes('ap', 6),
      }),
      B: player({
        active: mon('b1', BELLSPROUT), bench: [mon('bb1', BELLSPROUT)],
        hand: [{ iid: 'bh1', printing: G }, { iid: 'bh2', printing: P }, { iid: 'bh3', printing: BELLSPROUT }], deck: bDeck, prizes: prizes('bp', 6),
      }),
    },
  } as NeutralState;
}

const play: NeutralAction = { actor: 'A', type: 'playItem', card: 'ah1' } as NeutralAction;
const choose = (target: string): NeutralAction => ({ actor: 'A', type: 'choose', target } as NeutralAction);
type Moved = Extract<NeutralEvent, { kind: 'moved' }>;
const legOf = (events: NeutralEvent[], card: string) => events.find((e): e is Moved => e.kind === 'moved' && e.card === card);

describe('TA-704 Energy Swatter por-073: the pick is a move to the bottom of the opponent\'s deck', () => {
  it('the offered picks are the two Energy, op moveTo, destination deckBottom [TA-704]', () => {
    const r = step(board([]), [play]);
    expect(r.pending?.actor).toBe('A');
    const la = (r.pending?.legalActions ?? []) as Array<{ type: string; target?: string; op?: string; destination?: string }>;
    expect(la.map(a => a.target).sort()).toEqual(['bh1', 'bh2']);
    for (const a of la) {
      expect(a.type).toBe('choose');
      expect(a.op).toBe('moveTo');
      expect(a.destination).toBe('deckBottom');
    }
  });

  it('on an EMPTY deck the chosen Energy\'s leg reads hand -> deck:bottom [TA-704]', () => {
    const r = step(board([]), [play, choose('bh1')]);
    expect(r.state.players.B.deck.map(c => c.iid)).toEqual(['bh1']);
    expect(r.state.players.B.hand.map(c => c.iid).sort()).toEqual(['bh2', 'bh3']);
    const leg = legOf(r.events, 'bh1');
    expect(leg).toBeDefined();
    expect(leg!.owner).toBe('B');
    expect(leg!.origin).toEqual({ zone: 'hand' });
    expect(leg!.destination).toEqual({ zone: 'deck', position: 'bottom' });
  });

  it('CONTROL: on a stocked deck the chosen Energy goes under it and the leg reads deck:bottom', () => {
    const r = step(board([{ iid: 'bd1', printing: G }, { iid: 'bd2', printing: G }, { iid: 'bd3', printing: G }]), [play, choose('bh2')]);
    expect(r.state.players.B.deck.map(c => c.iid)).toEqual(['bd1', 'bd2', 'bd3', 'bh2']);
    expect(legOf(r.events, 'bh2')?.destination).toEqual({ zone: 'deck', position: 'bottom' });
  });

  it('CONTROL (CF-14): one Energy in the opponent\'s hand is a forced pick, applied with no pending; the leg reads deck:bottom', () => {
    const b = board([]);
    b.players.B.hand = [{ iid: 'bh1', printing: G }, { iid: 'bh3', printing: BELLSPROUT }];
    const r = step(b, [play]);
    // No pick surfaced: the item resolved whole and the turn's main menu is what pends.
    expect(r.pending?.descriptor).toBe('main');
    expect((r.pending?.legalActions ?? []).some(a => a.type === 'choose')).toBe(false);
    expect(r.state.players.B.deck.map(c => c.iid)).toEqual(['bh1']);
    expect(legOf(r.events, 'bh1')?.destination).toEqual({ zone: 'deck', position: 'bottom' });
  });

  it('the legacy discard verb is not a legal continuation [TA-704]', () => {
    const r = step(board([]), [play, { actor: 'A', type: 'discard', owner: 'B', target: 'bh1' } as NeutralAction]);
    expect(r.status).toBe('invalidAction');
  });
});
