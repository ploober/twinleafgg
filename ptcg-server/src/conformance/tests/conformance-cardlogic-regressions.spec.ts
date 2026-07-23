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
    stack: printings.map((p, i) => ({ iid: i === printings.length - 1 ? iid : `${iid}-s${i}`, printing: p })),
    energy, tools: [], damage, conditions, markers: markers(),
  };
}
function fillerDeck(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}-dk${i}`, printing: WATER }));
}
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
    const start = board(
      player({ active: inPlay('A-act', ['sit-059']), bench: [inPlay('A-bench', ['sit-060'])] }),
      player({ active: inPlay('B-act', ['sit-060'], [], 20), bench: [inPlay('B-b0', ['sit-060'])] }),
    );
    const chooseTargets = (r: ReturnType<typeof step>): string[] =>
      (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'choose').map(a => (a as { target: string }).target);

    const menu = step(start, [{ actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Painful Spoons' }]);
    const sources = chooseTargets(menu);
    expect(sources).toContain('B-act');       // the opponent's DAMAGED Pokemon is the legal source
    expect(sources).not.toContain('A-act');   // pre-fix bug: offered the user's own Radiant Alakazam
    expect(sources).not.toContain('A-bench'); // and the user's own benched Drowzee

    // The full move relocates one counter on the opponent's side (b-active 20->10, b-bench 0->10):
    const moved = step(start, [
      { actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Painful Spoons' },
      { actor: 'A', type: 'choose', target: 'B-act' },
      { actor: 'A', type: 'placeCounter', target: 'B-b0' },
      { actor: 'A', type: 'confirm', value: false },   // endChoice: close the "up to 2" move
    ]);
    expect(moved.state.players.B.active!.damage).toBe(10);
    expect(moved.state.players.B.bench[0].damage).toBe(10);
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
    const attachCards = (r: ReturnType<typeof step>): string[] =>
      (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'attachEnergy').map(a => (a as { card: string }).card);

    const menu = step(boardOf(), [attack('A-act', 'Cold Cyclone')]);
    expect(menu.status).toBe('awaitingAction');
    expect(attachCards(menu)).toContain('ae2');   // the Splash Energy is offered as a movable [W] Energy

    // And the full move (Splash + a basic Water, min=max=2) relocates the Splash onto the [W] bench:
    const moved = step(boardOf(), [
      attack('A-act', 'Cold Cyclone'),
      { actor: 'A', type: 'attachEnergy', card: 'ae2', target: 'A-b0' },
      { actor: 'A', type: 'attachEnergy', card: 'ae0', target: 'A-b0' },
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

    // …and it still resolves when used (attach the Lightning from discard onto the bench):
    const used = step(start, [
      { actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Delta Charge' },
      { actor: 'A', type: 'attachEnergy', card: 'A-disc0', target: 'A-b0' },
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
});
