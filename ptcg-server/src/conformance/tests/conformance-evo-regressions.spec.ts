import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// Behavioural regression guards for card bugs found via the evolution-coverage differential
// (results/fuzz-985-evo) and fixed in TA-60..TA-65. Unlike the fix-signature manifest (which only
// checks a fixed code line is still PRESENT), each `it` here reproduces the exact board and asserts the
// corrected BEHAVIOUR — so a future refactor that keeps the line but breaks the effect fails loudly too.
//
//   TA-60  Minccino tef-136           — "Beat" (index 0) was hidden; menu must offer both attacks
//   TA-61  Larry's Staraptor asc-170  — "Feathery Strike" 150 placed BEFORE the discard prompt
//   TA-62  Gholdengo ssp-131          — "Surf Back" 100 placed BEFORE the optional-shuffle confirm
//   TA-63  Aggron twm-122             — "Angry Slam" offered with no Bench (whiff, not a reject)
//   TA-64  Haunter pfl-055            — attack is "Spooky Shot" (was mis-named "Hollow Shot")
//   TA-65  Revavroom ex sfa-015       — "Shattering Speed" self-DISCARD gives the opponent NO prize

const WATER = 'sve-003';
const DARK = 'sve-007';
const METAL = 'sve-008';
const RALTS = 'Ralts SIT';                       // 70 HP neutral defender (KO'd by big hits)
const TANKY = 'Wellspring Mask Ogerpon ex TWM';  // twm-064, 210 HP — survives 150/100 so the attack pauses

function markers(played = 1): PokemonMarkers {
  return { playedOnTurn: played, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(over: Partial<PlayerFlags> = {}): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0,
    vstarUsed: false, ...over,
  };
}
/** Energy list of `n` copies of one printing, with unique iids. */
function en(printing: string, n: number, tag: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}e${i}`, printing }));
}
/** A Pokémon in play whose stack is the given basic→top printings (single-element for a Basic). */
function inPlay(iid: string, printings: string[], energy: CardRef[] = [], played = 1, conditions: ConditionToken[] = []): PokemonInPlay {
  return {
    // TA-291: the friendly iid names the BOTTOM (basic) card — the wire's identifier for a Pokemon
    // in play. It used to be stamped on the TOP card, so these evolved-stack cells submitted a
    // `source` no menu ever offered.
    stack: printings.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}-s${i}`, printing })),
    energy, tools: [], damage: 0, conditions, markers: markers(played),
  };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState, turn = 3): NeutralState {
  const withDefaults = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}-pz${i}`, printing: WATER, faceUp: false })),
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withDefaults(A, 'A'), B: withDefaults(B, 'B') },
  };
}
const attacksOffered = (res: ReturnType<typeof step>): string[] =>
  (res.pending?.legalActions ?? []).filter(a => a.type === 'declareAttack').map(a => (a as { name: string }).name).sort();

describe('Conformance — evolution-coverage fix regression guards', () => {

  it('Minccino offers BOTH "Beat" and "Cleaning Up" even with no Tools in play [TA-60 tef-136]', () => {
    // Pre-fix the Cleaning Up handler was bound to index 0 (Beat) and threw when the opponent had no
    // Tools, so the menu dropped Beat and offered only Cleaning Up.
    const res = step(
      board(player({ active: inPlay('A-act', ['tef-136'], en(WATER, 2, 'a')) }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [],
    );
    expect(res.status).toBe('awaitingAction');
    expect(attacksOffered(res)).toEqual(['Beat', 'Cleaning Up']);
  });

  // B.82 (owner 2026-10-05, #1834 / #2002) reverses TA-61's order: the discard choice comes first, then the 150 (and the
  // Bench 50) with the chosen Energy attached, then the discard.
  it('Larry\'s Staraptor "Feathery Strike" asks its discard choice BEFORE the 150 (B.82, reverses TA-61) [TA-609 asc-170]', () => {
    const res = step(
      board(player({ active: inPlay('A-act', ['asc-169', 'asc-170'], en(WATER, 3, 'a')) }),
            player({ active: inPlay('B-act', [TANKY]) })),   // 210 HP survives 150 → attack pauses on the discard
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Feathery Strike' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.B.active!.damage).toBe(0);
  });

  it('Gholdengo "Surf Back" asks its optional shuffle before the 100 (Step D) and places the 100 before the shuffle [TA-670 ssp-131, supersedes TA-62]', () => {
    // TA-670 / B.101 (4): the "you may" is a Step-D choice; TA-62's "the 100 before the shuffle" still holds for the move.
    const b = () => board(player({ active: inPlay('A-act', ['meg-067', 'ssp-131'], en(WATER, 3, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]) }));
    const res = step(b(), [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Surf Back' }]);
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.B.active!.damage).toBe(0);
    const yes = step(b(), [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Surf Back' },
      { actor: 'A', type: 'confirm', value: true }]);
    expect(yes.state.players.B.active!.damage).toBe(100);
  });

  it('Aggron offers "Angry Slam" with no Bench (a legal 0-damage whiff) [TA-63 twm-122]', () => {
    // Pre-fix a spurious !hasBenched throw hid Angry Slam whenever the Bench was empty.
    const res = step(
      board(player({ active: inPlay('A-act', ['twm-120', 'twm-121', 'twm-122'], en(METAL, 1, 'a')) }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [],
    );
    expect(res.status).toBe('awaitingAction');
    expect(attacksOffered(res)).toContain('Angry Slam');
  });

  it('Haunter\'s attack is "Spooky Shot", not "Hollow Shot" [TA-64 pfl-055]', () => {
    const res = step(
      board(player({ active: inPlay('A-act', ['por-048', 'pfl-055'], en(DARK, 1, 'a')) }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [],
    );
    expect(res.status).toBe('awaitingAction');
    expect(attacksOffered(res)).toEqual(['Spooky Shot']);
  });

  it('Revavroom ex "Shattering Speed" is a self-discard — the opponent takes NO prize [TA-65 sfa-015]', () => {
    // Pre-fix it self-KO'd (KnockOutEffect), wrongly awarding the OPPONENT a prize and duplicating the
    // discarded cards. Now: our own Pokémon is discarded (no prize to the opponent), the KO'd defender
    // yields us a prize, and no card is duplicated in the discard.
    const res = step(
      board(player({ active: inPlay('A-act', ['sfa-043', 'sfa-015'], en(METAL, 3, 'a')),
                     bench: [inPlay('A-bench', [RALTS])] }),   // a Bench Pokémon to promote into the emptied Active
            player({ active: inPlay('B-act', [RALTS]) })),     // 70 HP → KO'd by 250, we take a prize
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Shattering Speed' }],
    );
    // Opponent (B) never takes a prize for our self-discard.
    expect(res.state.players.B.prizes.length).toBe(6);
    // Card conservation: no duplicated card iids in our discard (the pre-fix double-discard bug).
    const discardIids = res.state.players.A.discard.map(c => c.iid);
    expect(discardIids.length).toBe(new Set(discardIids).size);
    // Revavroom itself is no longer our Active (it was discarded).
    expect(res.state.players.A.active?.stack.some(c => c.printing === 'sfa-015')).not.toBe(true);
  });
});
