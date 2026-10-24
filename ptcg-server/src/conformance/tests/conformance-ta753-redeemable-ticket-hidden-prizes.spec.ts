import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-753 — Redeemable Ticket jtg-156: "Count your Prize cards and shuffle them face down, then put them at the bottom of
 * your deck. If you do, add that many cards from the top of your deck to your Prize cards." Both legs move face-down
 * cards nobody has looked at: the contract's `moved` (B.81) makes `deck` -> `prizes` `hidden`, and a face-down Prize
 * going under the deck is `hidden` too (a card its owner has seen is never hidden; a face-down Prize has not been seen).
 * The adapter projected both as `owner`. A Prize TAKEN (prizes -> hand) stays `owner`.
 * Mutation guard: drop the face-down-Prize clause in moved-events.ts visibilityOf -> both cells see `owner`.
 */

const WATER = 'sve-003', FILLER = 'pal-090';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[]): PokemonInPlay {
  return { stack, energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
    prizes: Array.from({ length: 3 }, (_, i): PrizeRef => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    flags: flags(), ...over,
  };
}
function state(A: PlayerState, B: PlayerState): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}
type Moved = { kind: string; card: string; origin: { zone: string }; destination: { zone: string }; visibility: string };

describe('TA-753 — Redeemable Ticket jtg-156 moves face-down Prizes hidden', () => {
  const run = () => {
    const s = state(
      player('a', { active: pip([{ iid: 'a1s0', printing: FILLER }]), hand: [{ iid: 'ticket', printing: 'jtg-156' }] }),
      player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]) }),
    );
    const r = step(s, [{ actor: 'A', type: 'playItem', card: 'ticket' } as unknown as NeutralAction]);
    return { r, moved: (r.events as unknown as Moved[]).filter(e => e.kind === 'moved') };
  };

  it('the three old Prizes go prizes -> deck with visibility hidden [TA-753 jtg-156 prizes>deck]', () => {
    const { moved } = run();
    const legs = moved.filter(e => e.origin.zone === 'prizes' && e.destination.zone === 'deck');
    expect(legs.map(e => e.card).sort()).toEqual(['ap0', 'ap1', 'ap2']);
    expect(legs.map(e => e.visibility)).toEqual(['hidden', 'hidden', 'hidden']);
  });
  it('the three new Prizes go deck -> prizes with visibility hidden [TA-753 jtg-156 deck>prizes]', () => {
    const { r, moved } = run();
    const legs = moved.filter(e => e.origin.zone === 'deck' && e.destination.zone === 'prizes');
    expect(legs.length).toBe(3);
    expect(legs.map(e => e.visibility)).toEqual(['hidden', 'hidden', 'hidden']);
    expect(r.state.players.A.prizes.length).toBe(3);
    expect(r.state.players.A.prizes.every(p => !p.faceUp)).toBe(true);
  });
  it('the Ticket itself goes to the discard pile, public [TA-753 jtg-156 ticket]', () => {
    const { moved } = run();
    const t = moved.filter(e => e.card === 'ticket');
    expect(t.length).toBeGreaterThan(0);
    expect(t.every(e => e.visibility === 'public')).toBe(true);
  });
});
