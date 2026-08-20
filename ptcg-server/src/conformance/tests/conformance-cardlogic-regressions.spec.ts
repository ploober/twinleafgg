import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// Behavioural regression guards for twinleaf `src/sets` card-logic fixes that had ONLY a
// fix-signature entry (or none) before this pass — the ALL-TIME backfill (2026-07-07). Each `it`
// reproduces the exact board with the in-process `step()` driver and asserts the corrected BEHAVIOUR,
// so a refactor (or silent merge-revert) that keeps/loses the signature line but breaks the effect
// fails loudly. Building this backfill caught two live reverts the signature guard missed:
//   • TA-22 Kyogre "Riptide" dealt 20 on an empty discard (should be 0) — re-fixed with this repro.
//   • TA-52 Terapagos "Prism Charge" still THREW on the no-Tera whiff — re-applied with this repro.
//
//   TA-22  Kyogre meg-034            — "Riptide" (20×[W] in discard) deals 0 with an empty discard
//   TA-23  Paldean Tauros pfl-048    — "Raging Charge" = 40 × your DAMAGED "Tauros" (not ×counters)
//   TA-30  Walking Wake twm-063      — "Undulating Slice" places counters on the ACTIVE only, not Bench
//   TA-49  Dunsparce tef-128         — "Dig" (index 1) flips a coin; "Gnaw" (index 0) does not
//   TA-52  Terapagos ssp-161         — "Prism Charge" is a legal whiff with no Tera Pokémon (offered)
//   TA-53  Team Rocket's Mareep dri-072 — "Procurement" shuffles the deck even on a zero-take
//   TA-56  Iron Moth sfa-009         — "Suction" heals ITSELF (not the opponent); no crash on a KO
//   TA-56  Dwebble dri-011           — "Ascension" with no evolution in deck whiffs to a shuffle (min 0)
//   TA-58  N's Klang jtg-104         — "Spinning Gears" (index 0) Confuses; "Confront" (index 1) does not
//   TA-59  Ceruledge ex ssp-036      — "Raging Amethyst" discards ALL its Energy (once — no duplication)
//   TA-66  Cinderace meg-028         — "Turbo Flare" places its base damage BEFORE the attach effect pauses
//   TA-67  Decidueye sfa-005         — "Power Shot" FORCES the Grass discard when able (no decline); whiffs with none
//   TA-113 Rotom ex pfl-029          — "Thunderbolt" discards all Energy; no 500 when its own KO runs checkState

const WATER = 'sve-003', FIRE = 'sve-002', PSY = 'sve-005', METAL = 'sve-008', FIGHT = 'sve-006', GRASS = 'sve-009';
const RALTS = 'Ralts SIT';                       // 70 HP neutral defender
const TANKY = 'Wellspring Mask Ogerpon ex TWM';  // twm-064, 210 HP — survives ≤200 so a hit pauses

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
/** `n` copies of one Energy printing, unique iids. */
function en(printing: string, n: number, tag: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}e${i}`, printing }));
}
/** A Pokémon-in-play from basic→top printings (single-element for a Basic); optional pre-set damage. */
function inPlay(iid: string, printings: string[], energy: CardRef[] = [], damage = 0, conditions: ConditionToken[] = []): PokemonInPlay {
  return {
    // TA-291: the friendly iid names the BOTTOM (basic) card, because that is what identifies a
    // Pokemon in play on the wire — `legal-actions.ts` emits `getPokemons()[0]` and the dispatcher
    // now enforces it. This helper used to stamp it on the TOP card, so every evolved-stack cell
    // below submitted a `source` no menu had ever offered and only passed because the dispatcher
    // resolved any stack member to its containing slot.
    stack: printings.map((p, i) => ({ iid: i === 0 ? iid : `${iid}-s${i}`, printing: p })),
    energy, tools: [], damage, conditions, markers: markers(),
  };
}
function fillerDeck(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}-dk${i}`, printing: WATER }));
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
/** Like `board()` but leaves an EMPTY deck empty.
 *
 * `board()` backfills `deck: []` with one filler card, so it cannot express an empty deck at all —
 * the G-8 blind spot (0 of 9,058 corpus sides ever starts with an empty deck) reproduced inside the
 * test helper. A cell written with `board(...)` and `deck: []` silently tests a ONE-card deck and
 * passes for the wrong reason. Use this whenever emptiness is the thing under test. */
function boardKeepingEmptyDeck(A: PlayerState, B: PlayerState): NeutralState {
  const pz = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}-pz${i}`, printing: WATER, faceUp: false })),
  });
  return { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A: pz(A, 'A'), B: pz(B, 'B') } };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const wd = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}-pz${i}`, printing: WATER, faceUp: false })),
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A: wd(A, 'A'), B: wd(B, 'B') } };
}
function attack(source: string, name: string) {
  return { actor: 'A' as const, type: 'declareAttack' as const, source, name };
}
const types = (r: ReturnType<typeof step>): string[] => (r.pending?.legalActions ?? []).map(a => (a as { type: string }).type);
const attacksOffered = (r: ReturnType<typeof step>): string[] =>
  (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'declareAttack').map(a => (a as { name: string }).name).sort();
const placeCounterTargets = (r: ReturnType<typeof step>): string[] =>
  (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'placeCounter').map(a => (a as { target: string }).target);

describe('Conformance — card-logic fix regression guards (all-time backfill)', () => {

  it('Kyogre "Riptide" deals 0 with an empty discard [TA-22 meg-034]', () => {
    // "20 damage for each [W] Energy card in your discard pile." Empty discard → 0. The pre-fix
    // early-return left the printed base 20 in effect, so an empty discard wrongly dealt 20.
    const r = step(
      board(player({ active: inPlay('A-act', ['meg-034'], en(WATER, 1, 'a')) }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [attack('A-act', 'Riptide')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.B.active!.damage).toBe(0);
  });

  it('Paldean Tauros "Raging Charge" = 40 × your DAMAGED "Tauros" [TA-23 pfl-048]', () => {
    // Active Tauros (damaged) + a benched Tauros (damaged) = 2 → 80. The benched non-Tauros (damaged)
    // does NOT count. Pre-fix multiplied by total damage COUNTERS, wildly inflating the damage.
    const r = step(
      board(player({
        active: inPlay('A-act', ['pfl-048'], en(FIGHT, 1, 'a'), 20),
        bench: [inPlay('A-b1', ['pfl-048'], [], 20), inPlay('A-b2', [RALTS], [], 20)],
      }), player({ active: inPlay('B-act', [TANKY]) })),
      [attack('A-act', 'Raging Charge')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.B.active!.damage).toBe(80);
  });

  it('Walking Wake "Undulating Slice" targets the ACTIVE only, never the Bench [TA-30 twm-063]', () => {
    const r = step(
      board(player({ active: inPlay('A-act', ['twm-063'], en(WATER, 3, 'a')), bench: [inPlay('A-bench', [RALTS])] }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [attack('A-act', 'Undulating Slice')],
    );
    expect(r.status).toBe('awaitingAction');
    const targets = placeCounterTargets(r);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toContain('A-act');
    expect(targets).not.toContain('A-bench');   // pre-fix the Bench was an eligible counter target
  });

  it('Dunsparce "Dig" (index 1) flips a coin; "Gnaw" (index 0) does not [TA-49 tef-128]', () => {
    const start = board(player({ active: inPlay('A-act', ['tef-128'], en(WATER, 2, 'a')) }),
                        player({ active: inPlay('B-act', [TANKY]) }));
    const dig = step(start, [attack('A-act', 'Dig')]);
    expect(types(dig)).toContain('flip');            // the prevent-damage coin flip surfaces
    const gnaw = step(start, [attack('A-act', 'Gnaw')]);
    expect(types(gnaw)).not.toContain('flip');       // pre-fix Gnaw wrongly flipped and Dig did nothing
  });

  it('Terapagos "Prism Charge" is a legal whiff with no Tera Pokémon (offered, not rejected) [TA-52 ssp-161]', () => {
    // Terapagos itself is a Basic (not Tera); with no Tera Pokémon in play the attach fails but the
    // attack is still legal (compendium #361). Pre-fix it THREW CANNOT_USE_ATTACK, so twinleaf's menu
    // dropped it and declaring it returned invalidAction.
    const start = board(player({ active: inPlay('A-act', ['ssp-161'], en(WATER, 1, 'a')) }),
                        player({ active: inPlay('B-act', [RALTS]) }));
    expect(attacksOffered(step(start, []))).toContain('Prism Charge');
    const r = step(start, [attack('A-act', 'Prism Charge')]);
    expect(r.status).toBe('awaitingAction');         // accepted (whiff), not invalidAction
  });

  it('Team Rocket\'s Mareep "Procurement" shuffles the deck even on a zero-take [TA-53 dri-072]', () => {
    // "Search your deck for an Item card … Then, shuffle your deck." (compendium #2171). With no Item
    // in the deck the search takes nothing, but the shuffle is still mandatory — pre-fix it was skipped
    // on a zero-take, leaking the (public-searched) deck order.
    const r = step(
      board(player({ active: inPlay('A-act', ['dri-072'], en(WATER, 1, 'a')), deck: fillerDeck('A', 4) }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [attack('A-act', 'Procurement')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
  });

  it('Iron Moth "Suction" heals ITSELF for the damage it did [TA-56 sfa-009]', () => {
    // "Heal from THIS Pokémon the same amount of damage you did." Iron Moth at 50 damage, deals 30 →
    // heals 30 → 20. Pre-fix it healed the OPPONENT (effect.target), leaving Iron Moth at 50.
    const r = step(
      board(player({ active: inPlay('A-act', ['sfa-009'], en(WATER, 2, 'a'), 50) }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [attack('A-act', 'Suction')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.active!.damage).toBe(20);
  });

  it('Iron Moth "Suction" does not crash when it scores a KO [TA-56 sfa-009]', () => {
    // Pre-fix, healing effect.target crashed (`Cannot read 'player'`) whenever the 30 KO'd the
    // opponent's Active (target became undefined). Now it reaches the prize step cleanly.
    const r = step(
      board(player({ active: inPlay('A-act', ['sfa-009'], en(WATER, 2, 'a')) }),
            player({ active: inPlay('B-act', [RALTS], [], 40) })),   // 40 + 30 = 70 = KO
      [attack('A-act', 'Suction')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).toContain('takePrize');
  });

  it('Dwebble "Ascension" with no evolution in the deck whiffs to a shuffle (min 0) [TA-56 dri-011]', () => {
    // "Search your deck for a card that evolves from this Pokémon …" — a deck search may find nothing.
    // Pre-fix the min:1 prompt with zero eligible cards crashed the decomposer (500); min:0 whiffs to
    // the mandatory shuffle instead.
    const r = step(
      board(player({ active: inPlay('A-act', ['dri-011'], en(WATER, 1, 'a')), deck: fillerDeck('A', 4) }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [attack('A-act', 'Ascension')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
  });

  it('N\'s Klang "Spinning Gears" (index 0) Confuses; "Confront" (index 1) does not [TA-58 jtg-104]', () => {
    const start = board(player({ active: inPlay('A-act', ['jtg-103', 'jtg-104'], en(METAL, 2, 'a')) }),
                        player({ active: inPlay('B-act', [TANKY]) }));
    const spin = step(start, [attack('A-act', 'Spinning Gears')]);
    expect(spin.status).toBe('awaitingAction');
    expect(spin.state.players.B.active!.conditions).toContain('confused');
    const confront = step(start, [attack('A-act', 'Confront')]);
    expect(confront.state.players.B.active!.conditions).not.toContain('confused');
  });

  it('Team Rocket\'s Moltres ex "Flame Screen" reduces the NEXT incoming attack by 50 [TA-25 dri-031]', () => {
    // "During your opponent's next turn, this Pokémon takes 50 less damage from attacks." A uses Flame
    // Screen (marks Moltres); on B's turn Terapagos "Hard Tackle" (100) hits Moltres for 100 − 50 = 50.
    // Pre-fix the markers were set but there was no damage-reduction handler — the −50 did nothing.
    const r = step(
      board(player({ active: inPlay('A-act', ['dri-031'], [
        { iid: 'm0', printing: FIRE }, { iid: 'm1', printing: METAL }, { iid: 'm2', printing: WATER }]) }),
            player({ active: inPlay('B-act', ['ssp-161'], en(WATER, 3, 'b')) })),
      [attack('A-act', 'Flame Screen'),
       { actor: 'B', type: 'declareAttack', source: 'B-act', name: 'Hard Tackle' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.active!.damage).toBe(50);   // 100 Hard Tackle − 50 Flame Screen
  });

  it('Ceruledge ex "Raging Amethyst" discards ALL its Energy exactly once [TA-59 ssp-036]', () => {
    // "Discard all Energy from this Pokémon." Pre-fix a manual push+reassign added the Energy to the
    // discard but left it attached (stale derived energy) — attached AND duplicated in discard.
    const r = step(
      board(player({ active: inPlay('A-act', ['ssp-032', 'ssp-036'], [
        { iid: 'ce0', printing: FIRE }, { iid: 'ce1', printing: PSY }, { iid: 'ce2', printing: METAL },
      ]) }), player({ active: inPlay('B-act', [RALTS]) })),
      [attack('A-act', 'Raging Amethyst')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.active!.energy.length).toBe(0);        // removed from the Pokémon
    const discardIids = r.state.players.A.discard.map(c => c.iid);
    expect(discardIids.length).toBe(new Set(discardIids).size);     // and not duplicated
    expect(discardIids).toContain('ce0');
  });

  it('Cinderace "Turbo Flare" places its base damage before the attach effect pauses [TA-66 meg-028]', () => {
    // "50 damage. Search your deck for up to 3 Basic Energy and attach them to your Benched Pokémon …
    // Then, shuffle your deck." Rulebook attack step F: the 50 lands in the damage step, BEFORE the
    // search/attach pause. Pre-fix twinleaf deferred its base damage to the END of the attack, so the
    // defender still read 0 at the attach pending (rotomancer, correctly, showed the damage placed).
    const r = step(
      board(player({
        active: inPlay('A-act', ['meg-028'], en(FIRE, 1, 'a')),
        bench: [inPlay('A-bench', [RALTS])],            // an attach target so the effect actually pauses
        deck: fillerDeck('A', 4),                       // Basic Energy to search → the attach prompt appears
      }), player({ active: inPlay('B-act', [TANKY]) })),
      [attack('A-act', 'Turbo Flare')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).toContain('attachEnergy');         // paused inside the search/attach effect
    expect(r.state.players.B.active!.damage).toBeGreaterThan(0);   // damage already placed (step F first)
  });

  it('Decidueye "Power Shot" forces the Grass discard when able — no decline [TA-67 sfa-005]', () => {
    // "170. Discard a Basic [G] Energy from your hand. If you can't, this attack does nothing." The discard
    // is MANDATORY when able — pre-fix a min:0 ChooseCards let you DECLINE (offered a `confirm` stop) and
    // whiff to 0. Now it is min:1 (forced): no decline. With exactly one Grass in hand the discard is a
    // CF-8 forced-atomic single-card discard, so the adapter AUTO-RESOLVES it (no `discard` pending —
    // choose-cards.ts; this closes the former CF-14 granularity follow-up and now matches rotomancer): the
    // Grass leaves the hand, the 170 lands and KOs the 70-HP defender → straight to `takePrize`.
    const start = board(player({
      active: inPlay('A-act', ['sfa-005'], en(GRASS, 1, 'a')),   // attached [G] pays the cost
      hand: [{ iid: 'ah-grass', printing: GRASS }],              // the one Grass to discard (forced)
    }), player({ active: inPlay('B-act', [RALTS]) }));           // 70 HP → 170 KOs
    const r = step(start, [attack('A-act', 'Power Shot')]);
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).not.toContain('confirm');          // no "decline the discard" option (the pre-fix bug)
    expect(types(r)).not.toContain('discard');          // forced single discard auto-resolves — no pending
    expect(types(r)).toContain('takePrize');            // Grass discarded → 170 → KO → prize
    expect(r.state.players.A.hand.length).toBe(0);      // the Grass was actually discarded (not declined)
  });

  it('Decidueye "Power Shot" does nothing with no Basic [G] Energy in hand [TA-67 sfa-005]', () => {
    // The "if you can't" branch: no Grass in hand → the attack whiffs to 0 (no discard, defender unharmed).
    const r = step(
      board(player({
        active: inPlay('A-act', ['sfa-005'], en(GRASS, 1, 'a')),
        hand: [{ iid: 'ah-fire', printing: FIRE }],                // no Basic Grass to discard
      }), player({ active: inPlay('B-act', [RALTS]) })),
      [attack('A-act', 'Power Shot')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.B.active!.damage).toBe(0);
  });

  it('Zeraora "Shocking Knuckle" places its 20 BEFORE the paralyze coin flip [TA-69 tef-057]', () => {
    // "20 damage. Flip a coin; if heads Paralyze." The flip externalizes as a system pending; the 20 is a
    // post-damage-independent base hit that must already be on the defender at the flip pause (rulebook
    // step F / compendium #543/#649). Pre-fix twinleaf deferred the 20 (defender read 0 at the flip). Same
    // class as TA-31 Iron Hands "Volt Wave". Defender RALTS is not Lightning-weak, so damage is exactly 20.
    const r = step(
      board(player({ active: inPlay('A-act', ['tef-057'], en(WATER, 1, 'a')) }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [attack('A-act', 'Shocking Knuckle')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).toContain('flip');                  // paused at the paralyze flip
    expect(r.state.players.B.active!.damage).toBe(20);   // the 20 is already placed (damage-first)
  });

  it('Zeraora "Strong Volt" places its 120 BEFORE the energy-discard choice [TA-69 tef-057]', () => {
    // "120. Discard an Energy from this Pokémon." With 3 energy attached the discard is a which-choice
    // and pauses; the 120 must already be on the defender (rulebook step F). Pre-fix twinleaf showed 0
    // at the discard pause (surfaced by the per-card re-fuzz after the Shocking Knuckle fix).
    const r = step(
      board(player({ active: inPlay('A-act', ['tef-057'],
        [{ iid: 'e0', printing: 'sve-004' }, { iid: 'e1', printing: 'sve-004' }, { iid: 'e2', printing: WATER }]) }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [attack('A-act', 'Strong Volt')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).toContain('discard');               // paused at the which-energy discard
    expect(r.state.players.B.active!.damage).toBe(120);  // the 120 is already placed (damage-first)
  });

  it('Larry\'s Dunsparce "Rising Lunge" externalizes its coin flip, not a 500 [TA-68 asc-163]', () => {
    // "Flip a coin. If heads, +20." Pre-fix the flip fired in AFTER_ATTACK — which (a) faults the
    // conformance adapter ("coin flip needed but the next action is not a flip") and (b) is too late:
    // effect.damage += 20 after the damage step does nothing. WAS_ATTACK_USED externalizes the flip as
    // a system pending BEFORE the damage step, so the +20 lands. (Same class + fix as TA-56 Marill "Hide".)
    const r = step(
      board(player({ active: inPlay('A-act', ['asc-163'], en(WATER, 1, 'a')) }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [attack('A-act', 'Rising Lunge')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).toContain('flip');                  // externalized system flip, not a fault
  });

  it('Bulbasaur "Bind Down" gates the Defending Pokémon\'s retreat MENU, not just the dispatch [TA-71 meg-001]', () => {
    // "During your opponent's next turn, the Defending Pokémon can't retreat." BLOCK_RETREAT sets
    // cannotRetreatNextTurn, which the retreat dispatch (assertCanRetreat) enforces — but pre-fix the
    // legal-action MENU didn't, so twinleaf OFFERED B a retreat it then rejected (offer-then-reject vs
    // rotomancer). Gate covers all 179 BLOCK_RETREAT cards. Ralts SIT has retreat [C]; B has a bench + energy.
    const bBoard = (aActive: string) => board(
      player({ active: inPlay('A-act', [aActive], en(GRASS, 1, 'a')), bench: [inPlay('A-b', [RALTS])] }),
      player({ active: inPlay('B-act', [RALTS], en(WATER, 1, 'b')), bench: [inPlay('B-b', [RALTS])] }),
    );
    // Baseline: A ends its turn WITHOUT locking → B (Ralts + bench + energy) CAN retreat.
    const base = step(bBoard(RALTS), [{ actor: 'A', type: 'endTurn' }]);
    expect(base.state.activePlayer).toBe('B');
    expect(types(base)).toContain('retreat');
    // Locked: A uses Bind Down → B's retreat is gated out of the menu (was offered pre-fix).
    const locked = step(bBoard('meg-001'), [attack('A-act', 'Bind Down')]);
    expect(locked.state.activePlayer).toBe('B');
    expect(types(locked)).not.toContain('retreat');
  });

  it('Gholdengo "Surf Back" shuffles the active + attached Energy into the deck ONCE, no duplication [TA-72 ssp-131]', () => {
    // "You may shuffle this Pokémon and all attached cards into your deck." Attached Energy lives in both
    // PokemonCardList.cards and .energies (an index into cards), and moveTo moved BOTH — so every attached
    // Energy landed in the deck TWICE (card-conservation break, RA-5 class). Engine fix in
    // PokemonCardList.moveTo: carry the cards once, reconcile the energy index. 3 Energy → deck grows by
    // exactly 5 (Gimmighoul + Gholdengo + 3 Energy), each Energy iid present once.
    const start = board(
      player({ active: inPlay('A-act', ['ssp-097', 'ssp-131'], en(WATER, 3, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const r = step(start, [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Surf Back' },
      { actor: 'A', type: 'confirm', value: true },
    ]);
    expect(r.state.players.B.active!.damage).toBe(100);       // damage-first landed
    const iids = r.state.players.A.deck.map(c => c.iid);
    const energyIids = iids.filter(i => i.startsWith('ae'));
    expect(energyIids.sort()).toEqual(['ae0', 'ae1', 'ae2']);  // each once — pre-fix each appeared twice
    expect(iids.length).toBe(6);                               // A-d + Gimmighoul + Gholdengo + 3 Energy
  });

  it('Team Rocket\'s Pupitar "Explosive Ascension" whiffs (no crash) with no Tyranitar, and places its 30 first [TA-73 dri-095]', () => {
    // "Search your deck for a card that evolves from this Pokémon... Then, shuffle your deck." A deck
    // search with zero eligible cards MUST be a legal whiff (compendium #902/#903 voluntary-fail; #2302
    // still shuffle), not a 500 — pre-fix the min:1 ChooseCards crashed the decomposer. And the base 30
    // lands BEFORE the search pauses (rulebook step F). Active stack: TR Larvitar → TR Pupitar.
    const noTyr = board(
      player({ active: inPlay('A-act', ['dri-094', 'dri-095'], en(FIGHT, 1, 'a')),
               deck: [{ iid: 'A-dk0', printing: WATER }, { iid: 'A-dk1', printing: WATER }] }),
      player({ active: inPlay('B-act', [TANKY]) }));
    const whiff = step(noTyr, [attack('A-act', 'Explosive Ascension')]);
    expect(whiff.status).toBe('awaitingAction');               // not invalidAction/500
    expect(types(whiff)).toContain('shuffle');                 // resolves to the mandatory shuffle
    expect(whiff.state.players.B.active!.damage).toBe(30);     // damage-first (was 0 at the pause pre-fix)
    // With a valid Tyranitar in the deck the search IS offered (min:0 still lets it whiff via confirm).
    const withTyr = board(
      player({ active: inPlay('A-act', ['dri-094', 'dri-095'], en(FIGHT, 1, 'a')),
               deck: [{ iid: 'A-tyr', printing: 'dri-096' }, { iid: 'A-dk1', printing: WATER }] }),
      player({ active: inPlay('B-act', [TANKY]) }));
    expect(types(step(withTyr, [attack('A-act', 'Explosive Ascension')]))).toContain('choose');
  });

  it('Gothorita "Fortunate Eye" EXTERNALIZES the opponent-deck reorder as choose×N [TA-81 wht-042]', () => {
    // "Look at the top 5 cards of your opponent's deck and put them back in any order." The chosen order
    // is a MATERIAL, OBSERVABLE decision (the attacker controls B's next draws; the reordered pile is on
    // the full-info wire), so the adapter must EXTERNALIZE it as a `choose`-per-position sequence, NOT
    // auto-resolve to identity (§B.6 / RE-7; matches rotomancer's choose×N). TA-74's identity auto-
    // resolve was itself the bug. Active stack: Gothita → Gothorita.
    const Bdeck = Array.from({ length: 8 }, (_, i) => ({ iid: `B-dk${i}`, printing: WATER }));
    const gothBoard = () => board(
      player({ active: inPlay('A-act', ['wht-041', 'wht-042'], en(PSY, 1, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]), deck: Bdeck }));
    const choose = (target: string) => ({ actor: 'A' as const, type: 'choose' as const, target });

    // (a) With no reorder pick supplied, the attack PAUSES at A's reorder pending — the attacker (not B)
    //     decides, the turn has NOT advanced, and the 5 looked-at cards are the choose targets.
    const reorder = step(gothBoard(), [attack('A-act', 'Fortunate Eye')]);
    expect(reorder.status).toBe('awaitingAction');              // pre-fix: resolved+advanced to B
    expect(reorder.pending!.actor).toBe('A');                   // the reorderer, not the deck owner
    expect(reorder.state.activePlayer).toBe('A');               // turn did NOT advance (pre-fix: B drew)
    const chooseTargets = (reorder.pending!.legalActions as { type: string; target: string }[])
      .filter(a => a.type === 'choose').map(a => a.target).sort();
    expect(chooseTargets).toEqual(['B-dk0', 'B-dk1', 'B-dk2', 'B-dk3', 'B-dk4']); // top-5 peeked
    expect(types(reorder).every(t => t === 'choose')).toBe(true);
    // The homeless temp pile is re-projected onto the TOP of B's deck (fixupProjection), in original
    // order, so all 8 cards stay observable (card conservation) and match rotomancer's pre-resolve view.
    expect(reorder.state.players.B.deck.map(c => c.iid))
      .toEqual(['B-dk0', 'B-dk1', 'B-dk2', 'B-dk3', 'B-dk4', 'B-dk5', 'B-dk6', 'B-dk7']);

    // (b) Round-trip: supplying the full choose sequence resolves the reorder. The i-th pick lands at new
    //     deck position i (top-first); the attack then auto-ends A's turn and B draws the NEW top card.
    //     Pick order [dk2,dk4,dk0,dk3,dk1] ⇒ new top-5 = that order, then dk5..dk7; B draws dk2.
    const done = step(gothBoard(), [attack('A-act', 'Fortunate Eye'),
      choose('B-dk2'), choose('B-dk4'), choose('B-dk0'), choose('B-dk3'), choose('B-dk1')]);
    expect(done.status).not.toBe('invalidAction');
    expect(done.state.activePlayer).toBe('B');                  // turn advanced after the reorder resolved
    expect(done.state.players.B.hand.map(c => c.iid)).toContain('B-dk2'); // B drew the chosen top card
    expect(done.state.players.B.deck.map(c => c.iid))
      .toEqual(['B-dk4', 'B-dk0', 'B-dk3', 'B-dk1', 'B-dk5', 'B-dk6', 'B-dk7']);
    const conserved = [...done.state.players.B.deck, ...done.state.players.B.hand]
      .map(c => c.iid).filter(i => i.startsWith('B-dk')).sort();
    expect(conserved).toEqual(['B-dk0', 'B-dk1', 'B-dk2', 'B-dk3', 'B-dk4', 'B-dk5', 'B-dk6', 'B-dk7']);

    // Empty opponent deck → legal whiff (offered AND accepted), NOT a CANNOT_USE_ATTACK offer-then-reject.
    const emptyStart = board(player({ active: inPlay('A-act', ['wht-041', 'wht-042'], en(PSY, 1, 'a')) }),
                             player({ active: inPlay('B-act', [TANKY]) }));
    emptyStart.players.B.deck = [];
    const empty = step(emptyStart, [attack('A-act', 'Fortunate Eye')]);
    expect(empty.status).not.toBe('invalidAction');             // no reorder prompt (nothing to look at)
  });

  it('Lapras ex "Larimar Rain" keeps the looked-at deck cards observable at the attach pause [TA-75 scr-032]', () => {
    // "Look at the top 20 cards of your deck and attach any number of Energy… Shuffle the rest back." The
    // card pulls the top 20 into a card-local temp CardList that it hands to the AttachEnergyPrompt. That
    // temp is not a projected zone, so pre-fix the 20 vanished from the wire at the attach pause — a
    // card-conservation hole (RA-5). The attach-energy decomposer's fixupProjection now projects any
    // source card missing from every zone back into the owner's deck (mirroring native rotomancer).
    const Adeck = Array.from({ length: 22 }, (_, i) => ({ iid: `A-dk${i}`, printing: WATER }));
    const cost = [{ iid: 'a-w', printing: WATER }, { iid: 'a-p', printing: PSY }, { iid: 'a-m', printing: METAL }];
    const r = step(
      board(player({ active: inPlay('A-act', ['scr-032'], cost), deck: Adeck }),
            player({ active: inPlay('B-act', [TANKY]) })),
      [attack('A-act', 'Larimar Rain')]);
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).toContain('attachEnergy');                 // paused at the attach decision
    const ap = r.state.players.A;
    const visible = [...ap.deck, ...ap.hand, ...ap.discard].map(c => c.iid).filter(i => i.startsWith('A-dk'));
    expect(visible.length).toBe(22);                            // pre-fix: only 2 (20 lost in temp)
  });

  it('Revavroom ex "Shattering Speed" ends in a TIE when both boards empty simultaneously [TA-76 sfa-015]', () => {
    // "Discard this Pokémon and all attached cards." 250 dmg KOs the last defender while the self-discard
    // clears the last attacker → both players Pokémon-less at the same checkup. Base rulebook = TIE, and
    // native rotomancer ends gameOver/tie. Pre-fix twinleaf auto-triggered SUDDEN DEATH (a full re-setup:
    // decks/prizes reset, re-shuffle) which the differential reads as `ongoing` with both boards empty.
    // Active stacks: Varoom → Revavroom ex vs a lone Ralts (70 HP); neither has a Bench.
    const start = board(
      player({ active: inPlay('A-act', ['sfa-043', 'sfa-015'], en(METAL, 3, 'a')) }),
      player({ active: inPlay('B-act', [RALTS]) }));
    // The attack pauses at A's prize selection (A KO'd B → takes a prize), which is correct.
    const paused = step(start, [attack('A-act', 'Shattering Speed')]);
    expect(paused.status).toBe('awaitingAction');
    const prize = (paused.pending?.legalActions ?? []).find((a: { type: string }) => a.type === 'takePrize') as { index: number } | undefined;
    expect(prize).toBeDefined();
    // Taking that prize resolves the checkup: both boards empty → TIE (was ongoing/sudden-death pre-fix).
    const done = step(start, [attack('A-act', 'Shattering Speed'), { actor: 'A', type: 'takePrize', index: prize!.index }]);
    expect(done.status).toBe('gameOver');
    expect(done.state.outcome).toBe('tie');
    expect(done.state.players.A.prizes.length).toBe(5);         // took exactly 1 (no sudden-death prize wipe)
  });

  it('Decidueye ex "Sniper\'s Eye" is a passive, NOT an activatable useAbility [TA-77 por-012]', () => {
    // "If your opponent has exactly 4 cards in their hand, ignore all [C] Energy in the costs of attacks
    // used by this Pokémon." A PASSIVE (compendium #2311) implemented via CheckAttackCostEffect — pre-fix
    // it carried `useWhenInPlay: true`, so twinleaf offered `useAbility Sniper's Eye` (a no-op the engine
    // accepted; rotomancer never offers it). Removing the flag drops it from the menu WITHOUT touching the
    // passive: with a 4-card opponent, Crushing Arrow [G,C,C,C] is affordable on just [G] (3 [C] ignored);
    // with a 3-card opponent it is not. Active: Rowlet → Dartrix → Decidueye ex.
    const at = (bHand: number) => step(
      board(player({ active: inPlay('A-act', ['por-10', 'por-11', 'por-12'], en(GRASS, 1, 'a')) }),
            player({ active: inPlay('B-act', [TANKY]), hand: Array.from({ length: bHand }, (_, i) => ({ iid: `B-h${i}`, printing: WATER })) })),
      []);
    const four = at(4);
    const useAbilities = (four.pending?.legalActions ?? []).filter((a: { type: string }) => a.type === 'useAbility');
    expect(useAbilities.length).toBe(0);                    // pre-fix: offered useAbility "Sniper's Eye"
    expect(attacksOffered(four)).toContain('Crushing Arrow'); // passive fired: [G] pays [G,C,C,C]
    expect(attacksOffered(at(3))).not.toContain('Crushing Arrow'); // passive off: [G] can't pay [G,C,C,C]
  });

  it('Latios "Lustrous Assist" is a triggered ability — not offered ungated, fires on Mega Latias ex promote [TA-78 meg-101]', () => {
    // "Once during your turn, when your Mega Latias ex moves from the Bench to the Active Spot, you may move
    // any number of Energy from your Benched Pokémon to that Active Pokémon." A TRIGGERED ability. Pre-fix it
    // carried `useWhenInPlay: true` (offered as an ungated `useAbility` with any active — por-012/RE-31 class)
    // AND checked `activePokemon.name === 'M Latias-EX'` which matches no card (twinleaf name is 'Mega Latias
    // ex'), so the trigger was dead. Fix: drop useWhenInPlay + correct the name.
    // (a) Not offered ungated with a plain Ralts active:
    const ungated = step(
      board(player({ active: inPlay('A-act', [RALTS]), bench: [inPlay('A-latios', ['meg-101'], en(PSY, 2, 'lat'))] }),
            player({ active: inPlay('B-act', [RALTS]) })),
      []);
    expect((ungated.pending?.legalActions ?? []).filter((a: { type: string }) => a.type === 'useAbility').length).toBe(0);
    // (b) Retreating Ralts into Mega Latias ex (slot 0) auto-fires the ability's ConfirmPrompt:
    const promote = step(
      board(player({
        active: inPlay('A-act', [RALTS], en(WATER, 1, 'act')),
        bench: [inPlay('A-mlx', ['meg-100']), inPlay('A-src', [RALTS], en(PSY, 2, 'src')), inPlay('A-latios', ['meg-101'])],
      }), player({ active: inPlay('B-act', [RALTS]) })),
      [{ actor: 'A', type: 'retreat', to: 0 }, { actor: 'A', type: 'discard', target: 'acte0' }]);
    expect(promote.state.players.A.active!.stack[0].iid).toBe('A-mlx'); // Mega Latias ex promoted
    expect(types(promote)).toContain('confirm');                        // Lustrous Assist fired (was dead pre-fix)
  });

  it('Radiant Alakazam "Painful Spoons" moves the OPPONENT\'s counters, not the user\'s own [F-024 sit-059]', () => {
    // "Once during your turn, you may move up to 2 damage counters from 1 of your opponent's Pokemon
    // to another of their Pokemon." Pre-fix twinleaf built the MoveDamagePrompt's maxAllowedDamage
    // from the ability-user's OWN side (player.forEachPokemon BOTTOM_PLAYER) while scoping the prompt
    // to TOP_PLAYER, so the SOURCE menu offered the user's own (undamaged) Pokemon and the counter
    // could never be moved. The source list must be the OPPONENT's Pokemon.
    const chooseTargets = (r: ReturnType<typeof step>): string[] =>
      (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'choose').map(a => (a as { target: string }).target);

    // ── the MENU half, on a board where the source pick is a GENUINE choice ──────────────────
    // TA-239: `move-damage` now collapses a forced step (CF-14), so the original board — one damaged
    // opponent Pokemon — externalizes no source menu at all and could not carry this assertion. Give
    // B TWO damaged Pokemon and the pick is real, which is the only condition under which "whose
    // Pokemon are offered as sources" is an observable question.
    const twoDamaged = board(
      player({ active: inPlay('A-act', ['sit-059'], [], 30), bench: [inPlay('A-bench', ['sit-060'], [], 30)] }),
      player({ active: inPlay('B-act', ['sit-060'], [], 20), bench: [inPlay('B-b0', ['sit-060'], [], 20)] }),
    );
    const menu = step(twoDamaged, [{ actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Painful Spoons' }]);
    const sources = chooseTargets(menu);
    expect(sources.sort()).toEqual(['B-act', 'B-b0']); // ONLY the opponent's Pokemon are sources
    // Pre-fix F-024 built the source list from the ability-user's own side. Both of A's Pokemon are
    // damaged here specifically so that the bug would have something to offer — on the old board they
    // were undamaged, so the damage filter alone would have hidden a regression.
    expect(sources).not.toContain('A-act');
    expect(sources).not.toContain('A-bench');

    // ── the EFFECT half, on the forced board ────────────────────────────────────────────────
    // One damaged opponent Pokemon, min:1 → the first transfer is forced end-to-end and applies
    // atomically. Assert the OUTCOME rather than the (correctly absent) menu: if the prompt ever
    // regressed to the user's own side, A's Pokemon are undamaged here, no source would qualify, and
    // the transfer simply would not happen — which these assertions catch.
    const start = board(
      player({ active: inPlay('A-act', ['sit-059']), bench: [inPlay('A-bench', ['sit-060'])] }),
      player({ active: inPlay('B-act', ['sit-060'], [], 20), bench: [inPlay('B-b0', ['sit-060'])] }),
    );
    const moved = step(start, [
      { actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Painful Spoons' },
      { actor: 'A', type: 'confirm', value: false },   // endChoice: decline the SECOND "up to 2" move
    ]);
    expect(moved.state.players.B.active!.damage).toBe(10);  // opponent's counter moved…
    expect(moved.state.players.B.bench[0].damage).toBe(10); // …to the opponent's other Pokemon
    expect(moved.state.players.A.active!.damage).toBe(0);   // and the user's own side is untouched
    expect(moved.state.players.A.bench[0].damage).toBe(0);
  });

  it('Articuno "Cold Cyclone" can move a Splash Energy — a Special Energy that PROVIDES [W] [F-026 teu-032]', () => {
    // "Move 2 [W] Energy from this Pokemon to 1 of your Benched Pokemon." Splash Energy (bkp-113) has a
    // static provides:[] and yields [W] only DYNAMICALLY (CheckProvidedEnergyEffect) while on a [W]
    // Pokemon. Articuno is [W], so the attached Splash Energy IS a movable [W] Energy. Pre-fix the move
    // filtered by the static provides (AttachEnergyPrompt validCardTypes), so the Splash Energy was
    // omitted from the menu AND rejected by validate — the move used the dynamic provided type instead.
    const splash = (iid: string): CardRef => ({ iid, printing: 'bkp-113' });
    const boardOf = () => board(
      player({
        active: inPlay('A-act', ['teu-032'], [{ iid: 'ae0', printing: WATER }, { iid: 'ae1', printing: WATER }, splash('ae2')]),
        bench: [inPlay('A-b0', ['bs-063'])],  // Squirtle: a [W] Pokemon, a legal Splash destination
      }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    // CF-34: an in-play-source relocation surfaces `moveEnergy{card, source, target}`, not attachEnergy.
    const moveCards = (r: ReturnType<typeof step>): string[] =>
      (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'moveEnergy').map(a => (a as { card: string }).card);

    const menu = step(boardOf(), [attack('A-act', 'Cold Cyclone')]);
    expect(menu.status).toBe('awaitingAction');
    expect(moveCards(menu)).toContain('ae2');   // the Splash Energy is offered as a movable [W] Energy
    expect((menu.pending?.legalActions ?? []).every(a =>
      (a as { type: string }).type !== 'moveEnergy' || (a as { source?: string }).source === 'A-act')).toBe(true);

    // And the full move (Splash + a basic Water, min=max=2) relocates the Splash onto the [W] bench:
    const moved = step(boardOf(), [
      attack('A-act', 'Cold Cyclone'),
      { actor: 'A', type: 'moveEnergy', card: 'ae2', source: 'A-act', target: 'A-b0' },
      { actor: 'A', type: 'moveEnergy', card: 'ae0', source: 'A-act', target: 'A-b0' },
    ]);
    expect(moved.state.players.A.bench[0].energy.map(e => e.printing)).toContain('bkp-113');
  });

  it('Dragonite DS "Delta Charge" (a Poke-POWER) is offered in the legalActions menu [F-027 ds-003]', () => {
    // Delta Charge is an activated `useWhenInPlay` power, but a POKEPOWER (not an ABILITY). The
    // conformance abilityMenu enumerated only PowerType.ABILITY, so it omitted every activated
    // Poke-Power/Poke-Body-era power from the menu even though the engine resolves it when sent.
    // With a Lightning in the discard and a benched target, the power's preconditions are met.
    const start = board(
      player({ active: inPlay('A-act', ['ds-003']), bench: [inPlay('A-b0', [RALTS])], discard: [{ iid: 'A-disc0', printing: 'sve-004' }] }),
      player({ active: inPlay('B-act', [RALTS]) }),
    );
    const abilities = (r: ReturnType<typeof step>): string[] =>
      (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'useAbility').map(a => (a as { ability: string }).ability);
    expect(abilities(step(start, []))).toContain('Delta Charge');

    // …and it still resolves when used (attach the Lightning from discard onto the bench). TA-239:
    // the explicit `attachEnergy` pick is gone — one Lightning in the discard and one legal
    // destination make this attach forced, so the attach-energy decomposer now applies it atomically
    // (CF-14) and the recorded action became surplus (it was re-read as a top-level main-phase attach
    // and faulted with `card is not in A's hand`). The assertions below are unchanged.
    const used = step(start, [
      { actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Delta Charge' },
    ]);
    expect(used.state.players.A.bench[0].energy.map(e => e.printing)).toContain('sve-004');
    expect(used.state.players.A.discard.map(c => c.printing)).not.toContain('sve-004');
  });

  it('Medicham HL "Meditate" adds the DEFENDER\'s damage without crashing [crash hl-010]', () => {
    // "Does 20 damage plus 10 more damage for each damage counter on the Defending Pokemon." The card
    // read `effect.target.damage`, but AttackEffect never populates `.target` (only player/opponent/
    // attack/damage/source), so it was always undefined -> TypeError on declareAttack. The defender is
    // reached via effect.opponent.active. Defender has 30 damage (3 counters) -> 20 + 30 = 50 dealt.
    const r = step(
      board(player({ active: inPlay('A-act', ['hl-010'], en(FIGHT, 2, 'a')) }),
            player({ active: inPlay('B-act', [TANKY], [], 30) })),
      [attack('A-act', 'Meditate')],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.B.active!.damage).toBe(80);   // 30 existing + 50 dealt
  });

  it('Blend Energy WLFM provides only 1 Energy at a time — one Blend pays [F] but not the 2-cost [F][M] [drx-118 sfa-046]', () => {
    // Blend Energy WLFM (drx-118): "provides [W], [L], [F], or [M] but only 1 Energy at a time." A single
    // attached Blend is ONE Energy that counts as one of those four types: it pays a 1-Energy cost of any
    // of them, but NOT a 2-Energy cost — even when both cost types are in its set. The card pushed
    // provides:[W,L,F,M] (four units) into the energyMap instead of a single COLORLESS placeholder like
    // every sibling blend/unit energy (Team Rocket's Energy, Unit Energy, Single/Rapid Strike, Dark Metal),
    // so checkEnoughEnergy flattened one Blend into four Energy and let it pay Haxorus's [F][M] Dragon Pulse.
    const boardOf = () => board(
      player({ active: inPlay('A-act', ['sfa-046'], [{ iid: 'ab0', printing: 'drx-118' }]) }),  // Haxorus + 1 Blend WLFM
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const offered = attacksOffered(step(boardOf(), []));
    expect(offered).toContain('Bring Down the Axe');   // [F]    — one Blend pays a single-Energy cost
    expect(offered).not.toContain('Dragon Pulse');     // [F][M] — one Blend is only 1 Energy, not payable
    // …and the engine also REJECTS the attack if declared directly (not merely omits it from the menu):
    expect(step(boardOf(), [attack('A-act', 'Dragon Pulse')]).status).not.toBe('awaitingAction');
  });

  it('Croconaw SLG "Plunge" moves Energy to the benched Croconaw and switches it in (no crash) [crash slg-019]', () => {
    // "if this Pokemon is on your Bench, you may move all Energy from your Active Pokemon to this
    // Pokemon. If you do, switch it with your Active Pokemon." The card set source = player.active, so
    // player.bench.indexOf(source) was -1 and the swap set player.active = player.bench[-1] = undefined,
    // crashing the next checkState (forEachPokemon on an undefined active). Energy must move to the
    // BENCHED Croconaw, then it switches to the Active.
    const r = step(
      board(player({ active: inPlay('A-act', [RALTS], en(WATER, 2, 'a')), bench: [inPlay('A-b0', ['slg-019'])] }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [{ actor: 'A', type: 'useAbility', source: 'A-b0', ability: 'Plunge' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.active!.stack.map(c => c.printing)).toContain('slg-019'); // Croconaw switched in
    expect(r.state.players.A.active!.energy.length).toBe(2);                            // carried the Energy
    expect(r.state.players.A.bench[0].energy.length).toBe(0);                           // old Active, drained
  });

  it('Rotom ex "Thunderbolt" discards all its Energy and does not crash on its own KO [TA-113 pfl-029]', () => {
    // Multi Adapter reads effect.player on every CheckTableStateEffect, but the post-KO cleanup pass
    // dispatches `new CheckTableStateEffect([5,5])` with no player, so the card dereferenced undefined
    // (StateUtils.isPokemonInPlay → undefined.forEachPokemon) and 500'd whenever Thunderbolt's own KO
    // ran that cleanup. Fixed by deriving the owner from state (the arceus-lv-x idiom). Roto resolves it.
    const LIGHTNING = 'sve-004';
    const r = step(
      board(player({ active: inPlay('A-act', ['pfl-029'], [...en(LIGHTNING, 1, 'a'), ...en(WATER, 1, 'a2')]) }),
            player({ active: inPlay('B-act', [RALTS]), bench: [inPlay('B-b0', [RALTS])] })),
      [attack('A-act', 'Thunderbolt')],
    );
    expect(r.status).toBe('awaitingAction');                    // no engineFault 500
    expect(r.state.players.A.active!.energy.length).toBe(0);    // "Discard all Energy from this Pokemon"
    expect(r.state.players.B.active).toBeNull();                // 130 KOs the 70-HP Ralts (awaiting promote)
  });

  it('Megaton Blower is NOT playable for no effect [TA-154 ssp-182, #2064]', () => {
    // Compendium #2064: "You can't play the card for no effect, but if there is at least one of those
    // types of cards in play you do as much as you can." The card: "Discard all Pokémon Tools and
    // Special Energy from all of YOUR OPPONENT'S Pokémon, and discard a Stadium in play." canPlay
    // returned true unconditionally, so twinleaf offered it on a board where it does nothing —
    // rotomancer gates it (they found the same rule via their own #2064 pass; their no-effect prover
    // missed only the Stadium zone, ours missed everything). A Tool on OUR OWN Pokémon must NOT
    // enable it: the discard halves read the opponent's board only, the Stadium half reads the slot.
    const SPECIAL_E = 'jtg-159';
    const offered = (opts: { stadium?: boolean; oppTool?: boolean; oppSpecial?: boolean; ownTool?: boolean }) => {
      const A = player({ active: inPlay('A-act', ['dri-023'], en(GRASS, 1, 'a')), hand: [{ iid: 'mb0', printing: 'ssp-182' }] });
      const B = player({ active: inPlay('B-act', ['meg-181']) });
      if (opts.oppTool) { B.active!.tools = [{ iid: 'b-tool', printing: 'asc-181' }]; }
      if (opts.oppSpecial) { B.active!.energy = [{ iid: 'b-se', printing: SPECIAL_E }]; }
      if (opts.ownTool) { A.active!.tools = [{ iid: 'a-tool', printing: 'asc-181' }]; }
      const st = board(A, B);
      if (opts.stadium) { st.stadium = { iid: 'stad', printing: 'dri-166', owner: 'A' }; }
      const r = step(st, []);
      return (r.pending?.legalActions ?? []).some(a => (a as { card?: string }).card === 'mb0');
    };
    expect(offered({})).toBe(false);                   // pre-fix: true — playable for no effect
    expect(offered({ ownTool: true })).toBe(false);    // own-side Tool is NOT a target
    expect(offered({ stadium: true })).toBe(true);
    expect(offered({ oppTool: true })).toBe(true);
    expect(offered({ oppSpecial: true })).toBe(true);
  });

  it('Amulet of Hope floors its untyped search at ONE card [TA-157 ssp-162, #2061] and its trigger no longer 500s the driver [TA-158]', () => {
    // Compendium #2061 (this exact card): "You must take at least 1 card with Amulet of Hope when it
    // applies" — the untyped-search exception (#2301's final clause; roto's #968), which roto's third note
    // applied to THEIR engine and we then found mirrored here: min:0 let the owner whiff a mandatory
    // search. Two defects, one board:
    //   TA-157 — min:0 → min:1 (the decline must NOT be offered at 0 picks; a stop appears after 1).
    //   TA-158 — the card's LOG_PLAYER_USES_ABILITY call passed `card:` where the template wants
    //   `ability:`, and the event-mapper's deliberate strictness turned the malformed log into a live
    //   500 at exactly this trigger (6 cards repo-wide shipped the same malformed call — all fixed).
    // Board: B's Rotom ex Thunderbolt (130) KOs A's 60-HP Oddish wearing the Amulet.
    const bd = () => {
      const A = player({ active: inPlay('A-act', ['asc-001']), bench: [inPlay('A-b0', ['asc-004'])],
        deck: fillerDeck('A', 6) });
      A.active!.tools = [{ iid: 'amulet', printing: 'ssp-162' }];
      const B = player({ active: inPlay('B-act', ['pfl-029'], [...en('sve-004', 1, 'bl'), ...en(WATER, 1, 'bw')]) });
      const st = board(A, B);
      st.activePlayer = 'B';
      return st;
    };
    const atk = { actor: 'B' as const, type: 'declareAttack' as const, source: 'B-act', name: 'Thunderbolt' };
    const prize = { actor: 'B' as const, type: 'takePrize' as const, index: 0 };
    const promote = { actor: 'A' as const, type: 'promoteBench' as const, target: 'A-b0' };

    // (a) TA-158: reaching the trigger does not fault, and the search pending surfaces for A.
    const r1 = step(bd(), [atk, prize, promote]);
    expect(r1.status).toBe('awaitingAction');            // pre-fix: engineFault (missing "ability")
    expect(r1.pending?.actor).toBe('A');                 // the Amulet owner's search, not B's
    // (b) TA-157: no decline at 0 picks — the search is mandatory.
    expect(types(r1)).not.toContain('confirm');          // pre-fix: confirm offered immediately
    const picks = (r1.pending?.legalActions ?? []).filter(a => (a as { type: string }).type !== 'confirm');
    expect(picks.length).toBeGreaterThan(0);
    // (c) after ONE pick the stop appears (1..3 is the real range) and taking it lands the card in
    // A's hand — the whole flow, not merely the menu, carries the floor.
    const r2 = step(bd(), [atk, prize, promote, picks[0] as never]);
    expect(types(r2)).toContain('confirm');
    const r3 = step(bd(), [atk, prize, promote, picks[0] as never,
      { actor: 'A' as const, type: 'confirm' as const, value: false }]);
    expect(r3.state.players.A.hand.length).toBe(1);      // took exactly the 1 picked card
  });

  it('Minccino "Cleaning Up" lets the player discard ZERO Tools [TA-155 tef-136, #2301]', () => {
    // Compendium #2301 (Ascended Heroes rulebook): "For effects of attacks, if a card uses the phrase
    // 'up to X' you can choose any number between 0 and the maximum." The card declared min:1 and hid
    // the 0 option behind the UI-only cancel, so on a board with exactly one Tool-bearer the range
    // collapsed to 1..1 and CF-14 auto-resolved it — the wire discarded the opponent's Tool with no
    // decision ever surfaced (rotomancer surfaces pick-or-decline; it is right). Found by the RE-74
    // sibling sweep, the first walk into an attack-side Tool discard (the Tool axis had zero corpus
    // coverage until gen_branch_seeds). NOTE the ruling's asymmetry: Trainer/Ability "up to X" is
    // 1..max, so min:1 remains CORRECT on Blowtorch/Ruffian — do not "fix" those to match.
    const bd = () => {
      const A = player({ active: inPlay('A-act', ['tef-136'], en(WATER, 2, 'a')) });
      const B = player({ active: inPlay('B-act', ['meg-181']), bench: [inPlay('B-b0', ['asc-004'])] });
      B.bench[0].tools = [{ iid: 'b-tool', printing: 'asc-181' }];
      return board(A, B);
    };
    const declare = attack('A-act', 'Cleaning Up');

    // (a) the decision SURFACES: a pick plus the advertised decline — nothing auto-resolves.
    const r1 = step(bd(), [declare]);
    expect(r1.status).toBe('awaitingAction');
    expect(types(r1)).toContain('choose');                        // pre-fix: no pending at all
    expect(types(r1)).toContain('confirm');                       // the 0-option (CF-12 stop)
    expect(r1.state.players.B.bench[0].tools.length).toBe(1);     // pre-fix: already discarded here

    // (b) declining discards nothing and the attack still completes (turn passes to B).
    const r2 = step(bd(), [declare, { actor: 'A' as const, type: 'confirm' as const, value: false }]);
    expect(r2.state.players.B.bench[0].tools.length).toBe(1);
    expect(r2.state.players.B.discard.length).toBe(0);
    expect(r2.state.activePlayer).toBe('B');

    // (c) taking the pick discards the bench Tool — the fix must not have broken the 1-option itself.
    const r3 = step(bd(), [declare, { actor: 'A' as const, type: 'choose' as const, target: 'B-b0' }]);
    expect(r3.state.players.B.bench[0].tools.length).toBe(0);
    expect(r3.state.players.B.discard.map(c => c.printing)).toContain('asc-181');
  });

  it('Core Memory grants "Geobuster" ONLY to Mega Zygarde ex [TA-152 por-070]', () => {
    // "The Mega Zygarde ex this card is attached to can use the attack on this card." The Tool carries no
    // ATTACH restriction, so it may sit on anything — it simply grants nothing to an ineligible holder.
    // The bug was an offer-then-throw: CheckPokemonAttacksEffect pushed Geobuster whenever the Tool was
    // attached, without checking the holder, and CheckAttackCostEffect then THREW CANNOT_USE_ATTACK for a
    // non-Zygarde holder. Since costing runs while building the menu, computing legalActions blew up and
    // the whole position became unprojectable (`invalidAction` on a legal board). That violates the
    // invariant the fuzzer checks by name — an engine must never reject a move it just offered.
    //
    // Controlled across 7 Tools: Core Memory was the ONLY one that broke the board, so this is about the
    // attack-granting path and not about Tools in general. Rotomancer offers Melmetal's own two attacks
    // and nothing else — it is right.
    const withCoreMemory = () => {
      const A = player({ active: inPlay('A-act', ['scr-104'], en(METAL, 3, 'a')) });
      A.active!.tools = [{ iid: 'a-tool', printing: 'por-070' }];
      return step(board(A, player({ active: inPlay('B-act', ['meg-181']) })), []);
    };
    const r = withCoreMemory();
    expect(r.status).toBe('awaitingAction');           // pre-fix: 'invalidAction' — board unprojectable
    expect(attacksOffered(r)).toEqual(['Reforged Axe', 'Wrack Down']);  // pre-fix: threw before returning
    expect(attacksOffered(r)).not.toContain('Geobuster');
  });

  it('Melmetal "Reforged Axe" discards ITS OWN Tool, not the opponent\'s [TA-151 scr-104]', () => {
    // "Before doing damage, discard all Pokémon Tools from THIS POKÉMON. If you can't discard any, this
    // attack does nothing." The implementation read `opponent.active` / `opponent.discard`, so the gate
    // was decided by whether the DEFENDER wore a Tool — the wrong-perspective family (TA-121 Croconaw,
    // TA-147 Team Rocket's Zapdos). With a Tool on the attacker: pre-fix 0 damage and the Tool still
    // attached; correct is 250 and the Tool in the ATTACKER's discard.
    //
    // Invisible to the fuzzer until now for a measured reason: not one of the 7066 seed boards in the
    // corpus had a Tool attached to anything, so the gate could only ever be evaluated on its dead side
    // (docs/branch-scan-20260729.md). Found by the first tools/gen_branch_seeds.py second board.
    const axe = (attackerTool: string | null, defenderTool: string | null) => {
      // meg-181 Mega Latias ex: 280 HP, no weakness — 250 must LAND rather than KO, or the
      // post-attack board reads `active: null` and the damage assertion cannot be made at all.
      const A = player({ active: inPlay('A-act', ['scr-104'], en(METAL, 3, 'a')) });
      const B = player({ active: inPlay('B-act', ['meg-181']) });
      if (attackerTool) { A.active!.tools = [{ iid: 'a-tool', printing: attackerTool }]; }
      if (defenderTool) { B.active!.tools = [{ iid: 'b-tool', printing: defenderTool }]; }
      return step(board(A, B), [attack('A-act', 'Reforged Axe')]);
    };
    const TOOL = 'asc-181'; // Air Balloon — retreat-cost only, so it cannot perturb the damage number

    // (a) Tool on the ATTACKER: the gate is satisfied — 250, and the Tool goes to the ATTACKER's discard.
    const own = axe(TOOL, null);
    expect(own.state.players.B.active!.damage).toBe(250);        // pre-fix: 0
    expect(own.state.players.A.active!.tools.length).toBe(0);    // pre-fix: 1 (never discarded)
    expect(own.state.players.A.discard.length).toBe(1);          // pre-fix: 0 — wrong player's pile
    expect(own.state.players.B.discard.length).toBe(0);

    // (b) Tool on the DEFENDER only: nothing to discard from THIS Pokémon, so the attack does nothing —
    // and the defender's Tool must survive. Pre-fix this row was inverted (it dealt the 250).
    const opp = axe(null, TOOL);
    expect(opp.state.players.B.active!.damage).toBe(0);
    expect(opp.state.players.B.active!.tools.length).toBe(1);

    // (c) control: no Tool anywhere — the gate genuinely fails, 0 damage. Read the same before and
    // after the fix, so a passing row (a) cannot be explained by the attack simply always firing.
    expect(axe(null, null).state.players.B.active!.damage).toBe(0);
  });

  it('Arboliva ex "Oil Salvo" ignores Weakness and Resistance [TA-150 dri-023]', () => {
    // "…do 20 damage to it. This damage isn't affected by Weakness or Resistance." Six picks = 120.
    // Pre-fix the flags were never set, and DAMAGE_OPPONENT_POKEMON routes an ACTIVE target through
    // DealDamageEffect (the W/R-applying path; Bench targets go to PutDamageEffect and were always
    // right). Measured pre-fix: Grass-WEAK took 240, Grass-RESISTANT took 90. The neutral row is the
    // control that isolates it — it read 120 both before and after, so a passing weak/resist row cannot
    // be explained by the attack simply doing less damage. Rotomancer was correct on all three.
    const GRASS_E = 'sve-009';
    const oil = (defender: string) => step(
      board(player({ active: inPlay('A-act', ['dri-023'], en(GRASS_E, 1, 'a')) }),
            player({ active: inPlay('B-act', [defender]) })),
      [attack('A-act', 'Oil Salvo'), ...Array.from({ length: 6 }, () => (
        { actor: 'A' as const, type: 'choose' as const, target: 'B-act' }))],
    );
    expect(oil('dri-104').state.players.B.active!.damage).toBe(120);  // WEAK Grass x2  — was 240
    expect(oil('dri-145').state.players.B.active!.damage).toBe(120);  // RESIST Grass -30 — was 90
    expect(oil('dri-065').state.players.B.active!.damage).toBe(120);  // neutral control — unchanged
    // The ORIGINAL bug report's own defender (twinleaf:1424941194147790922), added here because it
    // cannot be guarded cross-engine: Gholdengo ex `par-139` is not in the rotomancer pool, so the
    // repro scenario SKIPped on every run and never actually asserted anything. Same Grass -30 as
    // dri-145; the report measured 90.
    expect(oil('par-139').state.players.B.active!.damage).toBe(120); // RESIST Grass -30 — was 90
  });

  it('Arboliva ex "Oil Salvo" applies Granite Cave ONCE to the per-target total [TA-150/#2161 dri-023]', () => {
    // Compendium #2161 (Destined Rivals FAQ, TPCi Rules Team 2025-05-29) on this exact attack: "Oil Salvo
    // is a single attack. The attack's damage is calculated AFTER you finish making all choices, so all
    // damage modifiers are applied to the TOTAL damage for each Pokémon." So six picks on a Steven's
    // Pokémon under Granite Cave dri-166 = 120 total, minus 30 ONCE = 90 — NOT six 20s each reduced by 30
    // (which would clamp to 0). This is the guard that would have caught the "apply six discrete hits"
    // change I nearly landed as TA-148 (retracted; see arboliva-ex.ts).
    const GRASS_E = 'sve-009';
    const b = board(player({ active: inPlay('A-act', ['dri-023'], en(GRASS_E, 1, 'a')) }),
                    player({ active: inPlay('B-act', ['dri-145']) }));  // Steven's Metagross ex, 340 HP
    const r = step(
      { ...b, stadium: { iid: 'stad', printing: 'dri-166', owner: 'A' } },
      [attack('A-act', 'Oil Salvo'), ...Array.from({ length: 6 }, () => (
        { actor: 'A' as const, type: 'choose' as const, target: 'B-act' }))],
    );
    expect(r.state.players.B.active!.damage).toBe(90);
  });

  it('Oil Salvo: a lethally-damaged Shaymin still shields the Bench [#2160 dri-010/dri-023]', () => {
    // Compendium #2160 (Destined Rivals FAQ, TPCi Rules Team 2025-05-29): "If I use Arboliva ex's 'Oil
    // Salvo' attack and choose my opponent's active Shaymin with the 'Flower Curtain' Ability first with
    // enough damage to KO it, can I then choose benched non-Rule Box Pokemon and do damage to them? — No,
    // you cannot. All damage is done before KO's happen, so the Shaymin is still there to protect Benched
    // Pokemon that don't have a Rule Box."
    //
    // 4 picks at the Active = 80 = exactly lethal on Shaymin's 80 HP, then 2 picks at the Bench = 40, which
    // Steven's Baltoy (60 HP) survives so the number is readable. The two halves below share an IDENTICAL
    // action list and differ ONLY in B's Active card — that A/B is what makes the 0 attributable to Flower
    // Curtain rather than to the Bench picks being dropped, mis-targeted or capped. Guards the ordering a
    // change to Oil Salvo's damage application could silently break (cf. TA-148, retracted).
    const GRASS_E = 'sve-009';
    const salvo = (bActive: string) => step(
      board(player({ active: inPlay('A-act', ['dri-023'], en(GRASS_E, 1, 'a')) }),
            player({ active: inPlay('B-act', [bActive]), bench: [inPlay('B-b0', ['dri-083'])] })),
      [attack('A-act', 'Oil Salvo'),
       ...Array.from({ length: 4 }, () => ({ actor: 'A' as const, type: 'choose' as const, target: 'B-act' })),
       ...Array.from({ length: 2 }, () => ({ actor: 'A' as const, type: 'choose' as const, target: 'B-b0' }))],
    );
    // Shaymin dri-010 (Flower Curtain) took lethal damage first — the Bench is still protected.
    expect(salvo('dri-010').state.players.B.bench[0].damage).toBe(0);
    // CONTROL: same actions, no Flower Curtain in play — the Bench takes its 40.
    expect(salvo('dri-083').state.players.B.bench[0].damage).toBe(40);
  });

  it('Oil Salvo applies NO damage until every choice is made [#2161 dri-023]', () => {
    // #2161: "The attack's damage is calculated AFTER you finish making all choices." So mid-selection the
    // board must be untouched — nothing is applied per pick. Asserted at 1 of 6 picks: still 0 damage, and
    // the decision is still open. (Rotomancer applies 20 immediately after the first pick and logs a
    // `damaged` event there — filed as RE-72.) This also underpins #2160: if damage landed incrementally a
    // target could be KO'd mid-selection, which is exactly what that ruling forbids.
    const GRASS_E = 'sve-009';
    const r = step(
      board(player({ active: inPlay('A-act', ['dri-023'], en(GRASS_E, 1, 'a')) }),
            player({ active: inPlay('B-act', ['dri-010']), bench: [inPlay('B-b0', ['dri-083'])] })),
      [attack('A-act', 'Oil Salvo'), { actor: 'A' as const, type: 'choose' as const, target: 'B-act' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.B.active!.damage).toBe(0);   // not 20 — nothing applied yet
    expect(r.state.players.B.bench[0].damage).toBe(0);
    expect(types(r)).toContain('choose');               // the pick set is still open
  });

  it('Team Rocket\'s Zapdos "Jamming Wing" moves the Energy to the OPPONENT\'s Bench [TA-147 dri-070]', () => {
    // "You may move an Energy from your opponent's Active Pokemon to 1 of THEIR Benched Pokemon."
    // Pre-fix the card resolved the destination with `StateUtils.getTarget(state, opponent, transfer.to)`,
    // but that helper treats its `player` argument as the FRAME and flips to `getOpponent(frame)` when
    // `target.player === TOP_PLAYER`. This prompt is built with `player.id` + `PlayerType.TOP_PLAYER`, so
    // `transfer.to` ALREADY means "the opponent's side as seen by the attacker"; passing `opponent`
    // flipped it a second time and landed the Energy on A's OWN Bench — the attacker stole it. Same class
    // as TA-121 (Croconaw "Crunch" wrong-perspective discard).
    //
    // A is given a Bench on purpose: it is the wrong destination, so an empty A-bench could not tell a
    // correct move from a silently dropped one — and that is exactly why this guard survives TA-239
    // unchanged in substance. The explicit `moveEnergy` pick is gone (2026-08-11): the attack-energy
    // decomposer now collapses this single forced relocation per CF-14, so the pick is applied without
    // being offered and the recorded action became surplus. Every assertion below is untouched, which
    // is the check that matters — the same board still lands the Energy in the same place.
    const r = step(
      board(player({ active: inPlay('A-act', ['dri-070'], en(WATER, 2, 'a')), bench: [inPlay('A-b0', [RALTS])] }),
            player({ active: inPlay('B-act', [RALTS], en(PSY, 1, 'b')), bench: [inPlay('B-b0', [RALTS])] })),
      [
        attack('A-act', 'Jamming Wing'),
        { actor: 'A' as const, type: 'confirm' as const, value: true },
      ],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.B.bench[0].energy.map(e => e.printing)).toEqual([PSY]);  // landed on THEIR bench
    expect(r.state.players.B.active!.energy.length).toBe(0);                        // left their Active
    expect(r.state.players.A.bench[0].energy.length).toBe(0);                       // NOT stolen by A
  });

  // ── 2026-08-11 batch: these four had ONLY anti-revert signatures until now ────────────────────
  // A signature guards the TEXT of a fix. It does not notice a second prize-award path reappearing
  // somewhere else, a flip polarity flipping back, or a flag losing its reset. TA-240 in particular
  // ENDS GAMES, and was verified only by an ad-hoc live probe on the day. These are those probes.

  it('a direct-effect KO awards its prizes ONCE — Mega ex = 3, not 6 [TA-240 dri-018 / meg-181]', () => {
    // Hydrapple "Hydra Breath": discard 6 Basic [G] from hand to Knock Out the opponent's Active.
    // The KO is dispatched by a card effect, so it goes through KnockOutOpponentEffect — which used
    // to award via TAKE_X_PRIZES *and* via the CF-7 `pendingDirectKoPrizes` accumulator. Mega Latias
    // ex is worth 3 (1 + POKEMON_ex + POKEMON_SV_MEGA); pre-fix twinleaf offered SIX takePrize picks,
    // emptied the pile and returned gameOver/winA off a single KO.
    const hand = Array.from({ length: 6 }, (_, i) => ({ iid: `A-h${i}`, printing: GRASS }));
    const start = () => board(
      player({ active: inPlay('A-act', ['dri-016', 'dri-017', 'dri-018'], en(GRASS, 1, 'a')), hand }),
      player({ active: inPlay('B-act', ['meg-181']), bench: [inPlay('B-b0', [RALTS])] }),
    );
    const tp = { actor: 'A' as const, type: 'takePrize' as const, index: 0 };

    // Exactly three are accepted, and the game is still going.
    const three = step(start(), [attack('A-act', 'Hydra Breath'), tp, tp, tp]);
    expect(three.state.players.A.prizes.length).toBe(3);
    expect(three.state.outcome).toBe('ongoing');
    // ...and the prize decision is CLOSED — a 4th pick is not on offer.
    expect(types(three)).not.toContain('takePrize');

    // The regression itself: a 4th takePrize must be refused, not paid.
    const four = step(start(), [attack('A-act', 'Hydra Breath'), tp, tp, tp, tp]);
    expect(four.state.players.A.prizes.length).toBe(3);   // pre-fix: 2, then 1, then 0 + winA
    expect(four.state.outcome).toBe('ongoing');
  });

  it('a direct-effect KO of a NON-ex awards exactly 1 [TA-240 control]', () => {
    // The control that distinguishes "stopped double-paying" from "stopped paying the right amount":
    // the same code path on a 1-prize Pokémon must still award its one prize.
    const hand = Array.from({ length: 6 }, (_, i) => ({ iid: `A-h${i}`, printing: GRASS }));
    const r = step(
      board(player({ active: inPlay('A-act', ['dri-016', 'dri-017', 'dri-018'], en(GRASS, 1, 'a')), hand }),
            player({ active: inPlay('B-act', [RALTS]), bench: [inPlay('B-b0', [RALTS])] })),
      [attack('A-act', 'Hydra Breath'), { actor: 'A' as const, type: 'takePrize' as const, index: 0 }],
    );
    expect(r.state.players.A.prizes.length).toBe(5);     // 6 - 1
    expect(types(r)).not.toContain('takePrize');          // and no second pick
  });

  it('Iono\'s Electrode "Thump-Thump Boom" KOs on HEADS, not tails [TA-241 jtg-048]', () => {
    // "…Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out." The callback branched
    // on `!result`, so the KO fired on TAILS and was withheld on heads — exactly inverted.
    // Electrode also does 100 to itself and has 100 HP, so it self-KOs on BOTH faces; only the
    // opponent's Active discriminates.
    const start = () => board(
      player({ active: inPlay('A-act', ['jtg-047', 'jtg-048'], en('sve-004', 2, 'a')), bench: [inPlay('A-b0', [RALTS])] }),
      player({ active: inPlay('B-act', [TANKY]), bench: [inPlay('B-b0', [RALTS])] }),
    );
    const flip = (face: 'heads' | 'tails') =>
      ({ actor: 'system' as const, type: 'flip' as const, face });

    const heads = step(start(), [attack('A-act', 'Thump-Thump Boom'), flip('heads')]);
    expect(heads.events.some(e => e.kind === 'ko' && e.player === 'B')).toBe(true);

    const tails = step(start(), [attack('A-act', 'Thump-Thump Boom'), flip('tails')]);
    expect(tails.events.some(e => e.kind === 'ko' && e.player === 'B')).toBe(false);
  });

  it('heads means heads — the flip-mapping control that convicted the CARD, not the driver [TA-241 control]', () => {
    // A mirror-image divergence could equally have been an inverted `system:flip:face` -> boolean
    // mapping in the driver, and "fixing" the card would then have doubled the error. Tandemaus
    // "Play Rough" (10+, "Flip a coin. If heads, this attack does 10 more damage") pins the mapping
    // independently of jtg-048. If this ever reds, TA-241's fix is pointing the wrong way.
    const b = () => board(
      player({ active: inPlay('A-act', ['ssp-157'], en(WATER, 1, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const h = step(b(), [attack('A-act', 'Play Rough'), { actor: 'system' as const, type: 'flip' as const, face: 'heads' as const }]);
    const t = step(b(), [attack('A-act', 'Play Rough'), { actor: 'system' as const, type: 'flip' as const, face: 'tails' as const }]);
    expect(h.state.players.B.active!.damage).toBe(20);
    expect(t.state.players.B.active!.damage).toBe(10);
  });

  it('an inert "move counters to their OTHER Pokémon" offers NO decision [TA-242 twm-082]', () => {
    // Alakazam "Strange Hacking": "…You may move any number of damage counters from your opponent's
    // Pokémon to their other Pokémon in any way you like." With the opponent down to a single
    // Pokémon there is no destination, so B.29 rule 1 says there is nothing to decide (`meg-003`
    // "Solar Transfer — no second Pokémon as destination" is the adjudicated precedent). Twinleaf
    // offered `choose{B.active}` + a decline, and taking the offer reached a destination step with
    // zero candidates: both branches landed on the identical board.
    const inert = step(
      board(player({ active: inPlay('A-act', ['meg-054', 'twm-081', 'twm-082'], en(PSY, 1, 'a')) }),
            player({ active: inPlay('B-act', [RALTS], [], 20) })),
      [attack('A-act', 'Strange Hacking')],
    );
    expect(types(inert)).not.toContain('choose');
    expect(inert.state.players.B.active!.damage).toBe(20);   // untouched, and no phantom pause

    // CONTROL — give the opponent a second Pokémon and the choice is real again. Without this an
    // over-broad filter (suppressing the decision whenever it is optional) would pass the cell above.
    const genuine = step(
      board(player({ active: inPlay('A-act', ['meg-054', 'twm-081', 'twm-082'], en(PSY, 1, 'a')) }),
            player({ active: inPlay('B-act', [RALTS], [], 20), bench: [inPlay('B-b0', [RALTS])] })),
      [attack('A-act', 'Strange Hacking')],
    );
    expect(types(genuine)).toContain('choose');
  });

  it('Primeape\'s Drag Off does NOT fire on the opponent\'s attack [TA-243 dri-091, SD-16]', () => {
    // `usedDragOff` was set on WAS_ATTACK_USED and never cleared anywhere, so once Primeape had
    // attacked the handler re-fired on every later AfterAttackEffect — including B's. Since
    // `effect.player` binds to whoever attacked, B got Drag Off for free: one of A's benched Pokémon
    // dragged into the Active Spot and dealt 30.
    //
    // Three things must hold at once or this board proves nothing (two earlier repro cells came back
    // green for exactly this reason): A must still have a BENCH (the operand the phantom rider
    // consumes), B must be ABLE to attack on its own turn — so the Pokémon Drag Off drags in carries
    // its own Energy — and the path must run PAST B's attack, because the defect is on the second one.
    const r = step(
      board(player({ active: inPlay('A-act', ['dri-090', 'dri-091'], en(FIGHT, 1, 'a')),
                     bench: [inPlay('A-b0', [RALTS]), inPlay('A-b1', [RALTS])] }),
            player({ active: inPlay('B-act', [RALTS]),
                     bench: [inPlay('B-b0', ['dri-090'], en(FIGHT, 1, 'b'))] })),
      [
        attack('A-act', 'Drag Off'),                                    // A's legitimate use
        { actor: 'B' as const, type: 'declareAttack' as const, source: 'B-b0', name: 'Wild Kick' },
        { actor: 'system' as const, type: 'flip' as const, face: 'heads' as const },
      ],
    );
    // A's Primeape is STILL the Active — pre-fix B dragged it to the bench and promoted A-b0.
    expect(r.state.players.A.active!.stack.map(c => c.printing)).toEqual(['dri-090', 'dri-091']);
    // ...and no switch decision was handed to B at the end of B's own attack.
    expect(r.pending?.actor === 'B' && types(r).includes('promoteBench')).toBe(false);
    // The legitimate half still works: A's Drag Off pulled B's benched Mankey in and dealt it 30.
    expect(r.state.players.B.active!.stack.map(c => c.printing)).toEqual(['dri-090']);
  });

  it('Destructo-Press deals 0 on an EMPTY deck, and still scales when stocked [TA-247 tef-062]', () => {
    // "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find
    // there." `damage: 70` with `damageCalculation: 'x'` is a MULTIPLICAND, not a base — so the
    // empty-deck early return (added so a reveal is not prompted with nothing to reveal) left the
    // full 70 standing, and an empty deck dealt 70 where 0 is correct.
    //
    // TWO traps this cell had to survive, both of which made it pass for the wrong reason first:
    //   1. plain `board()` BACKFILLS an empty deck with one filler card, so `deck: []` silently
    //      tested a one-card deck. Hence `boardKeepingEmptyDeck`. (The G-8 blind spot — 0 of 9,058
    //      corpus sides ever starts with an empty deck — reproduced inside the test helper.)
    //   2. on a STOCKED deck the damage is DEFERRED behind the reveal's shuffle prompt, so reading
    //      `.damage` straight after `declareAttack` reads 0 on every board — including a board that
    //      is about to deal 210. The stocked cells must drive the shuffle before asserting.
    const LIGHT = 'sve-004';
    // NOT `TANKY`: Wellspring Mask Ogerpon ex is Lightning-WEAK and Iron Thorns is a Lightning
    // attacker, so every number here would be silently doubled and 210 would KO it outright.
    // `meg-181` is 280 HP with no weakness, so the assertions read the raw damage.
    const WALL280 = 'meg-181';
    const futureDeck = (n: number): CardRef[] => [
      ...Array.from({ length: n }, (_, i) => ({ iid: `A-fut${i}`, printing: 'tef-062' })),
      ...fillerDeck('A', 12 - n),
    ];
    // The revealed Future cards are DISCARDED, so the deck being shuffled is whatever is not Future.
    const shuffleAll = (deck: CardRef[]) =>
      ({ actor: 'system' as const, type: 'shuffle' as const,
         order: deck.filter(c => c.printing !== 'tef-062').map(c => c.iid) });

    const empty = step(
      boardKeepingEmptyDeck(
        player({ active: inPlay('A-act', ['tef-062'], en(LIGHT, 2, 'a')), deck: [] }),
        player({ active: inPlay('B-act', [WALL280]) })),
      [attack('A-act', 'Destructo-Press')],
    );
    expect(empty.state.players.B.active!.damage).toBe(0);

    // CONTROL 1 — a STOCKED deck holding no Future card must ALSO deal 0. This is the cell that
    // fails if the fix is written as "empty deck => 0" rather than fixing the multiplier itself.
    const none = futureDeck(0);
    const noFuture = step(
      board(player({ active: inPlay('A-act', ['tef-062'], en(LIGHT, 2, 'a')), deck: none }),
            player({ active: inPlay('B-act', [WALL280]) })),
      [attack('A-act', 'Destructo-Press'), shuffleAll(none)],
    );
    expect(noFuture.state.players.B.active!.damage).toBe(0);

    // CONTROL 2 — the POSITIVE control, and the one that matters most: 3 Future cards on top must
    // deal 210. Without it a "fix" that zeroed the attack outright would pass both cells above.
    const three = futureDeck(3);
    const threeFuture = step(
      board(player({ active: inPlay('A-act', ['tef-062'], en(LIGHT, 2, 'a')), deck: three }),
            player({ active: inPlay('B-act', [WALL280]) })),
      [attack('A-act', 'Destructo-Press'), shuffleAll(three)],
    );
    expect(threeFuture.state.players.B.active!.damage).toBe(210);
  });

  it('the owed "Then, shuffle your deck" survives an empty deck [TA-250 / B.33]', () => {
    // B.33: the shuffle's grammatical OBJECT decides, not the word "Then". #1979 (Sinistcha ex
    // Re-Brew) also says "Then," and is still suppressed — because its object is "THOSE Energy
    // cards", which ceases to exist when no counters are placed. "shuffle YOUR DECK" names an object
    // that survives whatever the search did, so #361 ("you can use the attack, but you cannot search
    // your deck") leaves the shuffle standing.
    //
    // A census of all 104 in-pool printings whose attack text names a shuffle, driven to quiescence
    // on both engines at deck=0, split exactly on that line with no card crossing it in either
    // direction: 30 twinleaf omissions here, and 3 spurious emissions in the mirror (TA-251 below).
    const owed: Array<[string, string, string]> = [
      ['asc-085', 'Ascension', 'sve-005'],           // Misdreavus     — the generator early-return
      ['blk-068', 'Gather Strength', 'sve-001'],     // Axew           — via the shared prefab
      ['dri-127', 'Deceit', 'sve-007'],              // TR's Murkrow   — in reduceEffect
      ['scr-103', 'Knickknack Carrying', 'sve-008'], // Meltan         — the if/else shape
      ['pfl-027', 'Call for Support', 'sve-001'],    // Piplup         — via the shared prefab
    ];
    for (const [printing, name, energy] of owed) {
      const r = step(
        boardKeepingEmptyDeck(
          player({ active: inPlay('A-act', [printing], en(energy, 3, 'a')), deck: [] }),
          player({ active: inPlay('B-act', ['meg-181']) })),
        [attack('A-act', name)],
      );
      expect(`${printing}:${r.status === 'invalidAction'}`).toBe(`${printing}:false`);
      expect(`${printing}:${r.events.some(e => /shuffle/i.test(e.kind))}`).toBe(`${printing}:true`);
    }
  });

  it('a missing DESTINATION outranks B.33: no Bench means no search and no shuffle [TA-250 amendment]', () => {
    // The re-fuzz caught this and the census did not, because every census board had an empty Bench
    // only incidentally. B.33 decides the empty-DECK case; RE-38/RE-32 decides the no-DESTINATION
    // case, and it runs FIRST. Applying B.33 to a "for each of your Benched Pokemon" attack with no
    // Bench does not close the divergence, it flips it — twinleaf started emitting a shuffle that
    // rotomancer correctly withholds.
    //
    // Both cells are asserted per card, because only the PAIR pins the ordering: the bench-occupied
    // cell alone passes for a fix that always shuffles, and the bench-empty cell alone passes for a
    // fix that never does.
    const benchGated: Array<[string, string, string]> = [
      ['blk-039', 'Cellular Ascension', 'sve-005'],  // "For each of your Benched Pokemon, search..."
      ['meg-028', 'Turbo Flare', 'sve-002'],         // "...attach them to your Benched Pokemon"
      ['ssp-007', 'Evo-Powder', 'sve-001'],          // "For each of your Benched Pokemon, search..."
    ];
    for (const [printing, name, energy] of benchGated) {
      const bare = step(
        boardKeepingEmptyDeck(
          player({ active: inPlay('A-act', [printing], en(energy, 4, 'a')), deck: [] }),
          player({ active: inPlay('B-act', ['meg-181']) })),
        [attack('A-act', name)],
      );
      expect(`${printing}/noBench:${bare.events.some(e => /shuffle/i.test(e.kind))}`)
        .toBe(`${printing}/noBench:false`);

      const benched = step(
        boardKeepingEmptyDeck(
          player({ active: inPlay('A-act', [printing], en(energy, 4, 'a')),
                   bench: [inPlay('A-b1', ['asc-004'])], deck: [] }),
          player({ active: inPlay('B-act', ['meg-181']) })),
        [attack('A-act', name)],
      );
      expect(`${printing}/bench:${benched.events.some(e => /shuffle/i.test(e.kind))}`)
        .toBe(`${printing}/bench:true`);
    }
  });

  it('a DEPENDENT-object shuffle is suppressed when its object is empty [TA-251 / B.33]', () => {
    // The mirror of TA-250, and the cell that stops a fix keyed on "empty deck" instead of on the
    // object. Larimar Rain reads "Look at the top 20 cards of your deck ... Shuffle THE OTHER CARDS
    // back into your deck" — an empty deck means the look returned none, so there are no "other
    // cards" and nothing to shuffle (#1979's suppressed consequent).
    //
    // The two cards below it are the in-engine controls: they print the IDENTICAL construction and
    // already emitted nothing, which is what convicted Lapras ex without appealing to rotomancer at
    // all (CF-19: an inconsistently applied convention is a defect whichever form is right).
    // TYPED costs: attaching 4 of one basic energy pays a [C] cost but NOT [W][P][M], and the first
    // draft of this guard did exactly that — both mixed-cost cards came back `invalidAction`, which
    // reads as "the attack was refused" and has nothing to say about shuffling.
    const dependent: Array<[string, string, CardRef[]]> = [
      // Lapras ex, [W][P][M] — the card that was emitting a spurious shuffle
      ['scr-032', 'Larimar Rain', [...en('sve-003', 1, 'aw'), ...en('sve-005', 1, 'ap'), ...en('sve-008', 1, 'am')]],
      // Reuniclus, [C] — control, already correct before the fix
      ['tef-072', 'Summoning Gate', en('sve-005', 2, 'a')],
      // Tatsugiri ex, [R][W][D] — control, already correct before the fix
      ['ssp-142', 'Cinnabar Lure', [...en('sve-002', 1, 'ar'), ...en('sve-003', 1, 'aw'), ...en('sve-007', 1, 'ad')]],
    ];
    for (const [printing, name, energy] of dependent) {
      const r = step(
        boardKeepingEmptyDeck(
          player({ active: inPlay('A-act', [printing], energy), deck: [] }),
          player({ active: inPlay('B-act', ['meg-181']) })),
        [attack('A-act', name)],
      );
      expect(`${printing}:${r.status === 'invalidAction'}`).toBe(`${printing}:false`);
      expect(`${printing}:${r.events.some(e => /shuffle/i.test(e.kind))}`).toBe(`${printing}:false`);
    }
  });

  it('an empty deck WHIFFS a searching attack instead of refusing it [TA-249 / SD-20]', () => {
    // Compendium #361, by name, on the very attack three of these cards print: "Can I use Eevee's
    // 'Call for Family' to search through my deck if I already have four Eevee in play or in the
    // discard pile? — You CAN USE THE ATTACK, but you cannot search your deck." Attack legal, search
    // whiffs. Also #2018 Breezy Gift ("no cards left in my deck? Sure") and #578/#622 (an attack does
    // as much as it can). The three shared deck-search prefabs open with BLOCK_IF_DECK_EMPTY, which
    // is the TRAINER answer (#840/#924, where the whole play would be the search), and an attack
    // calling one inherited it: 7 of the 8 in-pool cards in this class diverged from rotomancer,
    // 6 withheld from the menu and Purrloin offered-then-rejected.
    const searchers: Array<[string, string, string]> = [
      ['asc-049', 'Call for Family', 'sve-004'],   // N's Vanillite  — put onto bench
      ['blk-029', 'Call for Family', 'sve-004'],   // Emolga         — put onto bench
      ['meg-021', 'Call for Family', 'sve-002'],   // Numel          — put onto bench (cost is [R])
      ['por-010', 'Find a Friend', 'sve-001'],     // Rowlet         — put into hand
      ['wht-055', 'Invite Evil', 'sve-007'],       // Purrloin       — put into hand, the offer-then-reject one
    ];
    for (const [printing, name, energy] of searchers) {
      const r = step(
        boardKeepingEmptyDeck(
          player({ active: inPlay('A-act', [printing], en(energy, 3, 'a')), deck: [] }),
          player({ active: inPlay('B-act', ['meg-181']) })),
        [attack('A-act', name)],
      );
      // The attack RESOLVED — it was not refused. `gameOver` is the expected terminal here and is
      // NOT a failure: both decks are empty, so the turn ends into a deck-out. `invalidAction` is
      // the pre-fix status and the only one this asserts against.
      expect(`${printing}:${r.status === 'invalidAction'}`).toBe(`${printing}:false`);
      // ...and the SHUFFLE is still owed. "Then, shuffle your deck." is a separate printed
      // instruction on all of these, not a rider on having found something — and this engine already
      // reads it that way on a stocked deck that finds nothing. The first version of the fix returned
      // early and skipped it, which converged the STATUS and left 12 events-clause divergences behind:
      // status equality is not resolution.
      expect(`${printing}:${r.events.some(e => /shuffle/i.test(e.kind))}`).toBe(`${printing}:true`);
      // ...and the menu offered it in the first place, so the two halves cannot disagree.
      const menu = step(
        boardKeepingEmptyDeck(
          player({ active: inPlay('A-act', [printing], en(energy, 3, 'a')), deck: [] }),
          player({ active: inPlay('B-act', ['meg-181']) })),
        [],
      );
      expect(`${printing}:${(menu.pending?.legalActions ?? [])
        .some(a => a.type === 'declareAttack' && a.name === name)}`).toBe(`${printing}:true`);
    }

    // CONTROL — with a STOCKED deck holding a findable [D] Basic, the search must still RUN and open
    // its choose-cards decision. Without this cell a "fix" that skipped the search unconditionally
    // would pass every assertion above. The deck must contain a legal target: with only filler in it
    // the `min: 0` search self-resolves straight to the shuffle, which is indistinguishable from
    // having been skipped — the first version of this control asserted on exactly that and was green
    // for the wrong reason.
    const withDeck = step(
      board(player({ active: inPlay('A-act', ['wht-055'], en('sve-007', 3, 'a')),
                     deck: [{ iid: 'A-zorua', printing: 'wht-061' }, ...fillerDeck('A', 5)] }),
            player({ active: inPlay('B-act', ['meg-181']) })),
      [attack('A-act', 'Invite Evil')],
    );
    expect(withDeck.pending?.descriptor ?? '').toContain('hoose');
  });

  it('a draw Supporter is not OFFERED when the deck is empty [TA-248 asc-258]', () => {
    // #924: "Can you play Professor Juniper or Fiery Torch, or any draw Trainer, with no cards in
    // your deck? — No, you cannot play a Trainer when it is known that it will have no effect."
    // Cheren's own reduceEffect already threw CANNOT_PLAY_THIS_CARD, correctly; the legalAction
    // enumerator did not consult it and offered the play anyway, so twinleaf offered a Supporter and
    // then refused it. Rotomancer withholds. `trainerPlayable`'s deliberate over-report is now
    // closed by `trainerProbeAccepts`, the Trainer analog of the attack and ability dry-run probes.
    const CHEREN = 'asc-258';
    const emptyDeck = boardKeepingEmptyDeck(
      player({ active: inPlay('A-act', ['meg-181']), hand: [{ iid: 'A-h0', printing: CHEREN }], deck: [] }),
      player({ active: inPlay('B-act', ['meg-181']) }));
    const menu = step(emptyDeck, []);
    expect((menu.pending?.legalActions ?? [])
      .some(a => a.type === 'playSupporter' && a.card === 'A-h0')).toBe(false);
    // And the two halves agree: what is not offered is also not accepted.
    expect(step(emptyDeck, [{ actor: 'A' as const, type: 'playSupporter' as const, card: 'A-h0' }])
      .status).toBe('invalidAction');

    // CONTROL — one card in the deck is enough to make it a real effect, so it must be offered AND
    // accepted. Without this cell a probe that refused every Supporter would pass the two above.
    const oneCard = board(
      player({ active: inPlay('A-act', ['meg-181']), hand: [{ iid: 'A-h0', printing: CHEREN }],
               deck: fillerDeck('A', 1) }),
      player({ active: inPlay('B-act', ['meg-181']) }));
    expect((step(oneCard, []).pending?.legalActions ?? [])
      .some(a => a.type === 'playSupporter' && a.card === 'A-h0')).toBe(true);
    expect(step(oneCard, [{ actor: 'A' as const, type: 'playSupporter' as const, card: 'A-h0' }])
      .status).not.toBe('invalidAction');
  });

  // ── TA-252/253/254 — every `ko` must carry its `damaged` cause ─────────────────────────────────
  // Three members of one family (the TA-132 shape): damage that KO's a Pokemon left no `damaged`
  // event, because the wire projection derives `damaged` by state-diffing and a KO'd Pokemon has no
  // after-state to diff. The reconstruction needs the engine's placement LOGS — so a card that
  // writes `.damage +=` raw (SD-13) starves it, and a multi-KO batch with no deals-log had no
  // attribution rule at all.

  const damagedTotal = (r: ReturnType<typeof step>, target: string): number =>
    r.events.filter(e => e.kind === 'damaged' && (e as { target?: string }).target === target)
      .reduce((s, e) => s + ((e as { hp?: number }).hp ?? 0), 0);
  const koOf = (r: ReturnType<typeof step>, target: string): boolean =>
    r.events.some(e => e.kind === 'ko' && (e as { target?: string }).target === target);

  it('Iron Boulder is a legal FUTURE attach target, and non-Future is not [TA-260 scr-071]', () => {
    // The printed rule-box tag was missing, so 33 in-pool CardTag.FUTURE readers could not see this
    // card. Driven through Miraidon tef-121 "Peak Acceleration" (*"attach them to your Future
    // Pokemon"*), which enumerates its legal targets up front.
    const futureTargets = (benchPrinting: string): string[] => {
      const r = step(
        board(
          player({ active: inPlay('A-act', ['tef-121'], en('sve-004', 1, 'a')),
                   bench: [inPlay('A-b1', [benchPrinting])],
                   deck: [{ iid: 'A-d0', printing: 'sve-004' }, { iid: 'A-d1', printing: 'sve-004' }] }),
          player({ active: inPlay('B-act', ['meg-181']) })),
        [attack('A-act', 'Peak Acceleration')]);
      // The DISTINCT targets: the prompt offers one action per (deck card × legal target), so the
      // raw list repeats a target once per candidate Energy. The target SET is the question.
      return [...new Set((r.pending?.legalActions ?? [])
        .filter(a => a.type === 'attachEnergy')
        .map(a => (a as { target: string }).target))].sort();
    };
    // SUBJECT: the fixed card must now be offered.
    expect(`scr-071:${futureTargets('scr-071').join(',')}`).toBe('scr-071:A-act,A-b1');
    // POSITIVE control — a card that was ALREADY tagged Future. Without it, a fix that offered every
    // bench slot would pass the subject cell.
    expect(`ssp-132:${futureTargets('ssp-132').join(',')}`).toBe('ssp-132:A-act,A-b1');
    // NEGATIVE control — a non-Future Pokemon must still be excluded.
    expect(`asc-004:${futureTargets('asc-004').join(',')}`).toBe('asc-004:A-act');
  });

  it('the Nidoran gender glyph is unspaced, and evolution still resolves [TA-261 dri-114/117]', () => {
    // `evolvesFrom` is a STRING MATCH against `name`, so the printed-orthography fix had to move all
    // four files together. This asserts the pair: the corrected names AND that evolution still works
    // — a rename that fixed the name and broke evolution would pass a name-only assertion.
    const evolves = (basic: string, stage1: string): boolean => {
      const r = step(
        board(
          player({ active: inPlay('A-act', [basic]), hand: [{ iid: 'A-h0', printing: stage1 }] }),
          player({ active: inPlay('B-act', ['meg-181']) })),
        []);
      return (r.pending?.legalActions ?? []).some(a => a.type === 'evolve' && a.card === 'A-h0');
    };
    expect(`female:${evolves('dri-114', 'dri-115')}`).toBe('female:true');
    expect(`male:${evolves('dri-117', 'dri-118')}`).toBe('male:true');
    // NEGATIVE control: the female line must not evolve off the MALE basic (a match-anything
    // evolvesFrom would pass both cells above).
    expect(`mismatch:${evolves('dri-117', 'dri-115')}`).toBe('mismatch:false');
  });

  it('a bench Pokemon KO\'d by placed counters gets its `damaged` in a multi-KO batch [TA-252 twm-130]', () => {
    // Phantom Dive: 200 to the Active (exactly lethal on a pre-damaged Mega Latias ex) + 6 counters
    // to the lone benched Bellsprout (60 HP → also KO'd). The KO batch holds only the placement log
    // — no deals-log, so no "dealer" — and with TWO KO'd the old fallback attributed nothing: the
    // 60 evaporated and asc-004 got a `ko` with no `damaged` at all. Now the placement log is
    // attributed by target name (exactly-one match among the KO'd).
    const r = step(
      board(player({ active: inPlay('A-act', ['twm-130'], [...en(FIRE, 1, 'af'), ...en(PSY, 1, 'ap')]) }),
            player({ active: inPlay('B-act', ['meg-181'], [], 140), bench: [inPlay('B-b1', ['asc-004'])] })),
      [attack('A-act', 'Phantom Dive')],
    );
    expect(damagedTotal(r, 'asc-004')).toBe(60);   // the fixed half: the counters reach the wire
    expect(koOf(r, 'asc-004')).toBe(true);
    expect(damagedTotal(r, 'meg-181')).toBe(200);  // control: the survivor-diff half still works
    expect(koOf(r, 'meg-181')).toBe(true);
  });

  it('Sand Stream\'s lethal Checkup tick emits `damaged` before the `ko` [TA-253 dri-096]', () => {
    // "During Pokemon Checkup ... put 2 damage counters on each of your opponent's Basic Pokemon."
    // The raw `cardList.damage += 20` left no placement log, so the tick that KO'd a benched Basic
    // was invisible — the survivor's tick appeared (state diff) while the lethal one vanished.
    const r = step(
      board(player({ active: inPlay('A-act', ['dri-096']) }),
            player({ active: inPlay('B-act', ['meg-181']), bench: [inPlay('B-b1', ['asc-004'], [], 40)] })),
      [{ actor: 'A' as const, type: 'endTurn' as const }],
    );
    expect(damagedTotal(r, 'asc-004')).toBe(20);   // the fixed half: the lethal tick is visible
    expect(koOf(r, 'asc-004')).toBe(true);
    expect(damagedTotal(r, 'meg-181')).toBe(20);   // control: the surviving Basic's tick, as before
    expect(koOf(r, 'meg-181')).toBe(false);
  });

  it('Gnawing Curse\'s lethal tick emits `damaged` before the `ko` [TA-254 tef-104 / TA-132]', () => {
    // The TA-132 register row verbatim: ability-placed counters on an energy attach, where twinleaf
    // emitted the first ticks (survivor diffs) and dropped exactly the lethal one. Same raw
    // `.damage +=` root as TA-253.
    const gengarBoard: NeutralState = {
      ...board(player({ active: inPlay('A-act', ['tef-104']) }),
               player({ active: inPlay('B-act', ['asc-004'], [], 40), hand: [{ iid: 'B-h0', printing: WATER }] })),
      activePlayer: 'B',
    };
    const r = step(gengarBoard, [{ actor: 'B' as const, type: 'attachEnergy' as const, card: 'B-h0', target: 'B-act' }]);
    expect(damagedTotal(r, 'asc-004')).toBe(20);
    expect(koOf(r, 'asc-004')).toBe(true);
  });
});
