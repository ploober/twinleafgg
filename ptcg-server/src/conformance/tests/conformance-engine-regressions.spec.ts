import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// Behavioural regression guards for twinleaf ENGINE fixes (src/game) — the all-time backfill
// (2026-07-07). These are rules, not single cards; each reproduces the exact board with the in-process
// `step()` driver and asserts the corrected engine behaviour.
//
//   TA-15  shuffle-prompt.ts     — a shuffle order over a >10-card deck is accepted (numeric compare)
//   TA-17  player-turn-reducer   — declaring retreat does NOT cure conditions while the cost prompt is open
//   TA-18  retreat-effect.ts     — paying a retreat cost surfaces the player's discard CHOICE (no auto-pay)
//   TA-36  miraidon.ts (Future)  — "Peak Acceleration" deals damage first, then attaches to FUTURE only

const GRASS = 'sve-001', WATER = 'sve-003', DARK = 'sve-007', METAL = 'sve-008';
const RALTS = 'Ralts SIT';
const TANKY = 'Wellspring Mask Ogerpon ex TWM';
const IRONMOTH = 'sfa-009';   // retreat [C,C]

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function inPlay(iid: string, printings: string[], energy: CardRef[] = [], damage = 0, conditions: ConditionToken[] = []): PokemonInPlay {
  return { stack: printings.map((p, i) => ({ iid: i === printings.length - 1 ? iid : `${iid}-s${i}`, printing: p })), energy, tools: [], damage, conditions, markers: markers() };
}
function deckN(tag: string, n: number): CardRef[] { return Array.from({ length: n }, (_, i) => ({ iid: `${tag}-dk${i}`, printing: WATER })); }
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const wd = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}-pz${i}`, printing: WATER, faceUp: false })),
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A: wd(A, 'A'), B: wd(B, 'B') } };
}
const legal = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []);
const types = (r: ReturnType<typeof step>): string[] => legal(r).map(a => (a as { type: string }).type);
const targetsOf = (r: ReturnType<typeof step>, t: string): string[] =>
  legal(r).filter(a => (a as { type: string }).type === t).map(a => (a as { target: string }).target);
const MIXED = [{ iid: 'g0', printing: GRASS }, { iid: 'w0', printing: WATER }, { iid: 'w1', printing: WATER }];

describe('Conformance — engine fix regression guards (all-time backfill)', () => {

  it('paying a retreat cost surfaces the player\'s discard CHOICE, not an auto-pay [TA-18]', () => {
    // Iron Moth (retreat [C,C]) with 3 mixed Energy — the "which 2 to discard" is a real, observable
    // decision. Pre-fix the exact/identical shortcut auto-discarded and completed the retreat in one step.
    const r = step(
      board(player({ active: inPlay('A-act', [IRONMOTH], MIXED), bench: [inPlay('A-b', [RALTS])] }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [{ actor: 'A', type: 'retreat', to: 0 }],
    );
    expect(r.status).toBe('awaitingAction');
    const discards = targetsOf(r, 'discard');
    expect(discards).toContain('g0');
    expect(discards).toContain('w0');   // both printings offered → a genuine choice
  });

  it('declaring retreat does NOT cure a Special Condition while the cost prompt is open [TA-17]', () => {
    // Same board, but the active is Poisoned. At the mid-retreat cost pause the poison must still be
    // present — pre-fix the reducer's unconditional clearEffects() cured it (retreat, cancel → cured).
    const r = step(
      board(player({ active: inPlay('A-act', [IRONMOTH], MIXED, 0, ['poisoned']), bench: [inPlay('A-b', [RALTS])] }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [{ actor: 'A', type: 'retreat', to: 0 }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).toContain('discard');
    expect(r.state.players.A.active!.conditions).toContain('poisoned');
  });

  it('a shuffle order over a >10-card deck is accepted (numeric, not lexicographic, validation) [TA-15]', () => {
    // Mareep "Procurement" over a 15-card deck (no Item) → a mandatory `system` shuffle. Pre-fix the
    // permutation validator sorted indices lexicographically, so any order touching index ≥ 10 (i.e.
    // every shuffle of an 11+ card deck) was rejected. A valid 15-permutation must now be accepted.
    const start = board(player({ active: inPlay('A-act', ['dri-072'], [{ iid: 'w0', printing: WATER }]), deck: deckN('A', 15) }),
                        player({ active: inPlay('B-act', [RALTS]) }));
    const attackOnly = step(start, [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Procurement' }]);
    const shuffle = legal(attackOnly).find(a => (a as { type: string }).type === 'shuffle') as { deck: string[] } | undefined;
    expect(shuffle).toBeDefined();
    expect(shuffle!.deck.length).toBe(15);        // the >10 path is exercised
    const order = [...shuffle!.deck].reverse();    // a valid permutation touching indices ≥ 10
    const r = step(start, [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Procurement' },
      { actor: 'system', type: 'shuffle', order },
    ]);
    expect(r.status).toBe('awaitingAction');       // accepted (turn advances), not invalidAction
    expect(r.pending!.actor).toBe('B');
  });

  it('a direct effect-KO (Yveltal ex "Soul Destroyer") awards the attacker a prize [TA-37 por-053]', () => {
    // "Knock Out each of your opponent's Pokémon that has 50 HP or less remaining" fires a direct
    // KnockOutEffect (not damage). Pre-fix the checkState sweep never saw the already-discarded
    // Pokémon, so NO prize was awarded — the vacated Active only got a promote prompt. Now the
    // effect-KO accumulates the prize (state.pendingDirectKoPrizes), surfacing a takePrize.
    const r = step(
      board(player({ active: inPlay('A-act', ['por-053'], [
        { iid: 'd0', printing: DARK }, { iid: 'd1', printing: DARK }, { iid: 'm0', printing: METAL }]) }),
            player({ active: inPlay('B-act', [RALTS], [], 30), bench: [inPlay('B-b', [RALTS])] })),   // 70-30 = 40 ≤ 50 → KO
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Soul Destroyer' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.B.active).toBeNull();      // the ≤50-remaining Active was KO'd
    expect(types(r)).toContain('takePrize');          // and the attacker is awarded a prize
  });

  it('Miraidon "Peak Acceleration" deals its 40 first, then attaches to FUTURE Pokémon only [TA-36]', () => {
    // Miraidon (Future) Active + a non-Future Ralts on the Bench; the deck holds Basic Energy. The
    // attach must be offered to the Future Miraidon only — pre-fix it offered every target then rejected
    // the non-Future picks (offer-then-reject). And the 40 is placed before the deck-search pause (TA-31).
    const r = step(
      board(player({ active: inPlay('A-act', ['tef-121'], [{ iid: 'c0', printing: WATER }]),
                     bench: [inPlay('A-b', [RALTS])],
                     deck: [{ iid: 'be0', printing: GRASS }, { iid: 'be1', printing: WATER }, { iid: 'A-d2', printing: WATER }] }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Peak Acceleration' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.B.active!.damage).toBe(40);   // damage-before-prompt
    const attachTargets = targetsOf(r, 'attachEnergy');
    expect(attachTargets).toContain('A-act');            // Future Miraidon is a valid target
    expect(attachTargets).not.toContain('A-b');          // the non-Future bench is NOT offered
  });

  it('playing a Supporter sets supporterPlayedThisTurn in the projection [adapter counter projection]', () => {
    // twinleaf's engine tracks `player.supporterTurn` as a per-turn COUNTER (reset to 0 each turn,
    // += 1 on a Supporter play; the one-Supporter rule gates on `=== 0`). The adapter projected the
    // flag as `supporterTurn === turn` — comparing the counter (1) to the turn number (3) — so it
    // read `false` after a fresh play. Surfaced by the cross-engine Carmine seed (rotomancer=true,
    // twinleaf=false). Fixed to `supporterTurn > 0`.
    const r = step(
      board(player({
        active: inPlay('A-act', [RALTS]),
        hand: [{ iid: 'cm', printing: 'twm-145' }, { iid: 'h2', printing: WATER }, { iid: 'h3', printing: WATER }],
        deck: Array.from({ length: 8 }, (_, i) => ({ iid: `ad${i}`, printing: WATER })),
      }), player({ active: inPlay('B-act', [TANKY]) })),
      [{ actor: 'A', type: 'playSupporter', card: 'cm' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.flags.supporterPlayedThisTurn).toBe(true);
  });
});
