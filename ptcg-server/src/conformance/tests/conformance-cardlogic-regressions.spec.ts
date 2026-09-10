import { step, replay } from '../driver';
import { importState } from '../state-adapter';
import { SuperType } from '../../game/store/card/card-types';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

// CF-60: damaged/ko now name the affected Pokemon by its shared, seeded basic `iid`, not the printing.
// These guards assert per-PRINTING facts, so resolve each event's iid target back to its basic printing
// via the response state (a KO'd Pokemon's basic card is still present in discard/hand). Lossless here —
// every board below uses distinct printings per side — and it also proves the iid resolves to a real card.
function basicPrintingByIid(state: NeutralState, iid: string | undefined): string | undefined {
  if (!iid) { return undefined; }
  for (const p of ['A', 'B'] as const) {
    const side = state.players[p];
    for (const slot of [side.active, ...side.bench]) {
      if (slot) { for (const c of slot.stack) { if (c.iid === iid) { return slot.stack[0].printing; } } }
    }
    for (const zone of [side.hand, side.deck, side.discard, side.lostZone]) {
      for (const c of zone) { if (c.iid === iid) { return c.printing; } }
    }
    for (const pc of side.prizes) { if (pc.iid === iid) { return pc.printing; } }
  }
  return undefined;
}

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

  it('Energy Search Pro "Then, shuffle your deck" fires after the search resolves [TA-320 ssp-176]', () => {
    // ACE SPEC Item: "Search your deck for any number of Basic Energy cards of different types … put
    // them into your hand. Then, shuffle your deck." A deck with NO Basic Energy is a zero-take
    // (min 0), so the search whiffs — but the shuffle is still mandatory (like TA-53 Mareep). Pre-fix
    // the ChooseCardsPrompt callback never called next(), so the generator stayed suspended at the
    // choose yield and the trailing `return store.prompt(ShuffleDeckPrompt)` was never reached: the
    // deck was left UNSHUFFLED (rotomancer shuffled; a public search leaked the order). next() fixes it.
    const r = step(
      board(player({ active: inPlay('A-act', [RALTS]),
                     hand: [{ iid: 'A-esp', printing: 'ssp-176' }],
                     deck: [{ iid: 'A-d0', printing: RALTS }, { iid: 'A-d1', printing: RALTS },
                            { iid: 'A-d2', printing: RALTS }, { iid: 'A-d3', printing: RALTS }] }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [{ actor: 'A' as const, type: 'playItem' as const, card: 'A-esp' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
  });

  it('Drilbur "Dig Dig Dig" shuffles even on a zero-take once the ability is used [TA-321 tef-085]', () => {
    // On-play-to-Bench ability: "you may search your deck for up to 3 Basic [F] Energy … and discard
    // them. Then, shuffle your deck." With NO Basic Fighting Energy in the deck the search is a
    // zero-take, but once the player USES the ability (confirm true) the shuffle is mandatory — you
    // may voluntarily fail the deck search but you still searched (compendium #2171; cf. TA-53/TA-56).
    // Pre-fix an `if (cards.length === 0) return state` early-returned on the zero-take, leaving the
    // deck UNSHUFFLED (rotomancer shuffled). Declining (confirm false) still shuffles nothing — that
    // path is untouched.
    const r = step(
      board(player({ active: inPlay('A-act', [RALTS]),
                     hand: [{ iid: 'A-dril', printing: 'tef-085' }],
                     deck: [{ iid: 'A-d0', printing: RALTS }, { iid: 'A-d1', printing: RALTS },
                            { iid: 'A-d2', printing: RALTS }, { iid: 'A-d3', printing: RALTS }] }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [{ actor: 'A' as const, type: 'benchBasic' as const, card: 'A-dril' },
       { actor: 'A' as const, type: 'confirm' as const, value: true }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
  });

  it('Secret Box shuffles the deck even when the four-type search takes nothing [TA-322 twm-163]', () => {
    // ACE SPEC Item: "… discard 3 other cards from your hand. Search your deck for an Item card, a
    // Pokémon Tool card, a Supporter card, and a Stadium card, reveal them, and put them into your
    // hand. Then, shuffle your deck." A deck with NONE of the four types caps the search at count 0
    // (and the prompt is min:0, so a voluntary fail is legal too) — either way you SEARCHED the deck,
    // so the shuffle is mandatory (compendium #2171; same family as TA-53/TA-320/TA-321). Pre-fix an
    // `if (cards.length === 0) return state` early-returned on the zero-take, leaving the deck
    // UNSHUFFLED (rotomancer shuffled; a public four-type search leaked the order). The discard-3 is
    // forced (exactly 3 other cards) so it auto-resolves; the search then whiffs to the shuffle.
    const r = step(
      board(player({ active: inPlay('A-act', [RALTS]),
                     hand: [{ iid: 'A-sb', printing: 'twm-163' },
                            { iid: 'A-h1', printing: WATER }, { iid: 'A-h2', printing: FIRE },
                            { iid: 'A-h3', printing: PSY }],
                     deck: [{ iid: 'A-d0', printing: RALTS }, { iid: 'A-d1', printing: RALTS },
                            { iid: 'A-d2', printing: RALTS }, { iid: 'A-d3', printing: RALTS }] }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [{ actor: 'A' as const, type: 'playItem' as const, card: 'A-sb' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
  });

  it('Silvally "Call a Buddy" is usable (and shuffles) when the deck holds no Supporter [TA-323 pbl-070]', () => {
    // "Once during your turn, if you have no cards in your hand, you may use this Ability. Search your
    // deck for a Supporter card … Then, shuffle your deck." A non-empty deck with NO Supporter is a
    // legal whiff: compendium #990 ("you can search for energy cards even if you know you won\'t find
    // them … they can be searched for") + #903; only an EMPTY deck blocks the search (#840). Pre-fix a
    // `blocked.length >= deck.length` guard threw CANNOT_USE_POWER (and the prompt was min:1), so the
    // ability was NOT OFFERED at all when no Supporter was present — twinleaf sat on `endTurn` while
    // rotomancer offered it and shuffled. Fix: drop the guard, relax to min:0; the callback already
    // shuffles unconditionally. Empty-hand + non-empty no-Supporter deck now offers the ability and
    // whiffs to the shuffle.
    const r = step(
      board(player({ active: inPlay('A-act', ['pbl-070']),
                     hand: [],
                     deck: [{ iid: 'A-d0', printing: RALTS }, { iid: 'A-d1', printing: RALTS },
                            { iid: 'A-d2', printing: RALTS }, { iid: 'A-d3', printing: RALTS }] }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [{ actor: 'A' as const, type: 'useAbility' as const, source: 'A-act', ability: 'Call a Buddy' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
  });

  it('Telepathic Psychic Energy shuffles after the on-attach search even on a zero-take [TA-324 por-088]', () => {
    // Special Energy: "When you attach this card from your hand to a [P] Pokémon, search your deck for
    // up to 2 Basic [P] Pokémon and put them onto your Bench. Then, shuffle your deck." A deck with NO
    // Basic Psychic Pokémon (energy filler) is a zero-take, but the search still EXECUTED (deck
    // non-empty, Bench has room), so the shuffle is owed (B.33/#2171; family of TA-320/TA-322). Pre-fix
    // an `if (validPokemon.length === 0) return state` early-returned on the zero-FIND and dropped the
    // shuffle (rotomancer shuffled). The bench-full / empty-deck skips (#1108/#840) are preserved.
    const r = step(
      board(player({ active: inPlay('A-act', [RALTS]),
                     hand: [{ iid: 'A-e', printing: 'por-088' }],
                     deck: [{ iid: 'A-d0', printing: WATER }, { iid: 'A-d1', printing: FIRE },
                            { iid: 'A-d2', printing: PSY }, { iid: 'A-d3', printing: WATER }] }),
            player({ active: inPlay('B-act', [RALTS]) })),
      [{ actor: 'A' as const, type: 'attachEnergy' as const, card: 'A-e', target: 'A-act' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
  });

  it('Sacred Ash is playable with as few as ONE Pokémon in the discard [TA-325 dri-168]', () => {
    // "Shuffle up to 5 Pokémon from your discard pile into your deck." On a Trainer "up to X" is a
    // 1..X range (compendium #2301), so ONE Pokémon in the discard is enough to play it. Pre-fix
    // `canPlay` demanded `pokemonInDiscard >= 5` and refused a legal 1..4 play (rotomancer played it);
    // an empty-of-Pokémon discard is still a zero-count no-op and correctly unplayable (B.36). One
    // Pokémon in discard forces the min:1/max:1 move, which auto-resolves to the mandatory shuffle.
    const r = step(
      board(player({ active: inPlay('A-act', [RALTS]),
                     hand: [{ iid: 'A-sa', printing: 'dri-168' }],
                     discard: [{ iid: 'A-x0', printing: RALTS }],
                     deck: [{ iid: 'A-d0', printing: WATER }, { iid: 'A-d1', printing: FIRE }] }),
            player({ active: inPlay('B-act', [RALTS]) })),
      // playItem is ACCEPTED (the canPlay fix), then the single eligible Pokémon is moved to the deck,
      // reaching the mandatory shuffle. Pre-fix the play was refused outright (`invalidAction`) with
      // < 5 in discard. 2026-09-09 (TA-401): the move pick no longer carries a decline (a played
      // Trainer's 1..5 is forced), so the lone candidate collapses and a recorded `choose` would be
      // SURPLUS — the play alone reaches the shuffle.
      [{ actor: 'A' as const, type: 'playItem' as const, card: 'A-sa' }],
    );
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
  });

  it('Special Red Card is withheld when the opponent has an empty hand [TA-326 cri-082]', () => {
    // "Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any
    // cards on the bottom of their deck in this way, they draw 3 cards." With an EMPTY opponent hand
    // the whole effect does nothing (the draw is conditional, exactly Grand Wing #2306), and a
    // Trainer cannot be played for no effect — compendium #2365 rules this card directly (modern
    // line, B.41/B.36). Opponent hand SIZE is public, so a zero is a provable no-op. Pre-fix `canPlay`
    // gated only on the Prize count and offered the card on an empty opponent hand (rotomancer withheld).
    const oppPrizes = [0, 1, 2].map(i => ({ iid: `B-pz${i}`, printing: WATER, faceUp: false }));
    const offers = (oppHand: { iid: string; printing: string }[]) => {
      const r = step(
        board(player({ active: inPlay('A-act', [RALTS]),
                       hand: [{ iid: 'A-src', printing: 'cri-082' }],
                       deck: [{ iid: 'A-d0', printing: WATER }] }),
              player({ active: inPlay('B-act', [RALTS]), hand: oppHand,
                       prizes: oppPrizes, deck: [{ iid: 'B-d0', printing: WATER }] })),
        []);
      return (r.pending?.legalActions ?? []).some(a =>
        (a as { type: string }).type === 'playItem' && (a as { card?: string }).card === 'A-src');
    };
    expect(offers([])).toBe(false);                                  // empty opp hand -> withheld
    expect(offers([{ iid: 'B-h0', printing: WATER }])).toBe(true);   // 1-card opp hand -> offered
  });

  it('Heliolisk "Frilled Generator" is offered (and shuffles) only after Canari is played this turn [TA-327 asc-064]', () => {
    // "Once during your turn, if you played Canari from your hand this turn, you may use this Ability.
    // Search your deck for up to 2 Basic Lightning Energy cards and attach them to this Pokémon. Then,
    // shuffle your deck." Frilled Generator is a PLAYER-ACTIVATED in-play ability ("you may use this
    // Ability"), gated on player.playedCanari — which Canari (asc-185) sets when played from hand.
    // Pre-fix the power decl omitted `useWhenInPlay: true`, so legal-actions.ts:517 dropped it from
    // the menu and it was NEVER offered, even after Canari was played this turn: twinleaf sat on
    // `endTurn` while rotomancer offered it and shuffled. The `abilityProbeAccepts` dry-run already
    // gates the offer on playedCanari, so with the flag added the ability is offered ONLY after
    // Canari, and its up-to-2 Basic Lightning search then the mandatory shuffle fire (owed even on a
    // zero-take, B.33/#2171). A 1-card deck makes both Canari's and Frilled Generator's shuffles the
    // forced-order (<=1) auto-shuffle (CF-11), so each emits a `shuffled` event with no order needed.
    const start = board(player({ active: inPlay('A-act', ['asc-064']),
                                 hand: [{ iid: 'A-can', printing: 'asc-185' },
                                        { iid: 'A-sp', printing: WATER }] }),
                        player({ active: inPlay('B-act', [RALTS]) }));
    // Boundary control (baseline-differs-by-ONE-change): before Canari, the playedCanari gate is
    // unmet, so the ability is NOT offered — the fix does not blanket-offer it.
    expect(types(step(start, []))).not.toContain('useAbility');
    // Playing Canari (its own discard + [L]-Pokemon search + shuffle auto-resolve on a 1-card deck)
    // now OPENS the offer — pre-fix this menu was `endTurn` only (the bug).
    const afterCanari = step(start, [{ actor: 'A' as const, type: 'playSupporter' as const, card: 'A-can' }]);
    expect(afterCanari.status).toBe('awaitingAction');
    expect(types(afterCanari)).toContain('useAbility');
    // Using it fires the owed second shuffle: Canari's shuffle + Frilled Generator's shuffle = 2.
    const used = step(start, [
      { actor: 'A' as const, type: 'playSupporter' as const, card: 'A-can' },
      { actor: 'A' as const, type: 'useAbility' as const, source: 'A-act', ability: 'Frilled Generator' },
    ]);
    expect(used.status).toBe('awaitingAction');
    expect(used.events.filter(e => e.kind === 'shuffled').length).toBe(2);
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

  it('a DEPENDENT-object shuffle is suppressed on a STOCKED deck when the object empties [TA-251 reopened / B.33]', () => {
    // The reopening: the shipped fix guarded on `deck.length === 0`, but the rule keys on the OBJECT
    // — "shuffle THE OTHER cards" — and the two axes come apart on a STOCKED deck whose looked-at
    // cards all leave. The empty-deck cell above cannot see it: reverting that guard reds the same
    // deck=0 cell it was written for, so a mutation test there proves nothing about this one. Each
    // card is asserted as a PAIR — object-empty (no cards go back -> NO shuffle) and object-nonempty
    // (some go back -> shuffle) — because only the pair pins the object axis: the empty cell alone
    // passes a fix that never shuffles, the nonempty cell alone passes one that always does.
    //
    // "shuffle owed" = a `shuffled` event fired OR a `shuffle` system decision is pending. The
    // driver only auto-emits `shuffled` when the returning deck is <=1 card (a forced order, CF-11);
    // with more it SURFACES the shuffle pending and stops without the event (line ~728). So the
    // event alone is not the observable — the pending is the other half, and both mean the shuffle
    // is happening. Object-empty must show NEITHER.
    const shuffleOwed = (r: ReturnType<typeof step>): boolean =>
      r.events.some(e => /shuffle/i.test(e.kind)) ||
      (r.pending?.legalActions ?? []).some(a => (a as { type: string }).type === 'shuffle');

    // Lapras ex — "Look at the top 20 ... attach any number of Energy ... Shuffle THE OTHER cards
    // back." Deck is two Basic Energy; attaching BOTH empties the object on a deck that was NEVER
    // empty. Attaching ONE leaves one "other card" and must still shuffle.
    const lapEnergy = [...en('sve-003', 1, 'aw'), ...en('sve-005', 1, 'ap'), ...en('sve-008', 1, 'am')];
    const lapBoard = () => board(
      player({ active: inPlay('A-act', ['scr-032'], lapEnergy),
               deck: [{ iid: 'A-d0', printing: 'sve-003' }, { iid: 'A-d1', printing: 'sve-005' }] }),
      player({ active: inPlay('B-act', ['meg-181']) }));
    const att = (card: string) => ({ actor: 'A' as const, type: 'attachEnergy' as const, card, target: 'A-act' });
    const decline = { actor: 'A' as const, type: 'confirm' as const, value: false };

    const lapBoth = step(lapBoard(), [attack('A-act', 'Larimar Rain'), att('A-d0'), att('A-d1')]);
    expect(`scr-032/objEmpty:invalid=${lapBoth.status === 'invalidAction'}`).toBe('scr-032/objEmpty:invalid=false');
    expect(`scr-032/objEmpty:owed=${shuffleOwed(lapBoth)}`).toBe('scr-032/objEmpty:owed=false');

    const lapOne = step(lapBoard(), [attack('A-act', 'Larimar Rain'), att('A-d0'), decline]);
    expect(`scr-032/objFull:invalid=${lapOne.status === 'invalidAction'}`).toBe('scr-032/objFull:invalid=false');
    expect(`scr-032/objFull:owed=${shuffleOwed(lapOne)}`).toBe('scr-032/objFull:owed=true');

    // Iron Thorns — "Reveal the top 5 ... discard the revealed Future cards and shuffle THE OTHER
    // cards back." Both in-pool printings. Top-5 all Future empties the object; a mix leaves the
    // non-Future cards to shuffle back. Destructo-Press is forced, so one step resolves it. B is the
    // 210-HP tanky so the mixed control's 140 does not KO and the walk reaches the shuffle pending.
    for (const printing of ['tef-062', 'svp-098']) {
      const itEnergy = [...en('sve-004', 1, 'al'), ...en('sve-003', 1, 'ac')];
      const allFuture = step(
        board(player({ active: inPlay('A-act', [printing], itEnergy),
                       deck: Array.from({ length: 5 }, (_, i) => ({ iid: `A-f${i}`, printing })) }),
              player({ active: inPlay('B-act', [TANKY]) })),
        [attack('A-act', 'Destructo-Press')]);
      expect(`${printing}/objEmpty:invalid=${allFuture.status === 'invalidAction'}`).toBe(`${printing}/objEmpty:invalid=false`);
      expect(`${printing}/objEmpty:owed=${shuffleOwed(allFuture)}`).toBe(`${printing}/objEmpty:owed=false`);

      const mixed = step(
        board(player({ active: inPlay('A-act', [printing], itEnergy),
                       deck: [{ iid: 'A-f0', printing }, { iid: 'A-f1', printing },
                              { iid: 'A-e0', printing: 'sve-003' }, { iid: 'A-e1', printing: 'sve-003' },
                              { iid: 'A-e2', printing: 'sve-003' }] }),
              player({ active: inPlay('B-act', [TANKY]) })),
        [attack('A-act', 'Destructo-Press')]);
      expect(`${printing}/objFull:invalid=${mixed.status === 'invalidAction'}`).toBe(`${printing}/objFull:invalid=false`);
      expect(`${printing}/objFull:owed=${shuffleOwed(mixed)}`).toBe(`${printing}/objFull:owed=true`);
    }

    // Tatsugiri (twm-131) "Attract Customers" — an ABILITY that looks at the top 6, may put a
    // Supporter into hand, then "Shuffle THE OTHER cards back." The census found it MISSING the
    // shuffle whenever a Supporter WAS taken (the reveal branch returned without shuffling) while
    // still owing it — the TA-250 direction hiding inside the same B.33 family, and rotomancer
    // shuffles. object-nonempty (five others after the take) must shuffle; object-empty (a lone
    // Supporter looked at and taken) must not. A Supporter must sit in the top 6 for the take.
    const SUPP = 'asc-182';
    const tatBoard = (deck: CardRef[]) => board(
      player({ active: inPlay('A-act', ['twm-131']), deck }),
      player({ active: inPlay('B-act', ['meg-181']) }));
    const useAbil = { actor: 'A' as const, type: 'useAbility' as const, source: 'A-act', ability: 'Attract Customers' };
    const choose = (t: string) => ({ actor: 'A' as const, type: 'choose' as const, target: t });

    const tatFive = step(tatBoard([{ iid: 'A-s', printing: SUPP },
      ...Array.from({ length: 5 }, (_, i) => ({ iid: `A-o${i}`, printing: 'sve-003' }))]),
      [useAbil, choose('A-s')]);
    expect(`twm-131/objFull:invalid=${tatFive.status === 'invalidAction'}`).toBe('twm-131/objFull:invalid=false');
    expect(`twm-131/objFull:owed=${shuffleOwed(tatFive)}`).toBe('twm-131/objFull:owed=true');

    const tatLone = step(tatBoard([{ iid: 'A-s', printing: SUPP }]), [useAbil, choose('A-s')]);
    expect(`twm-131/objEmpty:invalid=${tatLone.status === 'invalidAction'}`).toBe('twm-131/objEmpty:invalid=false');
    expect(`twm-131/objEmpty:owed=${shuffleOwed(tatLone)}`).toBe('twm-131/objEmpty:owed=false');

    // no Supporter in the top 6: nothing taken, all six are "other cards" -> shuffle owed via the
    // else branch (already correct before the fix, kept as the third leg of the object axis).
    const tatSix = step(tatBoard(Array.from({ length: 6 }, (_, i) => ({ iid: `A-o${i}`, printing: 'sve-003' }))), [useAbil]);
    expect(`twm-131/noSupp:invalid=${tatSix.status === 'invalidAction'}`).toBe('twm-131/noSupp:invalid=false');
    expect(`twm-131/noSupp:owed=${shuffleOwed(tatSix)}`).toBe('twm-131/noSupp:owed=true');
  });

  it('a set-shuffle emits ONE shuffled event, not one per member [TA-251-adjacent / ssp-086]', () => {
    // Found by the dependent-object census. Sylveon ex "Angelite" — "Choose 2 of your opponent's
    // Benched Pokemon. Shuffle THOSE Pokemon and all attached cards into your opponent's deck." —
    // is ONE shuffle of a set, but the ShuffleDeckPrompt sat inside the per-target forEach, so
    // choosing 2 emitted TWO `shuffled` events where rotomancer emits ONE (a multiset-count
    // divergence). This is the multiplicity sibling of the B.33 suppression family, not a
    // suppression case — the shuffle is owed, just once.
    //
    // The opponent deck is left with >1 card so the shuffle SURFACES as a system decision rather
    // than auto-resolving (CF-11), then each pending is resolved with its advertised order; the
    // count of `shuffled` events across the settled walk is the observable. Pre-fix: 2. Fixed: 1.
    const settleCountingShuffles = (b: NeutralState, actions: NeutralAction[]): number => {
      const acts: NeutralAction[] = actions.map(a => ({ ...a }));
      for (let i = 0; i < 10; i++) {
        const r = step(b, acts);
        if (r.status === 'invalidAction') { return -1; }
        const la = r.pending?.legalActions ?? [];
        const sh = la.find(a => (a as { type: string }).type === 'shuffle') as { deck?: string[] } | undefined;
        if (sh === undefined) { return r.events.filter(e => /shuffle/i.test(e.kind)).length; }
        acts.push({ actor: 'system', type: 'shuffle', order: sh.deck ?? [] } as unknown as NeutralAction);
      }
      throw new Error('ssp-086 guard did not settle');
    };
    const count = settleCountingShuffles(
      board(
        player({ active: inPlay('A-act', ['ssp-086'],
          [...en('sve-003', 1, 'aw'), ...en('sve-004', 1, 'al'), ...en('sve-005', 1, 'ap')]) }),
        player({ active: inPlay('B-act', ['meg-181']),
          bench: [inPlay('B-b0', ['por-063']), inPlay('B-b1', ['asc-136'])],
          deck: [{ iid: 'B-d0', printing: 'sve-003' }, { iid: 'B-d1', printing: 'sve-003' }] })),
      // 2026-09-09 (TA-390): "Choose 2" is pinned min === max === min(2, benched); with exactly two
      // Benched the second pick is forced and collapses after the first, so a recorded second
      // `choose` would be surplus (invalidAction) — one pick settles the set.
      [attack('A-act', 'Angelite'),
       { actor: 'A', type: 'choose', target: 'B-b0' }]);
    expect(`ssp-086/shuffleCount:${count}`).toBe('ssp-086/shuffleCount:1');
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
    r.events.filter(e => e.kind === 'damaged'
        && basicPrintingByIid(r.state, (e as { target?: string }).target) === target)
      .reduce((s, e) => s + ((e as { hp?: number }).hp ?? 0), 0);
  const koOf = (r: ReturnType<typeof step>, target: string): boolean =>
    r.events.some(e => e.kind === 'ko'
        && basicPrintingByIid(r.state, (e as { target?: string }).target) === target);

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

  // ── TA-318 — the diff-based `damaged` projection mis-reports two shapes (state stays correct) ──
  // Both surfaced as pure `[events]` DIVERGENCE rows in the 2026-08-23 fuzz corpus (558 + 104 occ);
  // the game STATE converges on both engines, only the intermediate `damaged` stream diverged.

  it('a spread attack that KOs the Active AND a Bench Pokemon attributes each hit to its own target [TA-318(a) ssp-119]', () => {
    // Obsidian: base 130 to the Active (lethal on a Mega Latias ex pre-damaged to 200 ⇒ 330 HP) plus
    // a post-damage rider dealing 130 to a Benched Pokemon (Erika's Bellsprout, also KO'd). Both KO
    // in the SAME dispatch, whose only deals-log names the BENCH — the base hit was already emitted
    // when the Active rose to 330 as a survivor in the prior dispatch. The old multi-KO fallback piled
    // the bench 130 onto the opponent's-active KO'd (`meg-181` ⇒ 260, `asc-004` a `ko` with no
    // `damaged`); the deals-log target NAME attributes it to `asc-004` (the same TA-252 rule the
    // counter branch uses). Darkness = sve-007.
    const r = step(
      board(player({ active: inPlay('A-act', ['ssp-119'], [...en(PSY, 1, 'p'), ...en('sve-007', 1, 'd'), ...en(METAL, 1, 'm'), ...en(WATER, 1, 'c')]) }),
            player({ active: inPlay('B-act', ['meg-181'], [], 200), bench: [inPlay('B-b1', ['asc-004'])] })),
      [attack('A-act', 'Obsidian')],
    );
    expect(damagedTotal(r, 'asc-004')).toBe(130);  // the fixed half: the bench hit reaches its OWN target
    expect(koOf(r, 'asc-004')).toBe(true);
    expect(damagedTotal(r, 'meg-181')).toBe(130);  // control: the Active's own lethal hit, NOT 260
    expect(koOf(r, 'meg-181')).toBe(true);
  });

  it('a moved damage counter is NOT a `damaged` event on the recipient [TA-318(b) twm-082]', () => {
    // Strange Hacking relocates a counter by mutating `.damage` directly with NO damage log, so a
    // diff sees the recipient's HP rise and would emit a spurious `damaged` (rotomancer, which LOGS
    // damage, emits none — relocating a counter is not damage). Board: A Alakazam; B Active `meg-181`
    // carrying one counter (10) and one benched `asc-004`. The forced single transfer moves the
    // counter Active→Bench (the destination step collapses, TA-239). STATE must show the move; the
    // recipient must get NO `damaged`.
    const r = step(
      board(player({ active: inPlay('A-act', ['twm-082'], en(PSY, 1, 'p')) }),
            player({ active: inPlay('B-act', ['meg-181'], [], 10), bench: [inPlay('B-b1', ['asc-004'])] })),
      [attack('A-act', 'Strange Hacking'), { actor: 'A' as const, type: 'choose' as const, target: 'B-act' }],
    );
    // the move landed: Active lost its counter, the Bench gained it
    expect((r.state as NeutralState).players.B.active?.damage).toBe(0);
    expect((r.state as NeutralState).players.B.bench[0]?.damage).toBe(10);
    // ...and NO spurious `damaged` on the recipient (nor anywhere — a relocation deals no damage)
    expect(damagedTotal(r, 'asc-004')).toBe(0);
    expect(koOf(r, 'asc-004')).toBe(false);
  });

  it('Perrin "search for up to that many" lets the player take just 1 of 2 revealed [TA-319 twm-160, #2301]', () => {
    // Compendium #2301 asymmetry (the Trainer-side companion to Minccino above): on a Trainer card
    // "up to X" is 1..max, NOT exactly-max. Perrin reveals up to 2 Pokemon to the deck, then "search
    // your deck for up to that many Pokemon". The search prompt declared { min: minMax, max: minMax },
    // so with 2 revealed the range collapsed to 2..2 and forced the player to take BOTH -- there was
    // no way to take just 1. Fix: min:1 (max stays minMax). (rotomancer mirrors the opposite error --
    // it offers a 0-take here -- which is RE-134, adjudicated roto-side.) Erika's Bellsprout asc-004
    // is the Pokemon; both hand copies are revealed so minMax = 2.
    const bd = () => {
      const A = player({
        active: inPlay('A-act', [RALTS]),
        hand: [{ iid: 'A-perrin', printing: 'twm-160' }, { iid: 'A-bell1', printing: 'asc-004' }, { iid: 'A-bell2', printing: 'asc-004' }],
        deck: [{ iid: 'A-dk0', printing: 'asc-004' }, { iid: 'A-dk1', printing: 'asc-004' }, { iid: 'A-dk2', printing: 'asc-004' }],
      });
      const B = player({ active: inPlay('B-act', [RALTS]) });
      return board(A, B);
    };
    const play = { actor: 'A' as const, type: 'playSupporter' as const, card: 'A-perrin' };
    const toDeck = [
      { actor: 'A' as const, type: 'choose' as const, target: 'A-bell1' },
      { actor: 'A' as const, type: 'choose' as const, target: 'A-bell2' },
    ];

    // (a) the search surfaces with a mandatory FIRST pick: min:1 offers no stop at 0 picks.
    const rSearch0 = step(bd(), [play, ...toDeck]);
    expect(rSearch0.status).toBe('awaitingAction');
    expect(types(rSearch0)).toContain('choose');
    expect(types(rSearch0)).not.toContain('confirm');            // min-1 floor: cannot take 0
    const searchPicks = (rSearch0.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'choose');
    expect(searchPicks.length).toBeGreaterThanOrEqual(2);        // 3 in deck + 2 just revealed

    // (b) THE fix: after ONE pick the stop appears (1..2 is the real range) and a 2nd pick is still
    //     offered. Pre-fix (min:minMax=2) no stop surfaced here -- the player was forced to take 2.
    const rAfter1 = step(bd(), [play, ...toDeck, searchPicks[0] as never]);
    expect(types(rAfter1)).toContain('confirm');                 // can stop at 1
    expect(types(rAfter1)).toContain('choose');                  // can still take the 2nd (max:2)

    // (c) taking exactly 1 lands exactly one Pokemon in hand -- the whole flow carries the floor.
    const rTake1 = step(bd(), [play, ...toDeck, searchPicks[0] as never,
      { actor: 'A' as const, type: 'confirm' as const, value: false }]);
    expect(rTake1.state.players.A.hand.length).toBe(1);
    expect(rTake1.state.players.A.hand[0].printing).toBe('asc-004');
  });

  it('Pidove "Emergency Evolution" shuffles the deck after the search [TA-250 / B.33 tef-133]', () => {
    // "...search your deck for an Unfezant ... Then, shuffle your deck." The bespoke reduceEffect
    // moved the found card and evolved, but NEVER shuffled -- rotomancer emits `shuffled`, twinleaf
    // emitted nothing (SD-20 / B.33: the "Then, shuffle your deck" is a SEPARATE printed instruction,
    // owed on every path -- the shared search/attach prefabs shuffle unconditionally, this bespoke
    // ability did not). Pidove HP 50 with 20 damage = 30 remaining, satisfying the HP<=30 gate; the
    // single Unfezant (tef-135) in the deck collapses the min:0/max:1 search, so the lone useAbility
    // action drives to quiescence.
    // Drive the DECLINE path (confirm:false at the min:0 search): the shuffle is owed even when NO
    // card is taken, so this cell fails a fix that only shuffled after a successful find.
    const r = step(
      board(
        player({ active: inPlay('A-act', ['tef-133'], [], 20), deck: [{ iid: 'A-unfz', printing: 'tef-135' }] }),
        player({ active: inPlay('B-act', [RALTS]) }),
      ),
      [
        { actor: 'A' as const, type: 'useAbility' as const, source: 'A-act', ability: 'Emergency Evolution' },
        { actor: 'A' as const, type: 'confirm' as const, value: false },
      ],
    );
    expect(r.events.some(e => e.kind === 'abilityUsed')).toBe(true);
    expect(`tef-133:${r.events.some(e => /shuffle/i.test(e.kind))}`).toBe('tef-133:true');
  });

  it('Serperior ex "Regal Cheer" +20 is applied BEFORE Weakness [TA-268 / blk-003]', () => {
    // Regal Cheer: "Attacks used by your Pokemon do 20 more damage ... (before applying Weakness and
    // Resistance)." Charmander asc-020 Fire Claws (base 30) into a FIRE-WEAK defender twm-025 (x2):
    // printed arithmetic is (30+20)x2 = 100. Twinleaf produced 80 = 30x2+20 -- the boost was hooked
    // on PutDamageEffect (AFTER weakness) instead of DealDamageEffect. The multiplier is the whole
    // discriminator, so all three cells share one board and vary only the defender / Serperior.
    const charmander = (bench: PokemonInPlay[], defender: string) =>
      board(player({ active: inPlay('A-act', ['asc-020'], en(FIRE, 2, 'a')), bench }),
            player({ active: inPlay('B-act', [defender]) }));
    const SERP = inPlay('A-serp', ['blk-003']);   // Stage 2 sits in play; Regal Cheer is passive

    // (1) Fire-weak defender, Serperior in play: +20 lands before the x2.
    const weak = step(charmander([SERP], 'twm-025'), [attack('A-act', 'Fire Claws')]);
    expect(weak.state.players.B.active!.damage).toBe(100);

    // (2) NON-weak defender (RALTS), Serperior in play: (30+20) with no multiplier = 50, unchanged by
    // the fix -- proving it moved only the weakness case, not the magnitude of the boost.
    const flat = step(charmander([SERP], RALTS), [attack('A-act', 'Fire Claws')]);
    expect(flat.state.players.B.active!.damage).toBe(50);

    // (3) Fire-weak defender, NO Serperior: 30x2 = 60. Isolates the +20 to the ability, so a fix that
    // over-applied (e.g. added twice) would red here.
    const noSerp = step(charmander([], 'twm-025'), [attack('A-act', 'Fire Claws')]);
    expect(noSerp.state.players.B.active!.damage).toBe(60);
  });

  it('Redeemable Ticket draws new prizes from the TOP of the deck, old prizes to the BOTTOM [TA-328 jtg-156]', () => {
    // "Count your Prize cards and shuffle them face down, then put them at the bottom of your deck.
    // If you do, add that many cards from the top of your deck to your Prize cards." The engine's
    // deck is top-at-index-0 (CardList.moveTo draws with `splice(0, count)`; a normal draw takes
    // deck[0]). The bespoke reduceEffect had its orientation BACKWARDS: it `unshift`ed the old
    // prizes onto the TOP and drew the new prizes with `pop()` from the BOTTOM -- so the new prizes
    // were the WRONG END of the deck. Rotomancer draws the top (correct, matching card text); this
    // was a deterministic RO-vs-TL divergence (the prize SHUFFLE is nondeterministic, but WHICH END
    // the cards come from is not). Fixed: push (bottom) + shift (top).
    //
    // Board: 3 DISTINCT Pokemon on top of the deck, 3 WATER filler below, and 3 DISTINCT (non-deck)
    // energies as prizes -- so "new prizes == top 3" is a clean discriminator that the prize shuffle
    // cannot perturb. Pre-fix the new prizes would be the 3 WATER filler (drawn from the bottom).
    const bd = board(
      player({
        active: inPlay('A-act', [RALTS]),
        hand: [{ iid: 'A-tik', printing: 'jtg-156' }],
        deck: [
          { iid: 'A-t0', printing: 'meg-034' },   // TOP (index 0) -> becomes a new prize
          { iid: 'A-t1', printing: 'pfl-048' },
          { iid: 'A-t2', printing: 'twm-063' },
          { iid: 'A-f0', printing: WATER },
          { iid: 'A-f1', printing: WATER },
          { iid: 'A-f2', printing: WATER },        // BOTTOM (index 5)
        ],
        prizes: [
          { iid: 'A-pz0', printing: FIRE, faceUp: false },
          { iid: 'A-pz1', printing: PSY, faceUp: false },
          { iid: 'A-pz2', printing: METAL, faceUp: false },
        ],
      }),
      player({ active: inPlay('B-act', [RALTS]) }),
    );
    const r = step(bd, [{ actor: 'A' as const, type: 'playItem' as const, card: 'A-tik' }]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.discard.some(c => c.printing === 'jtg-156')).toBe(true);

    // THE fix: the 3 new prizes are the TOP 3 of the deck (not the bottom WATER filler). Deterministic
    // despite the nondeterministic prize shuffle -- which end the draw comes from is not random.
    const newPrizes = r.state.players.A.prizes.map(p => p.printing).sort();
    expect(newPrizes).toEqual(['meg-034', 'pfl-048', 'twm-063'].sort());

    // ...and the OLD prizes are now at the BOTTOM of the deck (last 3), not unshifted onto the top.
    const deck = r.state.players.A.deck.map(c => c.printing);
    expect(deck.slice(-3).sort()).toEqual([FIRE, PSY, METAL].sort());

    // no card lost or duplicated: deck back to 6, deck U prizes conserves all 9 non-ticket cards.
    expect(deck.length).toBe(6);
    expect([...deck, ...newPrizes].sort())
      .toEqual(['meg-034', 'pfl-048', 'twm-063', WATER, WATER, WATER, FIRE, PSY, METAL].sort());
  });

  it('Caretaker shuffles itself into the deck (not a bare move) when Community Center is in play [TA-329 twm-144]', () => {
    // "Draw 2 cards. Then, if Community Center is in play, shuffle this Caretaker back into your deck."
    // The clause MANDATES a deck shuffle. Pre-fix the CC branch was a bare `player.supporter.moveTo(
    // player.deck)` — Caretaker was appended to the deck but the deck was NEVER shuffled, so the order
    // was left intact (rotomancer shuffled; a preserved order leaks deck knowledge). Same family as
    // TA-320..TA-322 (an owed shuffle skipped). Fix: dispatch ShuffleDeckPrompt after the move, the
    // pattern every sibling "shuffle X into your deck" card uses (Unfair Stamp, Spikemuth Gym).
    const deck5 = [
      { iid: 'A-d0', printing: RALTS }, { iid: 'A-d1', printing: RALTS },
      { iid: 'A-d2', printing: RALTS }, { iid: 'A-d3', printing: RALTS },
      { iid: 'A-d4', printing: RALTS },
    ];
    const hand = [{ iid: 'A-care', printing: 'twm-144' }, { iid: 'A-h1', printing: WATER }];
    const withCC = {
      ...board(
        player({ active: inPlay('A-act', [RALTS]), hand, deck: deck5 }),
        player({ active: inPlay('B-act', [RALTS]) }),
      ),
      stadium: { iid: 'stad', printing: 'twm-146', owner: 'A' as const },  // Community Center
    };
    const r = step(withCC, [{ actor: 'A' as const, type: 'playSupporter' as const, card: 'A-care' }]);
    // THE fix: the play pauses on the mandated deck shuffle (a system `shuffle` decision), and
    // Caretaker is back in the deck (moved before the shuffle prompt), not the discard.
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
    expect(r.state.players.A.deck.some(c => c.printing === 'twm-144')).toBe(true);
    expect(r.state.players.A.discard.some(c => c.printing === 'twm-144')).toBe(false);

    // Boundary (baseline-differs-by-ONE-change): with NO Community Center in play the shuffle clause
    // is not met — Caretaker is discarded and NO shuffle is owed. The Community-Center presence is the
    // load-bearing axis; this path is untouched by the fix.
    const noCC = board(
      player({ active: inPlay('A-act', [RALTS]), hand, deck: deck5 }),
      player({ active: inPlay('B-act', [RALTS]) }),
    );
    const r2 = step(noCC, [{ actor: 'A' as const, type: 'playSupporter' as const, card: 'A-care' }]);
    expect(types(r2)).not.toContain('shuffle');
    expect(r2.state.players.A.discard.some(c => c.printing === 'twm-144')).toBe(true);
    expect(r2.state.players.A.deck.some(c => c.printing === 'twm-144')).toBe(false);
  });

  it('Terapagos "Prism Charge" shuffles even when Energy IS attached [TA-330 ssp-161]', () => {
    // "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera
    // Pokémon in any way you like. Then, shuffle your deck." Searching your deck ALWAYS requires a
    // shuffle afterward, whether you attach 0 or up to 3 Energy (B.33/#2171; same family as
    // TA-320..TA-322/TA-324/TA-329, an owed shuffle skipped). Pre-fix the callback shuffled ONLY on the
    // zero-attach branch (`if (transfers.length === 0) { SHUFFLE_DECK(...); return; }`) and the
    // >=1-attach branch moved the searched cards but NEVER shuffled the now-revealed deck — so twinleaf
    // skipped the mandated shuffle whenever any Energy was attached (rotomancer shuffled on both
    // branches; a public deck search leaked the order). Fix: always SHUFFLE_DECK after the attach.
    //
    // A Tera Pokémon must be in play for the attach to have a target (Terapagos itself is a Basic, not
    // Tera — TA-52/#361); the Bench holds Wellspring Mask Ogerpon ex (a Tera), and the deck holds Basic
    // Energy the search can attach to it.
    const teraBoard = () => board(
      player({ active: inPlay('A-act', ['ssp-161'], en(WATER, 1, 'a')),
               bench: [inPlay('A-tera', [TANKY])],
               deck: [{ iid: 'A-d0', printing: WATER }, { iid: 'A-d1', printing: WATER },
                      { iid: 'A-d2', printing: WATER }] }),
      player({ active: inPlay('B-act', [RALTS]) }));

    // THE fix: attach ONE Basic Energy from the deck to the Tera, finish (confirm) — the mandated
    // shuffle still fires. Pre-fix this branch reached `endTurn` with NO shuffle.
    const attached = step(teraBoard(),
      [attack('A-act', 'Prism Charge'),
       { actor: 'A' as const, type: 'attachEnergy' as const, card: 'A-d0', target: 'A-tera' },
       { actor: 'A' as const, type: 'confirm' as const, value: false }]);
    expect(attached.status).toBe('awaitingAction');
    expect(attached.pending!.actor).toBe('system');
    expect(types(attached)).toContain('shuffle');
    // the searched Energy really landed on the Tera (the attach happened, then the shuffle is owed)
    expect(attached.state.players.A.bench[0].energy.length).toBe(1);

    // Boundary (baseline-differs-by-ONE-change): the ZERO-attach branch (finish immediately) was
    // already correct pre-fix and STILL shuffles — the attach-COUNT is the axis the fix neutralises,
    // so the shuffle is now owed on both branches, not just on zero-attach.
    const zeroAttach = step(teraBoard(),
      [attack('A-act', 'Prism Charge'),
       { actor: 'A' as const, type: 'confirm' as const, value: false }]);
    expect(zeroAttach.status).toBe('awaitingAction');
    expect(zeroAttach.pending!.actor).toBe('system');
    expect(types(zeroAttach)).toContain('shuffle');
  });

  it('Whimsicott ex "Energy Gift" shuffles even on a zero-take Basic Energy search [TA-331 wht-005]', () => {
    // "Search your deck for up to 3 Basic Energy cards and attach them to your Pokémon in any way you
    // like. Then, shuffle your deck." A deck that is NON-EMPTY but holds no Basic Energy is a zero-take
    // (the AttachEnergyPrompt is min:0), yet the search EXECUTED, so the shuffle is mandatory (B.33 /
    // compendium #2171; same family as TA-320/TA-321/TA-322/TA-324/TA-330). `useEnergyGift` is a
    // GENERATOR: pre-fix `next()` sat INSIDE the `for (transfer of transfers)` attach loop, so a
    // zero-transfer attach never resumed the generator and the trailing `return store.prompt(
    // ShuffleDeckPrompt)` never fired — the deck was left UNSHUFFLED (rotomancer shuffled; a public
    // search leaked the order). The exact generator-next()-in-loop shape as TA-320 Energy Search Pro.
    // Fix: call next() ONCE after the loop. (The empty-DECK branch already shuffled — TA-126/#2171 —
    // so the gap was the non-empty-deck / no-Basic-Energy zero-FIND.)
    const r = step(
      board(player({ active: inPlay('A-act', ['wht-005'], en(GRASS, 1, 'a')),
                     deck: [{ iid: 'A-d0', printing: RALTS }, { iid: 'A-d1', printing: RALTS },
                            { iid: 'A-d2', printing: RALTS }] }),   // non-empty, NO Basic Energy
            player({ active: inPlay('B-act', [RALTS]) })),
      [attack('A-act', 'Energy Gift')]);
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('system');
    expect(types(r)).toContain('shuffle');
  });

  it('Lycanroc "Spike-Clad" attaches Spiky Energy to THIS Pokemon only, never an unrelated Active [TA-332 jtg-085]', () => {
    // "You may use this Ability when you play this Pokemon from your hand to evolve 1 of your Pokemon.
    // Attach up to 2 Spiky Energy cards from your discard pile to THIS Pokemon." The destination is a
    // single FORCED target — the evolved Lycanroc — not a free choice. Pre-fix the AttachEnergyPrompt
    // used slots [BENCH, ACTIVE] with NO blockedTo, so twinleaf OFFERED and EXECUTED attaching to any
    // of the player's Pokemon; rotomancer forces the Lycanroc (matching card text). TA-269/TA-332.
    // Fix: block every Pokemon except `this`, the toxtricity.ts / TA-198 blockedTo idiom.
    const SNIVY = 'blk-001', ROCKRUFF = 'jtg-084', LYCANROC = 'jtg-085', SPIKY = 'jtg-159';
    const attachTargets = (r: ReturnType<typeof step>): string[] =>
      (r.pending?.legalActions ?? [])
        .filter(a => (a as { type: string }).type === 'attachEnergy')
        .map(a => (a as { target: string }).target);

    // THE cell (needs a SECOND Pokemon so a wrong destination is even reachable): a filler Snivy is the
    // Active and Rockruff is on the Bench; evolve the BENCHED Rockruff into Lycanroc, accept Spike-Clad.
    const twoMon = () => board(
      player({ active: inPlay('A-act', [SNIVY]),
               bench: [inPlay('A-bench', [ROCKRUFF])],
               hand: [{ iid: 'A-h0', printing: LYCANROC }],
               discard: [{ iid: 'A-x0', printing: SPIKY }, { iid: 'A-x1', printing: SPIKY }] }),
      player({ active: inPlay('B-act', [RALTS]) }));
    const offered = step(twoMon(),
      [{ actor: 'A' as const, type: 'evolve' as const, card: 'A-h0', target: 'A-bench' },
       { actor: 'A' as const, type: 'confirm' as const, value: true }]);
    // THE fix: the only legal attach destination is the evolved Lycanroc ('A-bench'); the unrelated
    // Active Snivy ('A-act') is NEVER offered. Pre-fix `attachTargets` also contained 'A-act'.
    expect(new Set(attachTargets(offered))).toEqual(new Set(['A-bench']));
    expect(attachTargets(offered)).not.toContain('A-act');

    // Driving both Spiky Energy lands them on the Lycanroc, and NOTHING on the Active — the STATE the
    // card text mandates (pre-fix, driving both onto 'A-act' SUCCEEDED: Active.E=2, Lycanroc.E=0).
    const resolved = step(twoMon(),
      [{ actor: 'A' as const, type: 'evolve' as const, card: 'A-h0', target: 'A-bench' },
       { actor: 'A' as const, type: 'confirm' as const, value: true },
       { actor: 'A' as const, type: 'attachEnergy' as const, card: 'A-x0', target: 'A-bench' },
       { actor: 'A' as const, type: 'attachEnergy' as const, card: 'A-x1', target: 'A-bench' },
       { actor: 'A' as const, type: 'confirm' as const, value: false }]);
    expect(resolved.state.players.A.bench[0].energy.length).toBe(2);   // Lycanroc got both
    expect(resolved.state.players.A.active!.energy.length).toBe(0);    // Active got none

    // Boundary (baseline-differs-by-ONE-change): with Rockruff the SOLE (Active) Pokemon, the forced
    // destination equals the only target, so the bug is INVISIBLE here and the fix leaves it working —
    // the second Pokemon is the load-bearing axis. Spike-Clad still attaches onto the evolved Lycanroc.
    const oneMon = board(
      player({ active: inPlay('A-act', [ROCKRUFF]),
               hand: [{ iid: 'A-h0', printing: LYCANROC }],
               discard: [{ iid: 'A-x0', printing: SPIKY }, { iid: 'A-x1', printing: SPIKY }] }),
      player({ active: inPlay('B-act', [RALTS]) }));
    const soleOffered = step(oneMon,
      [{ actor: 'A' as const, type: 'evolve' as const, card: 'A-h0', target: 'A-act' },
       { actor: 'A' as const, type: 'confirm' as const, value: true }]);
    expect(new Set(attachTargets(soleOffered))).toEqual(new Set(['A-act']));   // the sole Lycanroc slot
    const soleResolved = step(oneMon,
      [{ actor: 'A' as const, type: 'evolve' as const, card: 'A-h0', target: 'A-act' },
       { actor: 'A' as const, type: 'confirm' as const, value: true },
       { actor: 'A' as const, type: 'attachEnergy' as const, card: 'A-x0', target: 'A-act' },
       { actor: 'A' as const, type: 'attachEnergy' as const, card: 'A-x1', target: 'A-act' },
       { actor: 'A' as const, type: 'confirm' as const, value: false }]);
    expect(soleResolved.state.players.A.active!.energy.length).toBe(2);
  });


  it('Cursed Roots blocks the attach OFFER, not just the attach [TA-337 cri-039]', () => {
    // "During your opponent's next turn, Energy can't be attached from your opponent's hand to the
    // Defending Pokémon." The reducer refused the attach (BLOCKED_BY_EFFECT) but legal-actions.ts
    // still offered the Defending-Pokémon target, so the menu rejected its own action — the fuzz
    // CONTRACT class (x276 in fuzz-after 20260831). Rotomancer offers Bench targets only.
    const PSYE = 'sve-005';
    const trevBoard = () => board(
      player({ active: inPlay('A-act', ['cri-038', 'cri-039'], en(PSYE, 2, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]), bench: [inPlay('B-b0', [RALTS])],
               hand: en(PSYE, 2, 'Bh'), deck: fillerDeck('B', 4) }),
    );
    const attachTargetsOf = (r: ReturnType<typeof step>) =>
      (r.pending?.legalActions ?? [])
        .filter(a => (a as { type: string }).type === 'attachEnergy')
        .map(a => (a as { target?: string }).target);
    // After Cursed Roots, B's menu must NOT offer the Defending (Active) target — Bench only.
    const blocked = step(trevBoard(), [attack('A-act', 'Cursed Roots')]);
    const targets = new Set(attachTargetsOf(blocked));
    expect(targets.has('B-act')).toBe(false);
    expect(targets.has('B-b0')).toBe(true);
    // Baseline differs by ONE change (the attack): Overwhelming Pain carries no attach block, so the
    // very same board offers the Active target.
    const free = step(trevBoard(), [attack('A-act', 'Overwhelming Pain')]);
    expect(new Set(attachTargetsOf(free)).has('B-act')).toBe(true);
  });

  it("Team Rocket's Energy is offered only onto a Team Rocket's Pokémon [TA-374 dri-182/asc-217]", () => {
    // "This card can only be attached to a Team Rocket's Pokémon." The restriction lives as a
    // `throw new GameError` inside the energy's OWN reduceEffect (AttachEnergyEffect); legal-actions
    // still offered the attach onto every Pokémon and the dispatcher then rejected it — the fuzz
    // CONTRACT class (enum-asc-217 x366, fuzz-20260904-enum). The fix dry-runs the concrete attach.
    // Board differs by ONE thing between the two targets: the bench Pokémon carries the TEAM_ROCKET
    // tag (dri-149 Team Rocket's Meowth), the active does not (Ralts).
    const TRE = { iid: 'A-tre', printing: 'dri-182' };  // Team Rocket's Energy
    const trBoard = () => board(
      player({ active: inPlay('A-act', [RALTS]), bench: [inPlay('A-b0', ['dri-149'])],
               hand: [TRE], deck: fillerDeck('A', 4) }),
      player({ active: inPlay('B-act', [RALTS]) }),
    );
    const attachTargetsFor = (r: ReturnType<typeof step>, cardIid: string) =>
      new Set((r.pending?.legalActions ?? [])
        .filter(a => (a as { type: string; card?: string }).type === 'attachEnergy'
          && (a as { card?: string }).card === cardIid)
        .map(a => (a as { target?: string }).target));
    const targets = attachTargetsFor(step(trBoard(), []), 'A-tre');
    expect(targets.has('A-act')).toBe(false);  // non-Team-Rocket's active: withheld (was offered → rejected)
    expect(targets.has('A-b0')).toBe(true);    // Team Rocket's Meowth: legal, still offered
  });

  it('Judge on a deck-0 seed does not wedge on an un-satisfiable shuffle [TA-375 por-076]', () => {
    // "Each player shuffles their hand into their deck and draws 4 cards." raises a shuffle for BOTH
    // players. With A's deck empty and hand emptied by playing Judge, A's shuffle is a forced ≤1-card
    // non-decision (never surfaced, CF-11); B's is the real 3-card shuffle. The client's single
    // `shuffle` order is destined for B — but the driver's CF-11 auto-resolve used to be gated on
    // "no client shuffle action", so A's forced prompt swallowed B's order, applied it to A's 1-card
    // deck, and rejected the valid permutation: an un-satisfiable pending that wedged the game (the
    // fuzz CONTRACT class, enum-tr-bench-por-076--deck0 x4, fuzz-20260904-enum).
    // boardKeepingEmptyDeck leaves deck:[] empty (board() would backfill it) — deck-0 IS the case.
    const settle = (b: ReturnType<typeof boardKeepingEmptyDeck>, actions: NeutralAction[]) => {
      const acts: NeutralAction[] = actions.map(a => ({ ...a }));
      for (let i = 0; i < 12; i++) {
        const r = step(b, acts);
        if (r.status === 'invalidAction') { return { ok: false, shuffles: -1 }; }
        const sh = (r.pending?.legalActions ?? [])
          .find(a => (a as { type: string }).type === 'shuffle') as { deck?: string[] } | undefined;
        if (sh === undefined) {
          return { ok: true, shuffles: r.events.filter(e => /shuffle/i.test(e.kind)).length };
        }
        acts.push({ actor: 'system', type: 'shuffle', order: sh.deck ?? [] } as unknown as NeutralAction);
      }
      throw new Error('TA-375 guard did not settle');
    };
    // A keeps ONE card in hand after Judge (a 1-card forced shuffle over A's empty deck — the CF-11
    // case), B holds three (its real shuffle). Mirrors the corpus board tr-bench-por-076--deck0.
    const judgeBoard = boardKeepingEmptyDeck(
      player({ active: inPlay('A-act', [RALTS]),
               hand: [{ iid: 'A-judge', printing: 'por-076' }, ...en(WATER, 1, 'Ah')], deck: [] }),
      player({ active: inPlay('B-act', [RALTS]),
               hand: en(WATER, 3, 'Bh'), deck: [] }),
    );
    const out = settle(judgeBoard, [{ actor: 'A', type: 'playSupporter', card: 'A-judge' }]);
    expect(out.ok).toBe(true);        // pre-fix: false (invalidAction wedge)
    expect(out.shuffles).toBe(2);     // A's forced shuffle + B's real shuffle both emit `shuffled`
  });

  it("a look-at-deck effect keeps every card conserved and unique through the pause [G-44 resolving projection / asc-215]", () => {
    // Waitress: "Look at the top 6 cards of your deck, attach a Basic Energy you find there to 1 of
    // your Pokémon, shuffle the rest back." The engine does deck.moveTo(temp, 6) into a local pile
    // before a ChooseCardsPrompt, so at the pause the 6 cards are in NO settled zone — conservation
    // read them as vanished (the fuzz INVARIANT|vanish class). The adapter now projects the prompt's
    // pile into `resolving`. Two laws must hold at EVERY node of the resolution: (I2) every starting
    // card is still somewhere, and (I1) no iid appears twice — the second is the trap, because the
    // pile can move a card back to the deck while still referencing it.
    const allIids = (st: NeutralState): string[] => {
      const out: string[] = [];
      for (const who of ['A', 'B'] as const) {
        const p = st.players[who];
        for (const slot of [p.active, ...p.bench]) {
          if (slot) { slot.stack.forEach(c => out.push(c.iid)); slot.energy.forEach(c => out.push(c.iid)); slot.tools.forEach(c => out.push(c.iid)); }
        }
        for (const z of [p.hand, p.deck, p.discard, p.lostZone, p.resolving ?? []]) { z.forEach(c => out.push(c.iid)); }
        p.prizes.forEach(pc => out.push(pc.iid));
      }
      return out;
    };
    const wBoard = board(
      player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'A-wait', printing: 'asc-215' }],
               deck: en(WATER, 8, 'Ad') }),
      player({ active: inPlay('B-act', [RALTS]) }),
    );
    const start = new Set(allIids(wBoard));
    const acts: NeutralAction[] = [{ actor: 'A', type: 'playSupporter', card: 'A-wait' }];
    for (let i = 0; i < 15; i++) {
      const r = step(wBoard, acts);
      expect(r.status).not.toBe('invalidAction');
      if (r.state) {
        const ids = allIids(r.state);
        const counts = new Map<string, number>();
        ids.forEach(x => counts.set(x, (counts.get(x) ?? 0) + 1));
        const dupes = [...counts].filter(([, n]) => n > 1).map(([x]) => x);
        expect(`dupes@step${i}:${dupes}`).toBe(`dupes@step${i}:`);      // I1: no iid twice
        const gone = [...start].filter(x => !counts.has(x));
        expect(`vanished@step${i}:${gone}`).toBe(`vanished@step${i}:`); // I2: nothing lost
      }
      const la = r.pending?.legalActions ?? [];
      if (la.length === 0) { break; }
      const a = la[0] as unknown as Record<string, unknown>;
      const ans: Record<string, unknown> = { actor: a.actor, type: a.type };
      if (a.type === 'shuffle') { ans.order = a.deck; }
      else { for (const k of ['card', 'target', 'source', 'owner', 'to', 'index', 'name', 'ability', 'kind', 'face', 'value', 'option', 'cards', 'candidates', 'order']) { if (a[k] !== undefined) { ans[k] = a[k]; } } }
      acts.push(ans as unknown as NeutralAction);
    }
  });

  // G-44 residual: the three carriers the prompt-pile projection could not reach, one per staging idiom.
  //  - bus-122 Rotom Dex: `deck.moveTo(local, 4)` then a ConfirmPrompt that carries NO cards, so the
  //    pile is a closure-local the adapter cannot see through any prompt (projectOrphans → resolving).
  //  - aq-141 Weakness Guard / bs-084 PlusPower: "attach this card to a Pokémon" Trainers sit in
  //    slot.cards as neither Pokémon, Energy nor registered Tool, so every typed projection skipped
  //    them while attached (projected under `tools`).
  // Same two laws as the Waitress guard above, at EVERY node: I2 nothing lost, I1 no iid twice.
  for (const [printing, verb, deck] of [
    ['bus-122', 'playItem', 8],
    ['aq-141', 'playItem', 4],
    ['bs-084', 'playItem', 4],
  ] as const) {
    it(`an attached/closure-staged Trainer stays conserved and unique through its resolution [G-44 residual / ${printing}]`, () => {
      const allIids = (st: NeutralState): string[] => {
        const out: string[] = [];
        for (const who of ['A', 'B'] as const) {
          const p = st.players[who];
          for (const slot of [p.active, ...p.bench]) {
            if (slot) { slot.stack.forEach(c => out.push(c.iid)); slot.energy.forEach(c => out.push(c.iid)); slot.tools.forEach(c => out.push(c.iid)); }
          }
          for (const z of [p.hand, p.deck, p.discard, p.lostZone, p.resolving ?? []]) { z.forEach(c => out.push(c.iid)); }
          p.prizes.forEach(pc => out.push(pc.iid));
        }
        return out;
      };
      const b = board(
        player({ active: inPlay('A-act', [RALTS]), bench: [inPlay('A-b1', [RALTS])],
                 hand: [{ iid: 'A-item', printing }], deck: en(WATER, deck, 'Ad') }),
        player({ active: inPlay('B-act', [RALTS]) }),
      );
      const start = new Set(allIids(b));
      const acts: NeutralAction[] = [{ actor: 'A', type: verb, card: 'A-item' } as unknown as NeutralAction];
      let nodes = 0;
      for (let i = 0; i < 12; i++) {
        const r = step(b, acts);
        expect(`status@step${i}:${r.status}`).not.toBe(`status@step${i}:invalidAction`);
        if (r.state) {
          nodes++;
          const ids = allIids(r.state);
          const counts = new Map<string, number>();
          ids.forEach(x => counts.set(x, (counts.get(x) ?? 0) + 1));
          const dupes = [...counts].filter(([, n]) => n > 1).map(([x]) => x);
          expect(`dupes@step${i}:${dupes}`).toBe(`dupes@step${i}:`);      // I1
          const gone = [...start].filter(x => !counts.has(x));
          expect(`vanished@step${i}:${gone}`).toBe(`vanished@step${i}:`); // I2
        }
        const la = r.pending?.legalActions ?? [];
        if (la.length === 0) { break; }
        const a = la[0] as unknown as Record<string, unknown>;
        const ans: Record<string, unknown> = { actor: a.actor, type: a.type };
        if (a.type === 'shuffle') { ans.order = a.deck; }
        else { for (const k of ['card', 'target', 'source', 'owner', 'to', 'index', 'name', 'ability', 'kind', 'face', 'value', 'option', 'cards', 'candidates', 'order']) { if (a[k] !== undefined) { ans[k] = a[k]; } } }
        acts.push(ans as unknown as NeutralAction);
      }
      expect(nodes).toBeGreaterThan(0);
    });
  }

  it('Sonic Ripper leaves NO phantom Energy in the Active\'s card list after shuffling it into the deck [TA-376 por-055]', () => {
    // "Shuffle all Energy from this Pokémon into your deck …". mega-skarmory-ex.ts moved the Energy
    // via `player.active.energies.moveCardsTo(…, deck)` — the ENERGIES sub-list — which leaves every
    // moved card in `player.active.cards` as well (only PokemonCardList.moveCardsTo prunes both).
    // The card was then in TWO CardLists (the deck and the Active's master list): every reader of
    // `active.cards` for Energy (Crawdaunt/Shiinotic/Absol-style `cards.filter(c instanceof
    // EnergyCard)`, the Little Grudge reader in game-effect.ts) sees phantom Energy for the rest of
    // the game. Engine-level witness: the master list must hold no Energy once the move happened.
    const b = board(
      player({ active: inPlay('A-act', ['por-055'], [...en(METAL, 2, 'Am'), ...en(WATER, 1, 'Aw')]),
               deck: en(WATER, 6, 'Ad') }),
      player({ active: inPlay('B-act', [RALTS]) }),
    );
    const game = importState(b);
    const acts: NeutralAction[] = [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Sonic Ripper' } as unknown as NeutralAction];
    let r = replay(game, acts);
    for (let i = 0; i < 6 && r.pending && r.pending.legalActions.length > 0; i++) {
      const a = r.pending.legalActions[0] as unknown as Record<string, unknown>;
      const ans: Record<string, unknown> = { actor: a.actor, type: a.type };
      if (a.type === 'shuffle') { ans.order = a.deck; }
      else { for (const k of ['card', 'target', 'source', 'owner', 'to', 'index', 'name', 'kind', 'value', 'option']) { if (a[k] !== undefined) { ans[k] = a[k]; } } }
      acts.push(ans as unknown as NeutralAction);
      r = replay(importState(b), acts);
    }
    const active = importState(b);
    replay(active, acts);
    const slot = active.state.players[0].active;
    const phantom = slot.cards.filter(c => c.superType === SuperType.ENERGY).map(c => c.name);
    expect(`phantomEnergyInActiveCards:${phantom}`).toBe('phantomEnergyInActiveCards:');
    expect(slot.energies.cards.length).toBe(0);
    expect(active.state.players[0].deck.cards.filter(c => c.superType === SuperType.ENERGY).length).toBe(9);
  });

  it('Dewgong\'s Energy transfer leaves NO phantom Energy on the source Pokémon\'s card list [TA-376 por-019]', () => {
    // Same class as Sonic Ripper: dewgong.ts moved the Energy via `source.energies.moveCardTo(card,
    // target.energies)` and then pushed it into target.cards by hand — so the SOURCE's master list
    // still held the card after it left. The slot-level move does both ends.
    const b = board(
      player({ active: inPlay('A-act', ['por-018', 'por-019']),
               bench: [inPlay('A-b1', [RALTS], en(WATER, 1, 'Ab'))], deck: en(WATER, 4, 'Ad') }),
      player({ active: inPlay('B-act', [RALTS]) }),
    );
    const acts: NeutralAction[] = [{ actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Wash Out' } as unknown as NeutralAction];
    let r = replay(importState(b), acts);
    for (let i = 0; i < 6 && r.pending && r.pending.legalActions.length > 0; i++) {
      const a = r.pending.legalActions[0] as unknown as Record<string, unknown>;
      if (a.type === 'endTurn' || a.type === 'useAbility' || a.type === 'declareAttack' || a.type === 'retreat') { break; }
      const ans: Record<string, unknown> = { actor: a.actor, type: a.type };
      for (const k of ['card', 'target', 'source', 'owner', 'to', 'index', 'name', 'kind', 'value', 'option']) { if (a[k] !== undefined) { ans[k] = a[k]; } }
      acts.push(ans as unknown as NeutralAction);
      r = replay(importState(b), acts);
    }
    const game = importState(b);
    replay(game, acts);
    const [active, bench] = [game.state.players[0].active, game.state.players[0].bench[0]];
    expect(active.energies.cards.length).withContext('the Energy moved to the Active').toBe(1);
    expect(bench.energies.cards.length).toBe(0);
    const phantom = bench.cards.filter(c => c.superType === SuperType.ENERGY).map(c => c.name);
    expect(`phantomEnergyOnSource:${phantom}`).toBe('phantomEnergyOnSource:');
    expect(active.cards.filter(c => c.superType === SuperType.ENERGY).length).withContext('the Active master list holds it once').toBe(1);
  });

  it('Nitro Fire Energy returned to the hand leaves NO phantom Energy on the Pokémon it left [TA-376 cri-086]', () => {
    // Third carrier: nitro-fire-energy.ts moved itself to the hand via `pokemon.energies.moveCardTo(this,
    // owner.hand)` when discarded by its [R] Pokémon's attack (Ho-Oh cri-010 Bright Wing: "Discard a [R]
    // Energy attached to this Pokémon"). The master list kept it.
    const b = board(
      player({ active: inPlay('A-act', ['cri-010'], [...en(FIRE, 2, 'Af'), { iid: 'A-nitro', printing: 'cri-086' }]),
               deck: en(FIRE, 4, 'Ad') }),
      player({ active: inPlay('B-act', [RALTS]) }),
    );
    const acts: NeutralAction[] = [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Bright Wing' } as unknown as NeutralAction];
    let r = replay(importState(b), acts);
    for (let i = 0; i < 6 && r.pending && r.pending.legalActions.length > 0; i++) {
      const menu = r.pending.legalActions as unknown as Record<string, unknown>[];
      const a = menu.find(x => typeof x.target === 'string' && (x.target as string).includes('A-nitro')) ?? menu[0];
      if (a.type === 'endTurn' || a.type === 'declareAttack' || a.type === 'retreat' || a.type === 'takePrize') { break; }
      const ans: Record<string, unknown> = { actor: a.actor, type: a.type };
      if (a.type === 'shuffle') { ans.order = a.deck; }
      else { for (const k of ['card', 'target', 'source', 'owner', 'to', 'index', 'name', 'kind', 'value', 'option', 'cards']) { if (a[k] !== undefined) { ans[k] = a[k]; } } }
      acts.push(ans as unknown as NeutralAction);
      r = replay(importState(b), acts);
    }
    const game = importState(b);
    replay(game, acts);
    const active = game.state.players[0].active;
    const hand = game.state.players[0].hand;
    expect(hand.cards.map(c => c.name)).withContext('Nitro Fire Energy came back to the hand').toContain('Nitro Fire Energy');
    expect(active.cards.map(c => c.name)).withContext('and left the Active\'s master list').not.toContain('Nitro Fire Energy');
    expect(active.energies.cards.length).toBe(2);
  });

  it('Destructive Headbutting is withheld when the opponent\'s Active carries no Energy, offered when it does [TA-377 pbl-045]', () => {
    // B.29 addendum 2 (2026-09-07): a flip gate does not rescue an Ability whose every arm is inert —
    // the heads arm's operand (an Energy on the opponent's Active) is public and empty, tails does
    // nothing, and the once-per-turn would be spent for nothing (#2306 "won't do anything" -> No).
    // Rotomancer withholds; twinleaf offered (driven 2026-09-07). The TA-213 idiom: throw
    // CANNOT_USE_POWER in the handler, which the legal-actions dry run reads as "not offered".
    const offers = (oppEnergy: number) => {
      const r = step(board(
        player({ active: inPlay('A-act', ['pbl-045'], en(FIGHT, 2, 'Af')) }),
        player({ active: inPlay('B-act', [RALTS], en(WATER, oppEnergy, 'Be')) }),
      ), []);
      return (r.pending?.legalActions ?? []).some(a => a.type === 'useAbility'
        && (a as unknown as { ability?: string }).ability === 'Destructive Headbutting');
    };
    expect(offers(1)).withContext('control: an Energy to discard -> offered').toBe(true);
    expect(offers(0)).withContext('no Energy on the opponent Active -> withheld').toBe(false);
  });

  it('Special Red Card SHUFFLES the opponent\'s hand before bottoming it — a system shuffle over exactly those cards, not their hand order [TA-379 cri-082]', () => {
    // "Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any
    // cards on the bottom of their deck in this way, they draw 3 cards." The old code moved the hand
    // to the deck bottom IN HAND ORDER and drew — no shuffle at all (TA-305/TA-370 shape: a known
    // order where the card prints a shuffle), and the draw ran before any external order could be
    // supplied. Externalize it the TA-370 way: stage the hand into the deck, ShuffleDeckPrompt over
    // exactly those cards, restack the untouched deck on top, THEN draw.
    const b = board(
      player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'A-src', printing: 'cri-082' }], deck: en(WATER, 4, 'Ad') }),
      player({ active: inPlay('B-act', [RALTS]),
               hand: [{ iid: 'B-h0', printing: FIRE }, { iid: 'B-h1', printing: WATER }, { iid: 'B-h2', printing: PSY }],
               deck: [{ iid: 'B-d0', printing: METAL }, { iid: 'B-d1', printing: GRASS }],
               // the card's own play gate: playable only while the opponent has 3 or fewer Prizes left
               prizes: Array.from({ length: 3 }, (_, i) => ({ iid: `B-p${i}`, printing: WATER, faceUp: false })) }),
    );
    const r1 = step(b, [{ actor: 'A', type: 'playItem', card: 'A-src' } as unknown as NeutralAction]);
    expect(r1.status).toBe('awaitingAction');
    const p = r1.pending as unknown as { actor: string; legalActions: { type: string; deck?: string[] }[] } | null;
    expect(p?.actor).withContext('the hand-to-bottom shuffle is externalized').toBe('system');
    const shuffle = p?.legalActions?.[0];
    expect(shuffle?.type).toBe('shuffle');
    expect([...(shuffle?.deck ?? [])].sort()).withContext('exactly the moved hand cards are permuted').toEqual(['B-h0', 'B-h1', 'B-h2']);
    // resolve with a REVERSED order and check it took: the bottom three are h2,h1,h0 and B drew the
    // untouched deck (d0, d1) plus the first bottomed card (h2)
    const r2 = step(b, [
      { actor: 'A', type: 'playItem', card: 'A-src' } as unknown as NeutralAction,
      { actor: 'system', type: 'shuffle', order: ['B-h2', 'B-h1', 'B-h0'] } as unknown as NeutralAction,
    ]);
    expect(r2.status).toBe('awaitingAction');
    const B = r2.state!.players.B;
    expect(B.hand.map(c => c.iid).sort()).toEqual(['B-d0', 'B-d1', 'B-h2']);
    expect(B.deck.map(c => c.iid)).toEqual(['B-h1', 'B-h0']);
  });

  // TA-280 — the empty-deck gate at the OFFER, once, from the printed text (B.27/B.29 rule 1/B.41), instead
  // of a hand-written throw per card file. Each cell carries its own stocked-deck positive control.
  it('a deck-search Ability is withheld on an EMPTY deck and offered on a stocked one [TA-280 asc-289 X-Boot]', () => {
    const offers = (deck: number) => {
      const r = step(boardKeepingEmptyDeck(
        player({ active: inPlay('A-act', ['asc-289']), deck: fillerDeck('A', deck) }),
        player({ active: inPlay('B-act', [RALTS]) }),
      ), []);
      return (r.pending?.legalActions ?? []).some(a => a.type === 'useAbility'
        && (a as unknown as { ability?: string }).ability === 'X-Boot');
    };
    expect(offers(4)).withContext('control: stocked deck -> offered').toBe(true);
    expect(offers(0)).withContext('empty deck -> withheld (#13, B.29 rule 1)').toBe(false);
  });

  it('a look-at-the-top Item is withheld on an EMPTY deck and offered on a stocked one [TA-280 ssp-175 Dusk Ball]', () => {
    const offers = (deck: number) => {
      const r = step(boardKeepingEmptyDeck(
        player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'A-ball', printing: 'ssp-175' }], deck: fillerDeck('A', deck) }),
        player({ active: inPlay('B-act', [RALTS]) }),
      ), []);
      return (r.pending?.legalActions ?? []).some(a => a.type === 'playItem'
        && (a as unknown as { card?: string }).card === 'A-ball');
    };
    expect(offers(4)).withContext('control: stocked deck -> offered').toBe(true);
    expect(offers(0)).withContext('empty deck -> withheld (B.41: the look provably does nothing)').toBe(false);
  });

  it('CONTROL — an Item that RESTOCKS the deck from the PRIZES before taking from the top is NOT gated [TA-280 jtg-156 Redeemable Ticket]', () => {
    // "Count your Prize cards, shuffle them, and put them on the bottom of your deck. Then, take that
    // many cards from the top of your deck …" — at deck 0 the prizes become the deck first. The
    // census's first pass caught the text gate withholding this where rotomancer offers.
    const r = step(boardKeepingEmptyDeck(
      player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'A-ticket', printing: 'jtg-156' }], deck: fillerDeck('A', 0) }),
      player({ active: inPlay('B-act', [RALTS]) }),
    ), []);
    expect((r.pending?.legalActions ?? []).some(a => a.type === 'playItem'
      && (a as unknown as { card?: string }).card === 'A-ticket')).toBe(true);
  });

  it('CONTROL — a Supporter that RESTOCKS the deck from the hand before drawing is NOT gated by the text rule [TA-280 / TA-349 pre-175 Lacey]', () => {
    // Lacey at deck 0 with a 6-card hand: "shuffle your hand into your deck, then draw 4" — the
    // deck-0 answer is B.41's arithmetic (offered iff a card would stay in the deck), which lives in
    // the card (TA-349). The text gate must step aside for a restock-first effect.
    const r = step(boardKeepingEmptyDeck(
      player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'A-lacey', printing: 'pre-175' }, ...en(WATER, 6, 'Ah')], deck: fillerDeck('A', 0) }),
      player({ active: inPlay('B-act', [RALTS]) }),
    ), []);
    expect((r.pending?.legalActions ?? []).some(a => a.type === 'playSupporter'
      && (a as unknown as { card?: string }).card === 'A-lacey')).toBe(true);
  });

  it('Kofu is withheld on an EMPTY deck (the 2 bottomed cards are the whole deck and come straight back) and offered at deck 1 [TA-380 scr-138]', () => {
    // "Put 2 cards from your hand on the bottom of your deck … draw 4 cards." At deck 0 the two cards
    // ARE the deck and the draw returns exactly them — a provable no-op for any hand size (B.41's
    // arithmetic, TA-349's Lacey shape). At deck 1 the draw reaches the original card: a real effect.
    // Rotomancer withholds at deck 0 and offers at deck 1 (trainer census 2026-09-07).
    const offers = (deck: number) => {
      const r = step(boardKeepingEmptyDeck(
        player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'A-kofu', printing: 'scr-138' }, ...en(WATER, 4, 'Ah')], deck: fillerDeck('A', deck) }),
        player({ active: inPlay('B-act', [RALTS]) }),
      ), []);
      return (r.pending?.legalActions ?? []).some(a => a.type === 'playSupporter'
        && (a as unknown as { card?: string }).card === 'A-kofu');
    };
    expect(offers(1)).withContext('control: deck 1 -> the draw reaches a new card -> offered').toBe(true);
    expect(offers(0)).withContext('deck 0 -> the bottomed pair is drawn straight back -> withheld').toBe(false);
  });

  // TA-381 — "Draw a card for each of your <X> Pokémon in play" with ZERO such Pokémon draws nothing:
  // a provable no-op (#2306, B.41). Rotomancer withholds both (trainer census 2026-09-07).
  it('Jett is withheld when the opponent has no Mega Evolution Pokémon ex in play, offered when they do [TA-381 pbl-079]', () => {
    const offers = (oppActive: string) => {
      const r = step(board(
        player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'A-jett', printing: 'pbl-079' }], deck: en(WATER, 4, 'Ad') }),
        player({ active: inPlay('B-act', [oppActive]) }),
      ), []);
      return (r.pending?.legalActions ?? []).some(a => a.type === 'playSupporter'
        && (a as unknown as { card?: string }).card === 'A-jett');
    };
    expect(offers('mep-011')).withContext('control: Mega Latias ex in play -> offered').toBe(true);
    expect(offers(RALTS)).withContext('no Mega ex -> draws 0 -> withheld').toBe(false);
  });

  it('Awakening Drum is withheld with no Ancient Pokémon in play, offered with one [TA-381 tef-141]', () => {
    const offers = (ownActive: string) => {
      const r = step(board(
        player({ active: inPlay('A-act', [ownActive]), hand: [{ iid: 'A-drum', printing: 'tef-141' }], deck: en(WATER, 4, 'Ad') }),
        player({ active: inPlay('B-act', [RALTS]) }),
      ), []);
      return (r.pending?.legalActions ?? []).some(a => a.type === 'playItem'
        && (a as unknown as { card?: string }).card === 'A-drum');
    };
    expect(offers('pre-043')).withContext('control: Flutter Mane (Ancient) in play -> offered').toBe(true);
    expect(offers(RALTS)).withContext('no Ancient Pokémon -> draws 0 -> withheld').toBe(false);
  });

  it('Distorted Future is withheld when the cycle provably returns the hand (opp deck = 0, hand <= 3) [TA-338 wht-043]', () => {
    // B.41 addendum 2026-08-31 (cycle cell): opp deck empty + hand <= draw count -> the shuffled-in
    // cards are drawn straight back; both counts public; withhold (modern line, #2306/#2042).
    // Rotomancer withholds AND refuses the take; pre-fix twinleaf offered and executed the cycle.
    // boardKeepingEmptyDeck: board() backfills deck: [] with one filler card (the G-8 blind
    // spot) — deck EMPTINESS is the thing under test here.
    const goth = (oppHand: number, oppDeck: number) => step(boardKeepingEmptyDeck(
      player({ active: inPlay('A-act', ['wht-043']) }),
      player({ active: inPlay('B-act', [RALTS]), hand: en(WATER, oppHand, 'Bh'),
               deck: fillerDeck('B', oppDeck) }),
    ), []);
    const offersAbility = (r: ReturnType<typeof step>) =>
      (r.pending?.legalActions ?? []).some(a => (a as { type: string }).type === 'useAbility');
    expect(offersAbility(goth(3, 0))).toBe(false);  // cycle cell -> withheld
    expect(offersAbility(goth(4, 0))).toBe(true);   // 4 in, 3 back: hand changes -> offered
    expect(offersAbility(goth(0, 2))).toBe(true);   // B.41(b): empty hand over a STOCKED deck stays offered
  });

  it('Grand Wing is withheld when the cycle provably returns the hand (opp deck = 0, hand <= 4) [TA-338 por-009]', () => {
    // Same law, conditional-draw sibling (#2306 names Grand Wing). The empty-hand cell was already
    // withheld (TA-326-adjacent); the deck-0 cycle cell is the fix.
    // boardKeepingEmptyDeck: board() backfills deck: [] with one filler card (the G-8 blind
    // spot) — deck EMPTINESS is the thing under test here.
    const viv = (oppHand: number, oppDeck: number) => step(boardKeepingEmptyDeck(
      player({ active: inPlay('A-act', ['por-009']) }),
      player({ active: inPlay('B-act', [RALTS]), hand: en(WATER, oppHand, 'Bh'),
               deck: fillerDeck('B', oppDeck) }),
    ), []);
    const offersAbility = (r: ReturnType<typeof step>) =>
      (r.pending?.legalActions ?? []).some(a => (a as { type: string }).type === 'useAbility');
    expect(offersAbility(viv(4, 0))).toBe(false);   // cycle cell -> withheld
    expect(offersAbility(viv(5, 0))).toBe(true);    // 5 in, 4 back: hand changes -> offered
    expect(offersAbility(viv(0, 3))).toBe(false);   // #2306: empty opp hand -> withheld (pre-existing)
  });

  it('×-damage flip attacks pay per-heads ONLY, no base [TA-336 jtg-103 / jtg-105]', () => {
    // Canonical dmg is 10×/120× (zero base). The files authored `damage: 10/120` in the attacks
    // array AND `effect.damage += D*heads` — paying D + D×heads (fuzz-after 20260831: TL 30 vs RO 20
    // on HH). `damageCalculation` has no engine consumer, so the fix is assignment, the ×-attack
    // house convention (cf. asc-162 Comet Punch).
    const flip = (face: 'heads' | 'tails') => ({ actor: 'system' as const, type: 'flip' as const, face });
    const klink = () => board(
      player({ active: inPlay('A-act', ['jtg-103'], en(METAL, 1, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const hh = step(klink(), [attack('A-act', 'Double Spin'), flip('heads'), flip('heads')]);
    expect(hh.state.players.B.active!.damage).toBe(20);
    const tt = step(klink(), [attack('A-act', 'Double Spin'), flip('tails'), flip('tails')]);
    expect(tt.state.players.B.active!.damage).toBe(0);
    const klinklang = () => board(
      player({ active: inPlay('A-act', ['jtg-105'], en(METAL, 3, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const tth = step(klinklang(), [attack('A-act', 'Triple Smash'), flip('tails'), flip('tails'), flip('heads')]);
    expect(tth.state.players.B.active!.damage).toBe(120);
  });

  it('Kaleidowaltz owes no shuffle on zero heads: the flip-gated search never happened [TA-345 asc-172]', () => {
    // B.44 (2026-09-01): "Then, shuffle your deck" rides on the search having been PERFORMED
    // (#2322/#2171: cannot search => cannot shuffle; #2303: a performed-but-failed search still
    // shuffles). "For each heads, search…" on three tails performs no search. Rotomancer ends
    // the turn; pre-fix twinleaf pended a system shuffle. One heads (the isolating boundary) still
    // searches and therefore still shuffles.
    const flip = (face: 'heads' | 'tails') => ({ actor: 'system' as const, type: 'flip' as const, face });
    const audino = () => board(
      player({ active: inPlay('A-act', ['asc-172'], en(METAL, 1, 'a')), bench: [inPlay('A-b0', [RALTS])],
               deck: fillerDeck('A', 6) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const zero = step(audino(), [attack('A-act', 'Kaleidowaltz'), flip('tails'), flip('tails'), flip('tails')]);
    expect(zero.pending?.actor).not.toBe('system');
    expect(types(zero)).not.toContain('shuffle');
    const one = step(audino(), [attack('A-act', 'Kaleidowaltz'), flip('heads'), flip('tails'), flip('tails')]);
    expect(types(one)).toContain('attachEnergy');   // the search ran -> its shuffle is owed downstream
  });

  it('Luminous Wing prevents an ability-inflicted Special Condition (Selective Slime) [TA-346 por-031]', () => {
    // SD-26, condition half: AddSpecialConditionsPowerEffect is reduced RAW (no EffectOfAbilityEffect
    // wrapper), so a sink that intercepts only the wrapper (TA-334's fix) never sees it. Enamorus V
    // intercepts the class itself. Rotomancer prevents; pre-fix twinleaf burned Mega Clefable ex.
    // Control: the same ability burns an unprotected Active.
    const flip = (face: 'heads' | 'tails') => ({ actor: 'system' as const, type: 'flip' as const, face });
    const slime = (defender: string) => step(board(
      player({ active: inPlay('A-act', ['scr-130', 'scr-005', 'scr-006'], en(GRASS, 1, 'a')) }),
      player({ active: inPlay('B-act', [defender]) }),
    ), [
      { actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Selective Slime' },
      flip('heads'),
      { actor: 'A', type: 'selectOption', label: 'Burned' } as unknown as NeutralAction,
    ]);
    expect(slime('por-031').state.players.B.active!.conditions).not.toContain('burned');
    expect(slime(RALTS).state.players.B.active!.conditions).toContain('burned');
  });

  it('Biting Spree: a declined "you may" places nothing and prompts for nothing; accepted, its counters respect Luminous Wing [TA-341 dri-122]', () => {
    // (a) The CONFIRMATION_PROMPT callback's early return never gated the ChoosePokemonPrompt that
    // followed it, so a decline still pended CHOOSE_POKEMON_TO_DAMAGE. (b) `target.damage += 20` is
    // a raw write — no PutDamageCountersEffect, so no EffectOfAbilityEffect for a protector to catch
    // (SD-26 source half, the TA-334 froslass shape). Rotomancer: decline -> turn menu; accept ->
    // por-031 stays at 0, the Bellsprout takes 20.
    const crobat = (defender: string) => board(
      player({ active: inPlay('A-act', ['dri-120', 'dri-121']), hand: [{ iid: 'Ah0', printing: 'dri-122' }] }),
      player({ active: inPlay('B-act', [defender]), bench: [inPlay('B-b0', [RALTS])] }),
    );
    const evolve = { actor: 'A' as const, type: 'evolve' as const, card: 'Ah0', target: 'A-act' };
    const confirm = (value: boolean) => ({ actor: 'A' as const, type: 'confirm' as const, value });
    const choose = (target: string) => ({ actor: 'A' as const, type: 'placeCounter' as const, target });

    const declined = step(crobat(TANKY), [evolve, confirm(false)]);
    expect(declined.pending?.descriptor).toBe('main');
    expect(declined.state.players.B.active!.damage).toBe(0);
    expect(declined.state.players.B.bench[0].damage).toBe(0);

    // CF-32: "put 2 damage counters" is counter placement — the menu verb is placeCounter, not choose
    // (found by the 2026-09-01 targeted re-fuzz over the sample-batch boards, the first time this
    // board was ever fuzzed; rotomancer offers placeCounter{target}).
    const menu = step(crobat(TANKY), [evolve, confirm(true)]);
    expect(placeCounterTargets(menu).sort()).toEqual(['B-act', 'B-b0']);
    const accepted = step(crobat(TANKY), [evolve, confirm(true), choose('B-act'), choose('B-b0')]);
    expect(accepted.state.players.B.active!.damage).toBe(20);
    expect(accepted.state.players.B.bench[0].damage).toBe(20);

    const shielded = step(crobat('por-031'), [evolve, confirm(true), choose('B-act'), choose('B-b0')]);
    expect(shielded.state.players.B.active!.damage).toBe(0);   // Luminous Wing
    expect(shielded.state.players.B.bench[0].damage).toBe(20);
  });

  it('Tundra Wall does not stack: two Aurorus reduce by 50, not 100 [TA-342 por-024]', () => {
    // "The effect of Tundra Wall doesn't stack." The card wrote `effect.damage = max(0, damage - 50)`
    // raw, so every copy in play applied; PutDamageEffect.reduceDamage(amount, source) is the
    // engine's named non-stacking reducer. Mach Bolt 70 into a Water-holding Active behind two
    // Aurorus: rotomancer 20, pre-fix twinleaf 0. One Aurorus (control) is also 20.
    const LIGHTNING = 'sve-004';
    const aurorus = (copies: string[]) => board(
      player({ active: inPlay('A-act', ['jtg-054', 'jtg-055'], en(LIGHTNING, 3, 'a')) }),
      player({ active: inPlay('B-act', ['por-063'], en(WATER, 1, 'b')),
               bench: copies.map((p, i) => inPlay(`B-b${i}`, ['por-069', 'por-023', p], en(WATER, 1, `bb${i}`))) }),
    );
    expect(step(aurorus(['por-024', 'por-092']), [attack('A-act', 'Mach Bolt')]).state.players.B.active!.damage).toBe(20);
    expect(step(aurorus(['por-024']), [attack('A-act', 'Mach Bolt')]).state.players.B.active!.damage).toBe(20);
  });

  it("Stone Palace protects its OWNER's Steven's Pokémon from the opponent's attacks, never the other way round [TA-339 dri-086]", () => {
    // "As long as this Pokémon is on your Bench, all of YOUR Steven's Pokémon take 30 less damage
    // from attacks from YOUR OPPONENT's Pokémon." The card tested `effect.player` (the ATTACKER) for
    // a benched Carbink, so the attacker's own Palace shielded the defender and the defender's did
    // nothing. Four one-variable cells, rotomancer matching print on all four.
    const LIGHTNING = 'sve-004';
    const cell = (aBench: string[], bBench: string[], atk: [string, string[], string]) => step(board(
      player({ active: inPlay('A-act', [atk[0]], atk[1].map((e, i) => ({ iid: `ae${i}`, printing: e }))),
               bench: aBench.map((p, i) => inPlay(`A-b${i}`, [p])) }),
      player({ active: inPlay('B-act', ['dri-086']), bench: bBench.map((p, i) => inPlay(`B-b${i}`, [p])) }),
    ), [attack('A-act', atk[2])]).state.players.B.active!.damage;
    const machBolt: [string, string[], string] = ['jtg-055', [LIGHTNING, LIGHTNING, LIGHTNING], 'Mach Bolt'];
    const fireClaws: [string, string[], string] = ['asc-020', [FIRE, WATER], 'Fire Claws'];
    expect(cell([], ['dri-086'], machBolt)).toBe(40);   // defender's Palace: 70 - 30
    expect(cell([], [RALTS], machBolt)).toBe(70);        // no Palace on the defender's side
    expect(cell(['dri-086'], [], fireClaws)).toBe(30);   // ATTACKER's Palace must not shield the defender
    expect(cell(['dri-086'], ['dri-086'], fireClaws)).toBe(0); // defender's Palace floors 30 at 0
  });

  it('Infinite Shadow returns the KO\'d Gengar AND its underlying cards to the hand; attached cards are discarded [TA-344 por-050]', () => {
    // "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, put it
    // into your hand instead of the discard pile. (Discard all attached cards.)" — #2308: "this
    // Pokémon" includes the underlying Basic/Stage cards. The old handler read the DAMAGE_DEALT
    // marker off the WRONG player (the marker sits on the damaged Pokémon's owner) and never fired,
    // so the whole stack went to the discard. Rotomancer: hand gains Gastly/Haunter/Gengar, the
    // Energy is discarded, the prize is still taken (#2307).
    const DARK = 'sve-007';
    const gengar = (damage: number) => board(
      player({ active: inPlay('A-act', ['asc-020'], [{ iid: 'ae0', printing: FIRE }, { iid: 'ae1', printing: WATER }]) }),
      player({ active: inPlay('B-act', ['asc-123', 'asc-124', 'por-050'], en(DARK, 2, 'b'), damage),
               bench: [inPlay('B-b0', [RALTS])] }),
    );
    const ko = step(gengar(100), [attack('A-act', 'Fire Claws')]);   // 30 = exact KO
    const hand = ko.state.players.B.hand.map(c => c.printing).sort();
    expect(hand).toEqual(['asc-123', 'asc-124', 'por-050']);
    expect(ko.state.players.B.discard.map(c => c.printing)).toEqual([DARK, DARK]);
    expect(types(ko)).toContain('takePrize');                        // the prize is still owed
    // The event mapper used to read a hand reappearance as a BOUNCE and drop the `ko`/`damaged`;
    // a KO whose remains go to the hand is still a Knock Out (the KO log + prize say so).
    const kinds = ko.events.map(e => `${e.kind}:${basicPrintingByIid(ko.state, (e as { target?: string }).target) ?? ''}`);
    expect(kinds).toContain('ko:asc-123');
    expect(kinds).toContain('damaged:asc-123');
    const survives = step(gengar(90), [attack('A-act', 'Fire Claws')]); // 120 < 130: nothing moves
    // (B's hand holds its turn-start draw here — the attack ended A's turn — so assert the stack.)
    expect(survives.state.players.B.hand.map(c => c.printing)).not.toContain('por-050');
    expect(survives.state.players.B.active!.stack.length).toBe(3);
  });

  it('Selective Slime is withheld when the opponent\'s Active already carries all three conditions, and offers exactly Burned/Confused/Poisoned [TA-343 scr-006]', () => {
    // #2014: "Can I use Selective Slime if my opponent's Active is already Burned, Confused, and
    // Poisoned? — No, you cannot." (B.41's withhold line: the effect provably does nothing and the
    // operand is public.) Two of three (control) is still offered. And the choice menu printed a 4th
    // option — Asleep — the text does not offer; the choice is exactly the three printed words.
    const flip = (face: 'heads' | 'tails') => ({ actor: 'system' as const, type: 'flip' as const, face });
    const cradily = (conds: ConditionToken[]) => board(
      player({ active: inPlay('A-act', ['scr-130', 'scr-005', 'scr-006'], en(GRASS, 1, 'a')) }),
      player({ active: inPlay('B-act', [TANKY], [], 0, conds) }),
    );
    const offersAbility = (r: ReturnType<typeof step>) =>
      (r.pending?.legalActions ?? []).some(a => (a as { type: string }).type === 'useAbility');
    expect(offersAbility(step(cradily(['burned', 'confused', 'poisoned']), []))).toBe(false);
    expect(offersAbility(step(cradily(['burned', 'confused']), []))).toBe(true);

    const menu = step(cradily([]), [{ actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Selective Slime' }, flip('heads')]);
    const labels = (menu.pending?.legalActions ?? [])
      .filter(a => (a as { type: string }).type === 'selectOption')
      .map(a => String((a as { label?: string }).label).toLowerCase()).sort();
    expect(labels).toEqual(['burned', 'confused', 'poisoned']);
  });

  it('a can\'t-retreat Fossil Active is not OFFERED a retreat (menu = executor) [TA-340 scr-130 / TA-271 por-068]', () => {
    // "This card … can't retreat." The RetreatEffect throws CANNOT_RETREAT, but retreatMenu never
    // dry-ran it, so the menu advertised a retreat the executor then refused (the TA-225 offer-then-
    // reject family). retreatMenu now probes the real RetreatAction on a clone, like attacks do.
    const active = (printing: string) => step(board(
      player({ active: inPlay('A-act', [printing], en(WATER, 2, 'a')), bench: [inPlay('A-b0', [RALTS])] }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), []);
    expect(types(active('scr-130'))).not.toContain('retreat');
    expect(types(active('por-068'))).not.toContain('retreat');
    expect(types(active(RALTS))).toContain('retreat');   // control: a plain Basic retreats
  });

  it('Primal Root: attacks used by the opponent\'s Basic Pokémon cost [C] more [TA-340 scr-130]', () => {
    // twinleaf's Antique Root Fossil carried only its Fossil trainer-ability; the printed second
    // ability was missing entirely. Snivy with GG facing a Root Fossil Active: Vine Whip (GG) now
    // costs GGC and is not offered; with GGG it is. A non-Fossil defender: both offered at GG.
    const snivy = (defender: string, grass: number) => attacksOffered(step(board(
      player({ active: inPlay('A-act', ['blk-001'], en(GRASS, grass, 'a')) }),
      player({ active: inPlay('B-act', [defender]) }),
    ), []));
    expect(snivy('scr-130', 2)).toEqual(['Tackle']);
    expect(snivy('scr-130', 3)).toEqual(['Tackle', 'Vine Whip']);
    expect(snivy(TANKY, 2)).toEqual(['Tackle', 'Vine Whip']);
  });

  it('attacks AGAINST an Antique Armor Fossil Active are offered and land at printed minus 10 [TA-340 pbl-072]', () => {
    // armorProtectionActive() dispatched a PowerEffect for powers[0] — the Fossil TRAINER_ABILITY,
    // whose WAS_POWER_USED handler DISCARDS THE FOSSIL — so checking the armor mid-attack removed the
    // defender, the attack pipeline threw, the menu probe withheld every attack and a submitted one
    // was ILLEGAL_ACTION. The lock check must name Protective Armor (powers[1]).
    const servine = (grass: number, name: string) => step(board(
      player({ active: inPlay('A-act', ['blk-001', 'blk-002'], en(GRASS, grass, 'a')) }),
      player({ active: inPlay('B-act', ['pbl-072']), bench: [inPlay('B-b0', [RALTS])] }),
    ), [attack('A-act', name)]);
    const menu = step(board(
      player({ active: inPlay('A-act', ['blk-001', 'blk-002'], en(GRASS, 1, 'a')) }),
      player({ active: inPlay('B-act', ['pbl-072']), bench: [inPlay('B-b0', [RALTS])] }),
    ), []);
    expect(attacksOffered(menu)).toEqual(['Wrap']);
    expect(servine(1, 'Wrap').state.players.B.active!.damage).toBe(10);        // 20 - 10
    expect(servine(3, 'Vine Whip').state.players.B.active!.damage).toBe(50);   // 60 - 10, survives at 60 HP
  });

  it('Sneaky Bite: a declined "you may" places nothing; accepted, its counters are placeCounter picks that respect Luminous Wing [TA-347 dri-121]', () => {
    // TA-341's shape one evolution stage down, found by the 2026-09-01 targeted re-fuzz on the
    // post-bounce walk of the Crobat boards (Zubat re-benched, then evolved to Golbat).
    const golbat = (defender: string) => board(
      player({ active: inPlay('A-act', ['dri-120']), hand: [{ iid: 'Ah0', printing: 'dri-121' }] }),
      player({ active: inPlay('B-act', [defender]), bench: [inPlay('B-b0', [RALTS])] }),
    );
    const evolve = { actor: 'A' as const, type: 'evolve' as const, card: 'Ah0', target: 'A-act' };
    const confirm = (value: boolean) => ({ actor: 'A' as const, type: 'confirm' as const, value });
    const place = (target: string) => ({ actor: 'A' as const, type: 'placeCounter' as const, target });
    const declined = step(golbat(TANKY), [evolve, confirm(false)]);
    expect(declined.pending?.descriptor).toBe('main');
    expect(declined.state.players.B.active!.damage).toBe(0);
    expect(placeCounterTargets(step(golbat(TANKY), [evolve, confirm(true)])).sort()).toEqual(['B-act', 'B-b0']);
    expect(step(golbat(TANKY), [evolve, confirm(true), place('B-act')]).state.players.B.active!.damage).toBe(20);
    expect(step(golbat('por-031'), [evolve, confirm(true), place('B-act')]).state.players.B.active!.damage).toBe(0);
  });

  it('a Fossil Active cannot be given a Special Condition by an opponent\'s ABILITY either — all seven in-pool Fossils [TA-348]', () => {
    // "This card can't be affected by any Special Conditions." Every Fossil intercepted only the ATTACK
    // channel (AddSpecialConditionsEffect); the ability channel (AddSpecialConditionsPowerEffect, reduced
    // raw — SD-26) went straight through, so Selective Slime burned a Fossil. Found by the B.45 fizzle
    // cell (scr-006 c18) the moment it was authored. Attack channel checked too, as the control that the
    // interception is per-channel, not per-card.
    const flip = (face: 'heads' | 'tails') => ({ actor: 'system' as const, type: 'flip' as const, face });
    const slimeVs = (fossil: string) => step(board(
      player({ active: inPlay('A-act', ['scr-130', 'scr-005', 'scr-006'], en(GRASS, 1, 'a')) }),
      player({ active: inPlay('B-act', [fossil]) }),
    ), [
      { actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Selective Slime' },
      flip('heads'),
      { actor: 'A', type: 'selectOption', label: 'Burned' } as unknown as NeutralAction,
    ]);
    for (const fossil of ['scr-130', 'scr-129', 'pbl-072', 'pbl-073', 'por-068', 'por-069', 'wht-079']) {
      expect(slimeVs(fossil).state.players.B.active!.conditions).toEqual([], fossil);
    }
    expect(slimeVs(RALTS).state.players.B.active!.conditions).toEqual(['burned']);   // control
  });

  it('Antique Sail Fossil\'s "Protective Sail" must not strand the opponent\'s played Supporter, and must veto a Supporter gust of itself [TA-388 por-069]', () => {
    // "Whenever your opponent plays a Supporter card from their hand, prevent all effects of that card
    // done to this Pokemon." The old code set effect.preventDefault on the whole TrainerEffect, which
    // skips playTrainerReducer — the ONLY code that moves a played Supporter out of the hand — so EVERY
    // Supporter the opponent plays was stranded in their hand with the slot still burned, while the
    // Supporter's own effect resolved anyway (it runs in propagateEffect, before the short-circuit).
    // Two-way divergence vs rotomancer (which is correct on both): twinleaf OVER-reached (stranded
    // no-op Supporters) and UNDER-reached (failed to prevent a Boss's Orders gust of the fossil).
    // Fix: the gust prefab asks each opponent benched Pokemon (CheckGustBlockEffect) whether it may be
    // switched in; the Fossil vetoes when the source is an opponent Supporter — and the played Supporter
    // now leaves the hand normally. asc-192 Lillie's Determination is the live-report witness; asc-183
    // Boss's Orders is the in-pool gust.
    const LILLIES = 'asc-192', BOSS = 'asc-183', SAIL = 'por-069', PONYTA = 'scr-019';
    // Part 1: a no-op Supporter leaves the hand into the play zone (resolving), fossil or not.
    const lillies = (fossil: string | null) => step(board(
      player({ active: inPlay('A-act', [RALTS]), bench: [inPlay('A-b1', [RALTS])],
               hand: [{ iid: 'sup', printing: LILLIES }, ...en(WATER, 4, 'Ah')], deck: fillerDeck('A', 30),
               discard: [{ iid: 'A-dc', printing: WATER }] }),
      player({ active: inPlay('B-act', [RALTS]), bench: fossil ? [inPlay('B-fossil', [fossil])] : [inPlay('B-bn', [RALTS])] }),
    ), [{ actor: 'A', type: 'playSupporter', card: 'sup' }]);
    for (const fossil of [null, SAIL]) {
      const A = lillies(fossil).state.players.A;
      expect(A.hand.some(c => c.iid === 'sup')).withContext(`fossil=${fossil}`).toBe(false);
      expect((A.resolving ?? []).some(c => c.iid === 'sup')).withContext(`fossil=${fossil}`).toBe(true);
    }
    // Part 2: Boss's Orders can gust a non-fossil bench Pokemon but never the fossil.
    const boss = (bench: string[]) => step(board(
      player({ active: inPlay('A-act', [RALTS]), bench: [inPlay('A-b1', [RALTS])],
               hand: [{ iid: 'boss', printing: BOSS }, ...en(WATER, 3, 'Ah')], deck: fillerDeck('A', 20) }),
      player({ active: inPlay('B-act', [RALTS]), bench: bench.map((pr, i) => inPlay(`B-b${i}`, [pr])) }),
    ), [{ actor: 'A', type: 'playSupporter', card: 'boss' }]);
    // fossil is the only bench -> no legal gust target -> whiff, fossil stays benched.
    const only = boss([SAIL]).state.players.B;
    expect(only.active!.stack[only.active!.stack.length - 1].printing).toBe('sit-067');   // RALTS, unchanged
    expect(only.bench.some(b => b.stack.some(c => c.printing === SAIL))).toBe(true);
    // fossil beside a Ponyta -> the forced gust lands on Ponyta (single legal target), fossil untouched.
    const beside = boss([SAIL, PONYTA]).state.players.B;
    expect(beside.active!.stack[beside.active!.stack.length - 1].printing).toBe(PONYTA);
    expect(beside.bench.some(b => b.stack.some(c => c.printing === SAIL))).toBe(true);
    // control: no fossil -> a plain bench IS gusted.
    const plain = boss([PONYTA]).state.players.B;
    expect(plain.active!.stack[plain.active!.stack.length - 1].printing).toBe(PONYTA);
  });

  it('Lacey / Lillie\'s Determination / Drasna are withheld when the recycle provably returns every card (own deck = 0, hand-1 <= draw) [TA-349 pre-175 asc-192 ssp-173]', () => {
    // B.41 addendum 2026-09-01 (the SELF-side cycle cell; RE-138 withdrawn, rotomancer right): with
    // the player's own deck EMPTY and every non-Supporter card in hand ≤ the draw count, "shuffle
    // your hand into your deck, then draw N" hands the same cards straight back — hand, deck and
    // discard end where they started, the Supporter itself being the cost (#255/#1124/#1188; #1042
    // Hugh is the same law on a symmetric-count card). Both operands are the actor's own, so the
    // no-op is provable and the Trainer is withheld (the modern line, B.41/B.36). Pre-fix twinleaf
    // offered it on every deck-0 board; rotomancer's gate is exactly this arithmetic (measured live
    // 2026-09-01: offered iff a card stays in the deck).
    // boardKeepingEmptyDeck: deck EMPTINESS is the thing under test.
    const menu = (supporter: string, others: number, oppPrizes: number, ownPrizes: number, deck: number) => step(boardKeepingEmptyDeck(
      player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'sup', printing: supporter }, ...en(WATER, others, 'Ah')],
               deck: fillerDeck('A', deck),
               prizes: Array.from({ length: ownPrizes }, (_, i) => ({ iid: `A-pz${i}`, printing: WATER, faceUp: false })) }),
      player({ active: inPlay('B-act', [RALTS]),
               prizes: Array.from({ length: oppPrizes }, (_, i) => ({ iid: `B-pz${i}`, printing: WATER, faceUp: false })) }),
    ), []);
    const offers = (r: ReturnType<typeof step>) =>
      (r.pending?.legalActions ?? []).some(a => (a as { type: string; card?: string }).type === 'playSupporter' && (a as { card?: string }).card === 'sup');
    // Lacey pre-175: draw 4, or 8 when the OPPONENT has ≤3 Prizes.
    expect(offers(menu('pre-175', 3, 3, 6, 0))).toBe(false);   // the RE-138 board: draw 8, 3 back -> withheld
    expect(offers(menu('pre-175', 5, 3, 6, 0))).toBe(false);   // draw 8, 5 back -> withheld
    expect(offers(menu('pre-175', 4, 6, 6, 0))).toBe(false);   // draw 4, 4 back -> withheld
    expect(offers(menu('pre-175', 0, 3, 6, 0))).toBe(false);   // nothing to shuffle, nothing to draw -> withheld
    expect(offers(menu('pre-175', 5, 6, 6, 0))).toBe(true);    // draw 4, one of 5 stays in the deck -> offered
    expect(offers(menu('pre-175', 3, 3, 6, 1))).toBe(true);    // a stocked deck: the draw brings a new card -> offered
    expect(offers(menu('scr-139', 3, 3, 6, 0))).toBe(false);   // reprint inherits the gate
    // Lillie's Determination asc-192: draw 6, or 8 when YOU have exactly 6 Prizes.
    expect(offers(menu('asc-192', 8, 6, 6, 0))).toBe(false);   // draw 8, 8 back -> withheld
    expect(offers(menu('asc-192', 7, 6, 5, 0))).toBe(true);    // draw 6 (5 Prizes), one of 7 stays -> offered
    expect(offers(menu('asc-192', 6, 6, 5, 0))).toBe(false);   // draw 6, 6 back -> withheld
    // Drasna ssp-173: flip — draw 8 or 3. Provably a no-op only when BOTH arms return everything.
    expect(offers(menu('ssp-173', 3, 6, 6, 0))).toBe(false);   // ≤3: heads and tails both return all -> withheld
    expect(offers(menu('ssp-173', 5, 6, 6, 0))).toBe(true);    // 5: tails leaves two in the deck -> the flip decides -> offered
  });

  it('an ACTIVATED "once during your turn, you may attach" Ability has no post-activation decline [TA-350 twm-025 por-043]', () => {
    // B.46 (RE-140 withdrawn, rotomancer right): the `may` IS the activation — `useAbility` is the
    // decision, and once used the attach is mandatory (#1197 Welder "must be able to attach at least
    // 1", #2306, #2301's 1..max floor for an Ability's count, #255 no use for no effect). Pre-fix both
    // prompts were `min: 0`, surfacing a `confirm(false)` decline after activation: Teal Dance's
    // decline charged nothing (a surplus node); Stone Arms' decline CHARGED the once-per-turn for no
    // effect (behavioural). With ONE eligible Energy the pick is forced and collapses (CF-14, the
    // CHOOSE_CARD_TO_ATTACH allow-list entry measured on twm-025 + dri-020); with TWO it is a WHICH pick
    // and nothing else.
    const use = (ability: string) => ({ actor: 'A' as const, type: 'useAbility' as const, source: 'A-act', ability });
    const legal = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []) as Array<{ type: string; target?: string; value?: unknown }>;
    // Teal Dance, one Grass: collapsed — attached and drew, back at the main menu.
    const one = step(board(
      player({ active: inPlay('A-act', ['twm-025']), hand: [{ iid: 'g0', printing: GRASS }, { iid: 'w0', printing: WATER }], deck: fillerDeck('A', 3) }),
      player({ active: inPlay('B-act', [RALTS]) }),
    ), [use('Teal Dance')]);
    expect(one.status).toBe('awaitingAction');
    expect(one.state.players.A.active!.energy.map(e => e.iid)).toEqual(['g0']);
    expect(one.state.players.A.hand.length).toBe(2);              // −Grass +draw
    expect(legal(one).some(a => a.type === 'useAbility')).toBe(false);   // once-per-turn spent
    expect(legal(one).some(a => a.type === 'confirm')).toBe(false);
    // Teal Dance, two Grass: a WHICH pick, no decline.
    const two = step(board(
      player({ active: inPlay('A-act', ['twm-025']), hand: [{ iid: 'g0', printing: GRASS }, { iid: 'g1', printing: GRASS }], deck: fillerDeck('A', 3) }),
      player({ active: inPlay('B-act', [RALTS]) }),
    ), [use('Teal Dance')]);
    expect(legal(two).filter(a => a.type === 'choose').map(a => a.target).sort()).toEqual(['g0', 'g1']);
    expect(legal(two).some(a => a.type === 'confirm')).toBe(false);
    // Stone Arms, one Fighting: collapsed and attached; two: a WHICH pick, no decline.
    const stoneOne = step(board(
      player({ active: inPlay('A-act', ['por-043']), hand: [{ iid: 'f0', printing: FIGHT }, { iid: 'w0', printing: WATER }] }),
      player({ active: inPlay('B-act', [RALTS]) }),
    ), [use('Stone Arms')]);
    expect(stoneOne.state.players.A.active!.energy.map(e => e.iid)).toEqual(['f0']);
    expect(legal(stoneOne).some(a => a.type === 'confirm')).toBe(false);
    const stoneTwo = step(board(
      player({ active: inPlay('A-act', ['por-043']), hand: [{ iid: 'f0', printing: FIGHT }, { iid: 'f1', printing: FIGHT }] }),
      player({ active: inPlay('B-act', [RALTS]) }),
    ), [use('Stone Arms')]);
    expect(legal(stoneTwo).filter(a => a.type === 'attachEnergy').length).toBe(2);
    expect(legal(stoneTwo).some(a => a.type === 'confirm')).toBe(false);
  });

  it('a forced CHOOSE_CARD_TO_ATTACH pick collapses from a PUBLIC zone, never from the deck [TA-350 dri-020 / cri-006]', () => {
    // The allow-list entry (choose-cards.ts) was added on measured cells: Charging Up over a discard
    // holding ONE Basic Energy collapses on both engines, TWO surfaces on both. Quilladin's Leafy
    // Charge is the deck-search sibling — a search may always fail to find (#903), so its pick is
    // never forced: `min: 0` (the pre-fix `min: 1` would have collapsed a hidden-zone pick the
    // moment the message joined the allow-list; rotomancer keeps the decline there).
    const use = (ability: string) => ({ actor: 'A' as const, type: 'useAbility' as const, source: 'A-act', ability });
    const legal = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []) as Array<{ type: string; target?: string }>;
    const spid = (discard: CardRef[]) => step(board(
      player({ active: inPlay('A-act', ['dri-019', 'dri-020']), discard }),
      player({ active: inPlay('B-act', [RALTS]) }),
    ), [use('Charging Up')]);
    const oneE = spid([{ iid: 'd0', printing: GRASS }, { iid: 'd1', printing: 'ssp-176' }]);
    expect(oneE.state.players.A.active!.energy.map(e => e.iid)).toEqual(['d0']);        // collapsed + applied
    expect(legal(oneE).some(a => a.type === 'choose')).toBe(false);
    const twoE = spid([{ iid: 'd0', printing: GRASS }, { iid: 'd1', printing: FIRE }]);
    expect(legal(twoE).filter(a => a.type === 'choose').map(a => a.target).sort()).toEqual(['d0', 'd1']);
    const quill = step(board(
      player({ active: inPlay('A-act', ['cri-005', 'cri-006'], en(GRASS, 1, 'a')), deck: [{ iid: 'k0', printing: GRASS }, { iid: 'k1', printing: WATER }] }),
      player({ active: inPlay('B-act', [RALTS]) }),
    ), [attack('A-act', 'Leafy Charge')]);
    expect(legal(quill).filter(a => a.type === 'choose').map(a => a.target)).toEqual(['k0']);   // surfaced, not collapsed
    expect(legal(quill).some(a => a.type === 'confirm')).toBe(true);                             // and may fail to find
  });

  it('Leafy Charge lands its 20 BEFORE the search pauses, and a fail-to-find still shuffles [TA-351 cri-006]', () => {
    // Standing fuzz-baseline row (cri-006/<defender>, 2,485 occ) re-driven 2026-09-01: rotomancer's
    // defender reads dmg=20 at the search pending, twinleaf's read 0 — base damage left to the
    // framework lands AFTER the prompt (the TA-66/TA-69/TA-79 shape). And "Then, shuffle your deck"
    // follows a PERFORMED search whether or not it finds (#2303; B.44's wording test), so declining
    // the pick — legal on a hidden deck, #903 — must still shuffle.
    const q = (deck: CardRef[]) => board(
      player({ active: inPlay('A-act', ['cri-005', 'cri-006'], en(GRASS, 1, 'a')), deck }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const paused = step(q([{ iid: 'k0', printing: GRASS }, { iid: 'k1', printing: WATER }]), [attack('A-act', 'Leafy Charge')]);
    expect(paused.state.players.B.active!.damage).toBe(20);                    // damage first
    expect((paused.pending?.legalActions ?? []).some(a => (a as { type: string }).type === 'confirm')).toBe(true);
    const declined = step(q([{ iid: 'k0', printing: GRASS }, { iid: 'k1', printing: WATER }]),
      [attack('A-act', 'Leafy Charge'), { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction]);
    expect(declined.state.players.A.active!.energy.length).toBe(1);            // nothing attached
    expect((declined.pending?.legalActions ?? []).some(a => (a as { type: string }).type === 'shuffle')
      || (declined.events ?? []).some(e => (e as { kind: string }).kind === 'shuffled')).toBe(true);   // shuffle owed
    // two non-Grass cards: a ≤1-card deck would collapse the shuffle itself (CF-11) and prove nothing
    const noGrass = step(q([{ iid: 'k1', printing: WATER }, { iid: 'k2', printing: WATER }]), [attack('A-act', 'Leafy Charge')]);
    expect(noGrass.state.players.B.active!.damage).toBe(20);
    expect((noGrass.pending?.legalActions ?? []).some(a => (a as { type: string }).type === 'shuffle')
      || (noGrass.events ?? []).some(e => (e as { kind: string }).kind === 'shuffled')).toBe(true);    // a whiffed search still shuffles (B.43)
    const empty = step(boardKeepingEmptyDeck(
      player({ active: inPlay('A-act', ['cri-005', 'cri-006'], en(GRASS, 1, 'a')), deck: [] }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Leafy Charge')]);
    expect(empty.state.players.B.active!.damage).toBe(20);
    expect((empty.events ?? []).some(e => (e as { kind: string }).kind === 'shuffled')).toBe(true);   // CF-11: the event at any deck size
  });


  // ---------------------------------------------------------------------------------------------
  // 2026-09-09 fix batch: the 2026-09-08 full run's non-Strafe residue, TA-390 … TA-406 (see
  // docs/twinleaf-findings/fix-ledger.md, same date). Every cell below is the in-process form of a
  // corpus scenario that was driven live on both engines before and after the fix.
  // ---------------------------------------------------------------------------------------------

  const LIGHT2 = 'sve-004';
  const flipFace = (face: 'heads' | 'tails') => ({ actor: 'system' as const, type: 'flip' as const, face });
  const hasType = (r: ReturnType<typeof step>, t: string) => types(r).includes(t);

  it('Bring Down accounts the KO to the chosen Pokemon\'s OWNER: an opponent\'s Pokemon goes to THEIR discard and the attacker takes the prize [TA-391 meg-142]', () => {
    // "The Pokemon in play that has the least HP remaining, except for this Pokemon, is Knocked Out."
    // `new KnockOutEffect(player, target)` named the attacker as the owner, so choosing B's Pokemon
    // put its cards in A's discard and gave B the prize. B's lone 60-HP Ralts is the unique least-HP
    // Pokemon here, so the pick collapses and the KO lands on B's side.
    const r = step(board(
      player({ active: inPlay('A-act', ['meg-142'], en(WATER, 1, 'a')), bench: [inPlay('A-b0', [TANKY])] }),
      player({ active: inPlay('B-act', [TANKY]), bench: [inPlay('B-b0', [RALTS])] }),
    ), [attack('A-act', 'Bring Down')]);
    expect(r.events.some(e => e.kind === 'ko' && e.player === 'B')).toBe(true);
    expect(r.state.players.B.discard.some(c => c.printing === 'sit-067')).toBe(true);    // RALTS in B's discard
    expect(r.state.players.A.discard.some(c => c.printing === 'sit-067')).toBe(false);
    expect(r.pending?.actor).toBe('A');                                                    // A takes the prize
    expect(hasType(r, 'takePrize')).toBe(true);
    // control: the attacker's OWN least-HP Pokemon -> A's discard, B takes the prize.
    const own = step(board(
      player({ active: inPlay('A-act', ['meg-142'], en(WATER, 1, 'a')), bench: [inPlay('A-b0', [RALTS])] }),
      player({ active: inPlay('B-act', [TANKY]), bench: [inPlay('B-b0', [TANKY])] }),
    ), [attack('A-act', 'Bring Down')]);
    expect(own.state.players.A.discard.some(c => c.printing === 'sit-067')).toBe(true);
    expect(own.pending?.actor).toBe('B');
  });

  it('Energy Search Pro puts the chosen Energy into the HAND before the shuffle (fork regression) [TA-393 ssp-176]', () => {
    // A merge resolution of the TA-320 hunk dropped upstream's `player.deck.moveCardsTo(cards,
    // player.hand)`: the Energy was revealed, then shuffled straight back into the deck.
    const r = step(board(
      player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'esp', printing: 'ssp-176' }],
               deck: [{ iid: 'g0', printing: GRASS }, { iid: 'f0', printing: FIRE }, ...fillerDeck('A', 4)] }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [{ actor: 'A', type: 'playItem', card: 'esp' }, { actor: 'A', type: 'choose', target: 'g0' },
        { actor: 'A', type: 'confirm', value: false }] as unknown as NeutralAction[]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.hand.some(c => c.iid === 'g0')).toBe(true);
    expect(r.state.players.A.deck.some(c => c.iid === 'g0')).toBe(false);
    const shuffle = (r.pending?.legalActions ?? []).find(a => (a as { type: string }).type === 'shuffle') as { deck: string[] } | undefined;
    expect(shuffle).toBeDefined();
    expect(shuffle!.deck).not.toContain('g0');
  });

  it('Spill the Tea deals 0 when no Energy is discarded (70 x 0) [TA-392 twm-022]', () => {
    // `effect.damage = totalDiscarded * 70` sat INSIDE the transfer loop, so a zero-card pick left
    // the printed base 70 in place.
    const r = step(board(
      player({ active: inPlay('A-act', ['twm-022'], en(GRASS, 1, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Spill the Tea'), { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction]);
    expect(r.state.players.B.active!.damage).toBe(0);
    const one = step(board(
      player({ active: inPlay('A-act', ['twm-022'], en(GRASS, 1, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Spill the Tea'), { actor: 'A', type: 'discard', target: 'ae0' } as unknown as NeutralAction]);
    expect(one.state.players.B.active!.damage).toBe(70);
  });

  it('a "2 of your opponent\'s Pokemon" target pick is a FIXED count: no stop after the first target, and the forced second collapses [TA-390 tef-081 dri-142 pfl-079 twm-106 ssp-086]', () => {
    // `{ min: 1, max: 2 }` offered `confirm:false` after one target (declining halved the attack)
    // and surfaced the forced second pick. With exactly two opposing Pokemon, one pick completes it.
    const twin = step(board(
      player({ active: inPlay('A-act', ['tef-081'], en(PSY, 3, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]), bench: [inPlay('B-b0', ['meg-181'])] }),
    ), [attack('A-act', 'Twin Shotels')]);
    expect(hasType(twin, 'choose')).toBe(true);
    expect(hasType(twin, 'confirm')).toBe(false);
    const done = step(board(
      player({ active: inPlay('A-act', ['tef-081'], en(PSY, 3, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]), bench: [inPlay('B-b0', ['meg-181'])] }),
    ), [attack('A-act', 'Twin Shotels'), { actor: 'A', type: 'choose', target: 'B-act' } as unknown as NeutralAction]);
    expect(done.state.players.B.active!.damage).toBe(50);
    expect(done.state.players.B.bench[0].damage).toBe(50);
    // Sonic Double (dri-142) — the same idiom, direct prompt.
    const sonic = step(board(
      player({ active: inPlay('A-act', ['dri-142'], [...en(METAL, 2, 'm'), ...en(WATER, 1, 'w')]) }),
      // the Bench defender is NOT a Tera Pokemon ex: a Benched Tera ex (TANKY, twm-064) takes no
      // attack damage by rule, which read as a "missed" second target on the first draft of this cell.
      player({ active: inPlay('B-act', [TANKY]), bench: [inPlay('B-b0', ['meg-181'])] }),
    ), [attack('A-act', 'Sonic Double'), { actor: 'A', type: 'choose', target: 'B-b0' } as unknown as NeutralAction]);
    expect(sonic.state.players.B.active!.damage).toBe(50);
    expect(sonic.state.players.B.bench[0].damage).toBe(50);
  });

  it('Slimy Sliding: tails is a legal outcome that uses up the retreat (#2348), heads pays the cost, and an unpayable retreat is refused before any flip [TA-394 cri-068]', () => {
    // (a) `throw new GameError(BLOCKED_BY_ABILITY)` on tails made a printed outcome an invalid action;
    // (b) the intercept ran before the reducer's legality checks, so a retreat with no Energy was
    // accepted and pended a flip. B's Goodra is in play; A retreats.
    const b = (energy: CardRef[]) => board(
      player({ active: inPlay('A-act', [RALTS], energy), bench: [inPlay('A-b0', [TANKY])] }),
      player({ active: inPlay('B-act', ['cri-068']) }),
    );
    const retreat = { actor: 'A', type: 'retreat', to: 0 } as unknown as NeutralAction;
    const paused = step(b(en(WATER, 1, 'a')), [retreat]);
    expect(hasType(paused, 'flip')).toBe(true);
    const tails = step(b(en(WATER, 1, 'a')), [retreat, flipFace('tails')]);
    expect(tails.status).toBe('awaitingAction');
    expect(tails.state.players.A.active!.stack[0].printing).toBe('sit-067');   // no switch
    expect(tails.state.players.A.active!.energy.length).toBe(1);               // no Energy discarded
    expect(tails.state.players.A.flags.retreatedThisTurn).toBe(true);           // #2348: the retreat is spent
    expect(hasType(tails, 'retreat')).toBe(false);
    const heads = step(b(en(WATER, 1, 'a')), [retreat, flipFace('heads')]);
    expect(hasType(heads, 'discard')).toBe(true);                               // the cost pick follows
    const unpayable = step(b([]), [retreat]);
    expect(unpayable.status).toBe('invalidAction');
  });

  it('Turbo Flare shuffles ONCE, after the attach, on a decline [TA-395 meg-028]', () => {
    // SHUFFLE_DECK ran inside the zero-take branch of the attach callback AND unconditionally after
    // the prompt — a decline produced two shuffle pendings / two `shuffled` events.
    const b = () => board(
      player({ active: inPlay('A-act', ['meg-028'], en(FIRE, 1, 'a')), bench: [inPlay('A-b0', [RALTS])],
               deck: [{ iid: 'f0', printing: FIRE }, { iid: 'f1', printing: FIRE }, ...fillerDeck('A', 3)] }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const paused = step(b(), [attack('A-act', 'Turbo Flare'), { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction]);
    const sh = (paused.pending?.legalActions ?? []).find(a => (a as { type: string }).type === 'shuffle') as { deck: string[] } | undefined;
    expect(sh).toBeDefined();
    const after = step(b(), [attack('A-act', 'Turbo Flare'), { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction,
      { actor: 'system', type: 'shuffle', order: sh!.deck } as unknown as NeutralAction]);
    expect(after.events.filter(e => e.kind === 'shuffled').length).toBe(1);
    expect(hasType(after, 'shuffle')).toBe(false);                              // no second shuffle
  });

  it('a whiffed Summoning Jutsu still shuffles (#2303) [TA-396a cri-021]', () => {
    const r = step(board(
      player({ active: inPlay('A-act', ['cri-021'], en(WATER, 1, 'a')), deck: fillerDeck('A', 5) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Summoning Jutsu')]);
    expect(hasType(r, 'shuffle')).toBe(true);
  });

  it('Team Rocket\'s Great Ball has a TAILS branch: a Basic Team Rocket search, and the shuffle on a whiff [TA-396b asc-205]', () => {
    // The flip callback handled only heads; tails fell through to `return state` — no search, no shuffle.
    const b = () => board(
      player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'gb', printing: 'asc-205' }], deck: fillerDeck('A', 6) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const play = { actor: 'A', type: 'playItem', card: 'gb' } as unknown as NeutralAction;
    expect(hasType(step(b(), [play, flipFace('tails')]), 'shuffle')).toBe(true);
    expect(hasType(step(b(), [play, flipFace('heads')]), 'shuffle')).toBe(true);
  });

  it('Metal Maker shuffles the looked-at remainder as a bottom SEGMENT — the rest of the deck keeps its order [TA-396c tef-114]', () => {
    // `remainderDestination: 'bottom'` pushed the four cards to the bottom in look order and never
    // shuffled. Now the pending advertises just the segment (rotomancer's shape) and the answer
    // permutes only those four.
    const deck = Array.from({ length: 6 }, (_, i) => ({ iid: `d${i}`, printing: WATER }));
    const b = () => board(
      player({ active: inPlay('A-act', ['tef-114']), deck }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const use = { actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Metal Maker' } as unknown as NeutralAction;
    const paused = step(b(), [use]);
    const sh = (paused.pending?.legalActions ?? []).find(a => (a as { type: string }).type === 'shuffle') as { deck: string[] } | undefined;
    expect(sh).toBeDefined();
    expect(sh!.deck).toEqual(['d0', 'd1', 'd2', 'd3']);                          // the segment only
    const after = step(b(), [use, { actor: 'system', type: 'shuffle', order: ['d3', 'd2', 'd1', 'd0'] } as unknown as NeutralAction]);
    expect(after.state.players.A.deck.map(c => c.iid)).toEqual(['d4', 'd5', 'd3', 'd2', 'd1', 'd0']);
  });

  it('Smog Signals with Bench space still resolves (and shuffles) over an EMPTY deck (#2171) [TA-396d dri-125]', () => {
    // `if (deck.length === 0 || openSlots.length === 0) return state;` skipped the mandated search and
    // its shuffle at deck 0; only the bench-full half is #2171's carve-out. A's Koffing is hit by
    // Riptide (2 [W] in B's discard = 40); the Ability fires from the AfterDamageEffect.
    const r = step(boardKeepingEmptyDeck(
      player({ active: inPlay('A-act', ['dri-125']), deck: [] }),
      player({ active: inPlay('B-act', ['meg-034'], en(WATER, 1, 'b')), discard: en(WATER, 2, 'bd'), deck: fillerDeck('B', 4) }),
    ), [{ actor: 'A', type: 'endTurn' }, { actor: 'B', type: 'declareAttack', source: 'B-act', name: 'Riptide' }] as unknown as NeutralAction[]);
    expect(r.state.players.A.active!.damage).toBe(40);
    expect(r.events.some(e => e.kind === 'shuffled' && e.player === 'A')).toBe(true);
  });

  it('Bug Out reveals ONCE and does not shuffle when no Pokemon was revealed (§B.33 row 2) [TA-397a pbl-009]', () => {
    const r = step(board(
      player({ active: inPlay('A-act', ['pbl-009'], en(FIRE, 3, 'a')), deck: fillerDeck('A', 10) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Bug Out')]);
    expect(r.events.filter(e => e.kind === 'reveal').length).toBe(1);
    expect(hasType(r, 'shuffle')).toBe(false);
    expect(r.events.some(e => e.kind === 'shuffled')).toBe(false);
    expect(r.state.players.A.discard.length).toBe(7);
  });

  it('Poke Ball does not shuffle on TAILS — no search was performed (§B.44) [TA-397b por-080]', () => {
    // The Jungle base class serves por-080 and every other Poké Ball reprint.
    const b = () => board(
      player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'pb', printing: 'por-080' }], deck: fillerDeck('A', 6) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    );
    const play = { actor: 'A', type: 'playItem', card: 'pb' } as unknown as NeutralAction;
    const tails = step(b(), [play, flipFace('tails')]);
    expect(hasType(tails, 'shuffle')).toBe(false);
    expect(tails.events.some(e => e.kind === 'shuffled')).toBe(false);
    expect(tails.state.players.A.discard.some(c => c.iid === 'pb')).toBe(true);
    const heads = step(b(), [play, flipFace('heads')]);
    expect(hasType(heads, 'shuffle') || hasType(heads, 'choose') || hasType(heads, 'confirm')).toBe(true);
  });

  it('a retreat cost may be OVER-provided but not over-counted (#2127): the second pick offers a [G][G] Wild Growth Energy after a [W] [TA-398 meg-010]', () => {
    // `checkExactEnergy` rejected any set with a redundant card, so after one [W] toward [C][C] only
    // the other [W] was offered; the two [G] under Wild Growth ([G][G] each) were withheld.
    const r = step(board(
      player({ active: inPlay('A-act', ['meg-010'], [...en(GRASS, 2, 'g'), ...en(WATER, 2, 'w')]), bench: [inPlay('A-b0', [RALTS])] }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [{ actor: 'A', type: 'retreat', to: 0 }, { actor: 'A', type: 'discard', target: 'we0' }] as unknown as NeutralAction[]);
    const offered = (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'discard').map(a => (a as { target: string }).target).sort();
    expect(offered).toEqual(['ge0', 'ge1', 'we1']);
    // and paying with the [G][G] alone (over-providing by one unit) is accepted
    const paid = step(board(
      player({ active: inPlay('A-act', ['meg-010'], [...en(GRASS, 2, 'g'), ...en(WATER, 2, 'w')]), bench: [inPlay('A-b0', [RALTS])] }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [{ actor: 'A', type: 'retreat', to: 0 }, { actor: 'A', type: 'discard', target: 'ge0' }] as unknown as NeutralAction[]);
    expect(paid.status).toBe('awaitingAction');
    expect(paid.state.players.A.active!.stack[0].printing).toBe('sit-067');
  });

  it('a Confused attack that fails its flip is NOT recorded as the player\'s last attack (#2087) [TA-399 twm-105]', () => {
    const r = step(board(
      player({ active: inPlay('A-act', ['twm-105'], en(FIGHT, 4, 'a'), 0, ['confused']) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Gutsy Swing'), flipFace('tails')]);
    expect(r.state.players.A.active!.damage).toBe(30);
    expect(r.state.playerLastAttack?.A?.name).not.toBe('Gutsy Swing');
    const ok = step(board(
      player({ active: inPlay('A-act', ['twm-105'], en(FIGHT, 4, 'a'), 0, ['confused']) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Gutsy Swing'), flipFace('heads')]);
    expect(ok.state.playerLastAttack?.A?.name).toBe('Gutsy Swing');
  });

  it('an Ability\'s "up to N" has a floor of 1 while there is anything to choose (#2301): Golden Flame attaches a lone Fire atomically [TA-400 asc-026 ssp-059]', () => {
    const one = step(board(
      player({ active: inPlay('A-act', [RALTS]), bench: [inPlay('A-b0', ['asc-026'])], hand: en(FIRE, 1, 'h') }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [{ actor: 'A', type: 'useAbility', source: 'A-b0', ability: 'Golden Flame' }] as unknown as NeutralAction[]);
    expect(one.state.players.A.bench[0].energy.length).toBe(1);                 // attached, no pending
    expect(one.state.players.A.hand.length).toBe(0);
    const two = step(board(
      player({ active: inPlay('A-act', [RALTS]), bench: [inPlay('A-b0', ['asc-026'])], hand: en(FIRE, 2, 'h') }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [{ actor: 'A', type: 'useAbility', source: 'A-b0', ability: 'Golden Flame' }] as unknown as NeutralAction[]);
    expect(hasType(two, 'attachEnergy')).toBe(true);
    expect(hasType(two, 'confirm')).toBe(false);                                // no stop at zero picks
    // Overvolt Discharge: one Basic Energy in the discard, Magneton the only [L] -> attach, then KO.
    const ov = step(board(
      player({ active: inPlay('A-act', [RALTS]), bench: [inPlay('A-b0', ['ssp-059'])], discard: en(LIGHT2, 1, 'd') }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [{ actor: 'A', type: 'useAbility', source: 'A-b0', ability: 'Overvolt Discharge' }] as unknown as NeutralAction[]);
    expect(ov.events.some(e => e.kind === 'ko' && e.player === 'A')).toBe(true);
    expect(ov.pending?.actor).toBe('B');
  });

  it('Sacred Ash with ONE Pokemon in the discard shuffles it in with no pick surfaced (1..5, #2301 / CF-14) [TA-401 dri-168]', () => {
    const r = step(board(
      player({ active: inPlay('A-act', [RALTS]), hand: [{ iid: 'sa', printing: 'dri-168' }],
               discard: [{ iid: 'dp', printing: 'sit-067' }], deck: fillerDeck('A', 4) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [{ actor: 'A', type: 'playItem', card: 'sa' }] as unknown as NeutralAction[]);
    expect(hasType(r, 'choose')).toBe(false);
    expect(hasType(r, 'shuffle') || r.events.some(e => e.kind === 'shuffled')).toBe(true);
    expect(r.state.players.A.deck.some(c => c.iid === 'dp')).toBe(true);
  });

  it('Riptide\'s 20x lands BEFORE the shuffle pause (Step F) [TA-402 meg-034]', () => {
    const r = step(board(
      player({ active: inPlay('A-act', ['meg-034'], en(WATER, 1, 'a')), discard: en(WATER, 2, 'd'), deck: fillerDeck('A', 3) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Riptide')]);
    expect(hasType(r, 'shuffle')).toBe(true);
    expect(r.state.players.B.active!.damage).toBe(40);
  });

  it('Crescent Purge\'s face-up pick is lowered as `choose {prize iid}`, not `takePrize` [TA-403 sfa-021]', () => {
    const r = step(board(
      player({ active: inPlay('A-act', ['sfa-021'], en(PSY, 3, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Crescent Purge'), { actor: 'A', type: 'confirm', value: true } as unknown as NeutralAction]);
    expect(hasType(r, 'takePrize')).toBe(false);
    const picks = (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'choose').map(a => (a as { target: string }).target);
    expect(picks.length).toBe(6);
    expect(picks).toContain('A-pz0');
    const after = step(board(
      player({ active: inPlay('A-act', ['sfa-021'], en(PSY, 3, 'a')) }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Crescent Purge'), { actor: 'A', type: 'confirm', value: true }, { actor: 'A', type: 'choose', target: 'A-pz0' }] as unknown as NeutralAction[]);
    expect(after.state.players.A.prizes.length).toBe(6);
    expect(after.state.players.A.prizes.filter(p => p.faceUp).length).toBe(1);
  });

  it('a deck-sourced attach MOVES the card out of the deck (no duplicate), so the following shuffle lists the real deck [TA-406 dri-044]', () => {
    // AttachEnergyEffect's reducer did `hand.moveCardTo(...)` — a silent no-op for a deck-sourced
    // Energy, which stayed in the deck AND joined `energies`; the shuffle pending listed it.
    const r = step(board(
      player({ active: inPlay('A-act', ['dri-044'], en(WATER, 1, 'a')),
               deck: [{ iid: 'f0', printing: FIRE }, ...fillerDeck('A', 4)] }),
      player({ active: inPlay('B-act', [TANKY]) }),
    ), [attack('A-act', 'Fire Kagura'), { actor: 'A', type: 'attachEnergy', card: 'f0', target: 'A-act' } as unknown as NeutralAction]);
    expect(r.state.players.A.active!.energy.some(c => c.iid === 'f0')).toBe(true);
    expect(r.state.players.A.deck.some(c => c.iid === 'f0')).toBe(false);
    const sh = (r.pending?.legalActions ?? []).find(a => (a as { type: string }).type === 'shuffle') as { deck: string[] } | undefined;
    expect(sh).toBeDefined();
    expect(sh!.deck).not.toContain('f0');
    expect(sh!.deck.length).toBe(4);
  });

});
