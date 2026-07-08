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
    // whiff to 0. Now it is min:1 (forced): no decline is offered, and completing the discard lands the
    // 170 (KOs the 70-HP defender here). (Twinleaf still surfaces the forced single-card discard as a
    // pending — the known CF-14 twinleaf-side follow-up — so the cross-engine WITH-Grass seed diverges on
    // granularity and only the no-Grass whiff seed conforms; the illegal-decline BUG is what this guards.)
    const start = board(player({
      active: inPlay('A-act', ['sfa-005'], en(GRASS, 1, 'a')),   // attached [G] pays the cost
      hand: [{ iid: 'ah-grass', printing: GRASS }],              // a separate Grass to discard
    }), player({ active: inPlay('B-act', [RALTS]) }));           // 70 HP → 170 KOs
    const r = step(start, [attack('A-act', 'Power Shot')]);
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).not.toContain('confirm');          // no "decline the discard" option (the pre-fix bug)
    expect(types(r)).toContain('discard');              // the discard is forced (min:1)
    const done = step(start, [attack('A-act', 'Power Shot'), { actor: 'A', type: 'discard', target: 'ah-grass' }]);
    expect(types(done)).toContain('takePrize');         // completing the forced discard → 170 → KO → prize
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
});
