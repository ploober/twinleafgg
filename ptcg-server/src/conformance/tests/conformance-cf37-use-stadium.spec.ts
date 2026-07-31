import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  CardRef, SCHEMA_VERSION
} from '../neutral-types';

// CF-37 — `useStadium`: the wire verb for "use the in-play Stadium's once-per-turn effect".
//
// Before this landed the ENTIRE activated-Stadium surface was undrivable on BOTH engines (a
// symmetric blind spot of the CF-30 shape: neither side offered the action, so the differential saw
// nothing to compare). twinleaf's game layer always had the machinery — `UseStadiumAction`,
// `game-actions.ts:51`, reached by the real client through the socket — but the conformance adapter
// never enumerated or dispatched it.
//
// The rules these guards pin, and where they come from:
//   • per-CARD cap (compendium #926): use the Stadium, replace it, use the NEW one the same turn.
//     Not per-player-per-turn. #975 extends it to a replacement of the SAME name.
//   • "Once during EACH player's turn": the non-owner gets their own use on their own turn.
//   • a purely passive Stadium presents no action at all (Beach Court "retreat cost is [C] less").
//   • CF-33 / compendium #925: an activation that can achieve nothing is not offered.
// Detection of the last two rides on twinleaf's own convention — a Stadium that cannot be activated
// answers `UseStadiumEffect` by throwing CANNOT_USE_STADIUM — surfaced by the clone probe in
// legal-actions.ts, so the menu never advertises a move the reducer would refuse (design §10.3).

const WATER = 'sve-003', LIGHTNING = 'sve-004';
const ACADEMY = 'sfa-054';    // Academy at Night — "…may put a card from their hand on top of their deck"
const LEVINCIA = 'jtg-150';   // Levincia — "…may put up to 2 Basic [L] Energy cards from their discard into their hand"
const BEACH_COURT = 'svi-167'; // passive: "The Retreat Cost of each Basic Pokémon in play is [C] less."

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function inPlay(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState, stadium: string | null): NeutralState {
  const wd = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}-pz${i}`, printing: WATER, faceUp: false })),
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing',
    stadium: stadium === null ? null : { iid: 'stad', printing: stadium, owner: 'A' },
    players: { A: wd(A, 'A'), B: wd(B, 'B') },
  };
}

const use = (actor: 'A' | 'B' = 'A') => ({ actor, type: 'useStadium' as const });
const types = (r: ReturnType<typeof step>): string[] => (r.pending?.legalActions ?? []).map(a => (a as { type: string }).type);
const stadiumOffers = (r: ReturnType<typeof step>) =>
  (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'useStadium');

/** A active with a 2-card hand, B a plain defender — the CF-37 measurement board. */
function academyBoard(hand: string[] = [WATER, 'asc-004'], discard: string[] = []): NeutralState {
  return board(
    player({ active: inPlay('A-act', 'asc-004'), hand: cards('ah', hand), discard: cards('ax', discard), deck: cards('ad', [WATER, WATER, WATER]) }),
    player({ active: inPlay('B-act', 'ssp-087') }),
    ACADEMY,
  );
}

describe('Conformance — CF-37 useStadium (activated Stadium effects)', () => {

  it('an activated Stadium in play offers `useStadium`, with no card/source', () => {
    const r = step(academyBoard(), []);
    expect(r.status).toBe('awaitingAction');
    expect(r.pending?.actor).toBe('A');
    const offers = stadiumOffers(r);
    expect(offers.length).toBe(1);
    // One shared slot ⇒ nothing to name. `actor` is the only other field the contract allows.
    expect(Object.keys(offers[0]).sort()).toEqual(['actor', 'type']);
  });

  it('driving it applies the effect and spends the turn\'s use', () => {
    const b = academyBoard();
    // Activation itself carries no choice; the card's pick surfaces as its own pending.
    const r1 = step(b, [use()]);
    expect(r1.status).toBe('awaitingAction');
    expect(types(r1)).toEqual(['choose', 'choose']);

    const r2 = step(b, [use(), { actor: 'A', type: 'choose', target: 'ah0' }]);
    expect(r2.status).toBe('awaitingAction');
    expect(r2.state.players.A.hand.map(c => c.iid)).toEqual(['ah1']);
    expect(r2.state.players.A.deck[0].iid).toBe('ah0');       // …on TOP of the deck
    expect(types(r2)).not.toContain('useStadium');            // spent for this player, this turn
  });

  it('re-using it in the same turn is invalidAction, not a fault [CF-12]', () => {
    const b = academyBoard();
    const r = step(b, [use(), { actor: 'A', type: 'choose', target: 'ah0' }, use()]);
    expect(r.status).toBe('invalidAction');
    expect(r.index).toBe(2);
    expect(r.reasonCode).toBe('ONCE_PER_TURN_EXHAUSTED');
  });

  it('a purely PASSIVE Stadium never offers `useStadium` [Beach Court svi-167]', () => {
    const r = step(board(
      player({ active: inPlay('A-act', 'asc-004'), hand: cards('ah', [WATER]) }),
      player({ active: inPlay('B-act', 'ssp-087') }),
      BEACH_COURT,
    ), []);
    expect(types(r)).not.toContain('useStadium');
  });

  it('an activated Stadium whose effect can achieve NOTHING is not offered [CF-33 / #925]', () => {
    // Academy at Night with an EMPTY hand: nothing to put on top of the deck.
    const r = step(academyBoard([]), []);
    expect(types(r)).not.toContain('useStadium');
    // …and Levincia with no Basic [L] in the discard, same rule from the other card.
    const noLightning = board(
      player({ active: inPlay('A-act', 'asc-004'), discard: cards('ax', [WATER]) }),
      player({ active: inPlay('B-act', 'ssp-087') }),
      LEVINCIA,
    );
    expect(types(step(noLightning, []))).not.toContain('useStadium');
  });

  it('no Stadium in play → no offer', () => {
    const r = step(board(
      player({ active: inPlay('A-act', 'asc-004'), hand: cards('ah', [WATER]) }),
      player({ active: inPlay('B-act', 'ssp-087') }),
      null,
    ), []);
    expect(types(r)).not.toContain('useStadium');
  });

  it('use → replace → use again is legal in one turn — the cap is per CARD [#926]', () => {
    const b = board(
      player({
        active: inPlay('A-act', 'asc-004'),
        hand: cards('ah', [WATER, LEVINCIA]),
        discard: cards('ax', [LIGHTNING, LIGHTNING]),
        deck: cards('ad', [WATER, WATER]),
      }),
      player({ active: inPlay('B-act', 'ssp-087') }),
      ACADEMY,
    );
    const spend = [use(), { actor: 'A' as const, type: 'choose' as const, target: 'ah0' }];
    expect(types(step(b, spend))).not.toContain('useStadium');

    // Replacing the Stadium hands the acting player a FRESH use — of the new physical card.
    const replaced = [...spend, { actor: 'A' as const, type: 'playStadium' as const, card: 'ah1' }];
    const r1 = step(b, replaced);
    expect(r1.state.stadium?.printing).toBe(LEVINCIA);
    expect(types(r1)).toContain('useStadium');

    // …and it really drives the NEW card's effect (Levincia reaches into the discard).
    const r2 = step(b, [...replaced, use()]);
    expect(r2.status).toBe('awaitingAction');
    expect(types(r2)).toContain('choose');
  });

  it('declining Primordial Altar\'s look does NOT destroy the card [TA-160 sit-161]', () => {
    // Found by the fuzzer within minutes of `useStadium` landing (seeds 26 + 40, "card set changed"):
    // the card moves the deck's top card into a temp CardList before prompting, and its decline
    // branch was keyed on `false` — a value ConfirmCardsPrompt (`Prompt<true>`) never produces. So a
    // decline left the card in the orphan list and it left the game entirely. This is the guard the
    // whole CF-37 exercise paid for: the surface was unreachable, so the bug was unreachable too.
    const b = board(
      player({ active: inPlay('A-act', 'asc-004'), deck: cards('ad', [WATER, LIGHTNING, 'sve-005']) }),
      player({ active: inPlay('B-act', 'ssp-087') }),
      'sit-161',
    );
    const decline = step(b, [use(), { actor: 'A', type: 'confirm', value: false }]);
    expect(decline.state.players.A.deck.map(c => c.iid)).toEqual(['ad0', 'ad1', 'ad2']); // back on top
    expect(decline.state.players.A.discard.length).toBe(0);

    const accept = step(b, [use(), { actor: 'A', type: 'confirm', value: true }]);
    expect(accept.state.players.A.deck.map(c => c.iid)).toEqual(['ad1', 'ad2']);
    expect(accept.state.players.A.discard.map(c => c.iid)).toEqual(['ad0']);
  });

  it('the spent use round-trips through the projection [flags.stadiumUsedThisTurn]', () => {
    // Without the flag a mid-turn state cannot say "already used", so a re-import (every scenario
    // replay, every fuzz shrink) silently hands the player a SECOND use.
    const b = academyBoard();
    const spent = step(b, [use(), { actor: 'A', type: 'choose', target: 'ah0' }]);
    expect(spent.state.players.A.flags.stadiumUsedThisTurn).toBe(true);
    expect(spent.state.players.B.flags.stadiumUsedThisTurn).toBeUndefined(); // omitted when false

    // Feed the projection back in: the use must still be spent.
    expect(types(step(spent.state, []))).not.toContain('useStadium');
  });

  it('Mystery Garden is refused when the draw would be zero — cost judged FIRST [TA-161 meg-122, #2232]', () => {
    // "…may discard 1 Energy from their hand. If they do, draw until they have as many cards in hand
    // as they have Psychic Pokémon in play." Compendium #2232, this card: "Can I use Mystery Garden
    // if I won't be able to draw cards? — No, you can't just discard an Energy card for no draw."
    // The subtlety that makes this more than a null check: the discard is a COST, not the effect
    // (#1004), so achievability is judged against the hand the effect will see — one card smaller.
    // With 1 Psychic in play and the Energy as the only card in hand, the draw reads 0 before the
    // payment and 1 after it, so a pre-cost test would wrongly refuse a legal use. Found mirroring
    // rotomancer's own #2232 fix, which their side made after reading CF-37's condition (d).
    const PSY = 'ssp-087';   // Dedenne — a Psychic Basic
    const mk = (active: string, bench: string[], hand: string[]) => board(
      player({
        active: inPlay('A-act', active),
        bench: bench.map((p, i) => inPlay(`A-b${i}`, p)),
        hand: cards('ah', hand),
        deck: Array.from({ length: 6 }, (_, i) => ({ iid: `ad${i}`, printing: WATER })),
      }),
      player({ active: inPlay('B-act', 'ssp-087') }),
      'meg-122',
    );
    const offered = (st: NeutralState) => types(step(st, [])).includes('useStadium');

    expect(offered(mk('asc-004', [], ['sve-005']))).toBe(false);          // 0 Psychic → draws nothing
    expect(offered(mk(PSY, [], ['sve-005', 'asc-004', 'asc-004']))).toBe(false); // hand too big
    // Empty deck → nothing to draw. Built through `mk` and then emptied, because `board()`
    // back-fills a 1-card deck for any side that would otherwise have none.
    const emptyDeck = mk(PSY, [PSY], ['sve-005']);
    emptyDeck.players.A.deck = [];
    expect(offered(emptyDeck)).toBe(false);
    expect(offered(mk(PSY, [PSY], ['asc-004']))).toBe(false);             // no Energy to pay the cost

    // …and the two live boards stay live, including the post-cost one.
    expect(offered(mk(PSY, [], ['sve-005']))).toBe(true);
    expect(offered(mk(PSY, [PSY], ['sve-005']))).toBe(true);

    // Driving the post-cost board really does draw: 1 Psychic, hand emptied by the cost → draw 1.
    const r = step(mk(PSY, [], ['sve-005']), [
      { actor: 'A', type: 'useStadium' },
      { actor: 'A', type: 'discard', owner: 'A', target: 'ah0' },
    ]);
    expect(r.state.players.A.discard.map(c => c.printing)).toEqual(['sve-005']);
    expect(r.state.players.A.hand.length).toBe(1);
    expect(r.state.players.A.deck.length).toBe(5);
  });

  it('the NON-owner gets their own use on their own turn ("each player\'s turn")', () => {
    const b = board(
      player({ active: inPlay('A-act', 'asc-004'), hand: cards('ah', [WATER, 'asc-004']), deck: cards('ad', [WATER, WATER]) }),
      player({ active: inPlay('B-act', 'ssp-087'), hand: cards('bh', [WATER]), deck: cards('bd', [WATER, WATER]) }),
      ACADEMY,
    );
    // A spends their use, then ends the turn — B's use is untouched (the Stadium is A's card).
    const r = step(b, [use(), { actor: 'A', type: 'choose', target: 'ah0' }, { actor: 'A', type: 'endTurn' }]);
    expect(r.pending?.actor).toBe('B');
    expect(types(r)).toContain('useStadium');
    expect(stadiumOffers(r)[0]).toEqual({ actor: 'B', type: 'useStadium' } as never);
  });

});
