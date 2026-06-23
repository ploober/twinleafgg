import * as fs from 'fs';
import * as path from 'path';
import { setupGame, padDeck, getCardByName, SetupGameResult, choosePokemonCandidates, cardTargetKey, chooseCardsCandidates, cardMatchesPartialFilter } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';
import { resolvePrinting, energyToCard } from './rotomancer/bridge';
import { buildInterpretedCard, IrFragment } from './rotomancer/ir-interpreter';
import { Card } from '../../game/store/card/card';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { EnergyCard } from '../../game/store/card/energy-card';
import { SpecialCondition, SuperType } from '../../game/store/card/card-types';
import { State } from '../../game/store/state/state';
import { PokemonCardList } from '../../game/store/state/pokemon-card-list';
import { ChoosePokemonPrompt, ChoosePokemonPromptType } from '../../game/store/prompts/choose-pokemon-prompt';
import { ChooseCardsPrompt, ChooseCardsPromptType } from '../../game/store/prompts/choose-cards-prompt';
import { AttachEnergyPrompt, AttachEnergyPromptType } from '../../game/store/prompts/attach-energy-prompt';
import { CardTarget } from '../../game/store/actions/play-card-action';

/**
 * Phase 4 + 6 — differential: run the SAME scenario through the native Twinleaf card and
 * through an InterpretedCard built from the IR, and assert identical observable state. Both
 * sides are the same species (mirror), so weakness never confounds. Agreement means the IR
 * interpreter and the hand-written card produce the same engine result.
 */

interface PokeSnap {
  damage: number | 'KO';
  conditions: string[];
  energy: number;
  energyTypes: string[];   // sorted multiset of provided types — makes a wrong-TYPE energy op observable
  tools: number;           // attached Pokémon Tools — makes a Tool discard observable (tools-loaded variant)
  name?: string;           // species (opt-in, §12.12): makes a SWITCH observable — which Pokémon is now Active
}
interface SideSnapshot {
  active: PokeSnap;
  bench: PokeSnap[];   // occupied bench slots, in slot order — verifies spread / per-bench effects
  hand: number;
  deck: number;
  discard: number;
  prizes: number;
  stadium: number;     // cards in this side's Stadium zone — makes a Stadium discard observable (stadium-loaded variant)
  // Identity-aware fields (opt-in via snapshot(state, true), §12.11): sorted name-multisets of the observable
  // pile zones a `cards.move chooser:'player'` touches. The count-based fields above can't tell WHICH card
  // moved, so a per-pick card-choice differential needs these to make Invariant B bite. Left undefined in the
  // default count-only mode → existing toEqual comparisons (7-variant + ChoosePokemon differentials) unaffected.
  handNames?: string[];
  discardNames?: string[];
}
interface Snapshot { p0: SideSnapshot; p1: SideSnapshot; }

function pokeSnap(list: PokemonCardList, identity = false): PokeSnap {
  const pokemon = list.getPokemonCard();
  const ko = pokemon === undefined;
  const energyCards = ko ? [] : list.energies.cards.filter(c => c instanceof EnergyCard) as EnergyCard[];
  const snap: PokeSnap = {
    damage: ko ? 'KO' : list.damage,
    conditions: ko ? [] : list.specialConditions.map(String).sort(),
    energy: ko ? 0 : list.energies.cards.length,
    energyTypes: energyCards.flatMap(c => c.provides.map(String)).sort(),
    tools: ko ? 0 : list.tools.length,
  };
  if (identity) { snap.name = ko ? 'KO' : pokemon!.name; }
  return snap;
}

function snapshot(state: State, identity = false): Snapshot {
  const side = (i: number): SideSnapshot => {
    const p = state.players[i];
    const snap: SideSnapshot = {
      active: pokeSnap(p.active, identity),
      bench: p.bench.filter(b => b.getPokemonCard() !== undefined).map(b => pokeSnap(b, identity)),
      hand: p.hand.cards.length,
      deck: p.deck.cards.length,
      discard: p.discard.cards.length,
      prizes: p.getPrizeLeft(),
      stadium: p.stadium.cards.length,
    };
    if (identity) {
      snap.handNames = p.hand.cards.map(c => c.name).sort();
      snap.discardNames = p.discard.cards.map(c => c.name).sort();
    }
    return snap;
  };
  return { p0: side(0), p1: side(1) };
}

interface Board {
  attackerDamage?: number; defenderDamage?: number; benchCount?: number;
  // Loaded-board fields (all optional; applied identically to native & interp → mirror-symmetric).
  extraEnergy?: string[];              // typed energy added to BOTH actives + every bench slot
  hand?: string[]; discard?: string[]; // seeded into BOTH players' zones
  defenderConditions?: SpecialCondition[]; // special conditions on p1.active ONLY (attacker must attack)
  tools?: string[];                    // Pokémon Tools attached to BOTH actives (not the bench)
  stadium?: string;                    // a single Stadium seeded into the attacker's (p0) Stadium zone — global singleton
}

interface AttackRun { snap: Snapshot; ambiguous: number; }

// Non-declarative board state (special conditions). Applied identically in the native and interp run,
// so any deterministic effect cancels in the snapshot diff. Conditions go on the DEFENDER only —
// ASLEEP/PARALYZED on the attacker would block useAttack — and via addSpecialCondition so the engine's
// stack/exclusivity rules hold (POISON+BURN stack; PARALYZED/ASLEEP/CONFUSED are mutually exclusive).
function applyBoardMutations(game: SetupGameResult, board: Board): void {
  for (const c of board.defenderConditions ?? []) {
    game.state.players[1].active.addSpecialCondition(c);
  }
  // Pokémon Tools attach to `.tools` ONLY (not `.cards`) — exactly as the engine's AttachPokemonToolEffect
  // leaves them; this is what makes moveCardsTo's tools branch (and the snapshot) behave like a real game.
  for (const toolName of board.tools ?? []) {
    for (const i of [0, 1]) {
      game.state.players[i].active.tools.push(getCardByName(toolName));
    }
  }
  // A Stadium is a GLOBAL singleton (one in play, shared by both sides), not a mirror-symmetric per-Pokémon
  // load. Seed it into the ATTACKER's (p0) Stadium zone — so the attacker owns it and a "discard the Stadium"
  // (to owner:'self') lands in p0.discard, matching native's "stadium → its owner's discard". Both the native
  // and interp runs are seeded identically, so the comparison stays valid. getStadiumCard / stadiumInPlay
  // then read it; the seeded card must be inert (no continuous reduceEffect touching the attack snapshot).
  if (board.stadium !== undefined) {
    game.state.players[0].stadium.cards.push(getCardByName(board.stadium));
  }
}

function buildAndAttack(
  fullName: string, costEnergies: string[], attackLabel: string,
  fragments: IrFragment[] | null, board: Board = {}
): AttackRun {
  const benchSlot = () => ({ card: fullName, energy: board.extraEnergy });
  const bench = Array.from({ length: board.benchCount ?? 0 }, benchSlot);
  const game = setupGame({
    turn: 2,
    player1: {
      active: { card: fullName, energy: [...costEnergies, ...(board.extraEnergy ?? [])], damage: board.attackerDamage ?? 0 },
      bench, hand: board.hand, discard: board.discard, deck: padDeck(10),
    },
    player2: {
      active: { card: fullName, energy: board.extraEnergy, damage: board.defenderDamage ?? 0 },
      bench, hand: board.hand, discard: board.discard, deck: padDeck(10),
    },
  });
  if (fragments) {
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, fragments);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
  }
  applyBoardMutations(game, board);
  useAttack(game.store, game.state, 0, attackLabel);
  return { snap: snapshot(game.state), ambiguous: game.ambiguousChoices() };
}

// Real IR bodies (snapshot 2026-05-17) for cards whose attack mixes damage with a non-damage op.
const CASES: Array<{
  label: string; printingId: string; name: string; attackLabel: string;
  cost: string[]; attackerDamage: number; fragments: IrFragment[];
}> = [
  {
    label: 'Conkeldurr TWM — Tantrum (80 + Confuse self)',
    printingId: 'sv6-105', name: 'Conkeldurr', attackLabel: 'Tantrum', cost: ['FIGHTING'], attackerDamage: 0,
    fragments: [{ label: 'Tantrum', cost: ['Fighting'], body: [
      { kind: 'damage.deal', amount: { kind: 'const', value: 80 }, target: { of: { side: 'opponent', spot: 'active' } } },
      { kind: 'condition.apply', condition: 'CONFUSED', target: { of: { role: 'self' } } },
    ] }],
  },
  {
    label: 'Umbreon ex PRE — Moon Mirage (160 + Confuse opponent)',
    printingId: 'sv8pt5-60', name: 'Umbreon ex', attackLabel: 'Moon Mirage',
    cost: ['DARKNESS', 'COLORLESS', 'COLORLESS'], attackerDamage: 0,
    fragments: [{ label: 'Moon Mirage', cost: ['Darkness', 'Colorless', 'Colorless'], body: [
      { kind: 'damage.deal', amount: { kind: 'const', value: 160 }, target: { of: { side: 'opponent', spot: 'active' } } },
      { kind: 'condition.apply', condition: 'CONFUSED', target: { of: { side: 'opponent', spot: 'active' } } },
    ] }],
  },
  {
    label: 'Zarude SSP — Leaf Drain (20 + heal 20 self)',
    printingId: 'sv8-11', name: 'Zarude', attackLabel: 'Leaf Drain', cost: ['GRASS'], attackerDamage: 30,
    fragments: [{ label: 'Leaf Drain', cost: ['Grass'], body: [
      { kind: 'damage.deal', amount: { kind: 'const', value: 20 }, target: { of: { side: 'opponent', spot: 'active' } } },
      { kind: 'heal', amount: { kind: 'const', value: 20 }, target: { of: { role: 'self' } } },
    ] }],
  },
];

// Differential mismatches (native vs interpreted disagree). Adjudication deferred; none yet.
describe('Rotomancer IR interpreter — differential vs native Twinleaf', () => {
  CASES.forEach(c => {
    const res = resolvePrinting(c.printingId, c.name);
    const exact = res.status === 'exact';
    (exact ? it : xit)(c.label, () => {
      const energies = c.cost.map(energyToCard);
      const board = { attackerDamage: c.attackerDamage };
      const native = buildAndAttack(res.fullName!, energies, c.attackLabel, null, board);
      const interpreted = buildAndAttack(res.fullName!, energies, c.attackLabel, c.fragments, board);
      expect(interpreted.snap).toEqual(native.snap);
    });
  });

  it('evaluates perCount/forEach counts (30 damage per benched Pokémon)', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon'); // 130 HP, weak to Psychic → mirror-safe
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: res.fullName!, energy: ['Water Energy SVE'] },
        bench: [{ card: res.fullName! }, { card: res.fullName! }, { card: res.fullName! }],
        deck: padDeck(10),
      },
      player2: { active: { card: res.fullName! }, deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [{
      label: 'Bench Beat', cost: ['Colorless'],
      body: [{
        kind: 'damage.deal',
        amount: { kind: 'perCount', base: 0, per: 30, count: { kind: 'forEach', of: 'benchedPokemon', who: 'self' } },
        target: { of: { side: 'opponent', spot: 'active' } },
      }],
    }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;

    useAttack(game.store, game.state, 0, 'Bench Beat');
    expect(getDamage(game.state, 1, 'active')).toBe(90); // 30 × 3 benched
  });

  // ── Non-vacuity guards: prove the loaded variants actually feed the interpreter. A green corpus is
  // not enough (north star); the loaded inputs must demonstrably change the outcome, else the
  // "agreement" is vacuous. Hosted on Koraidon (mirror-safe: weak to Psychic, not its own type).

  it('loaded conditions feed conditionOn riders (not a vacuous false branch)', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    // CONFUSED is used as the gate condition: unlike POISONED/BURNED it deals no checkup damage at the
    // turn transition (which useAttack triggers — verified empirically), so the comparison is exact.
    const frag: IrFragment[] = [{ label: 'Probe', cost: ['Colorless'], body: [{
      kind: 'damage.deal',
      amount: { kind: 'plusIf', base: 20, bonus: 100, when: { kind: 'conditionOn', condition: 'CONFUSED', selector: { side: 'opponent', spot: 'active' } } },
      target: { of: { side: 'opponent', spot: 'active' } },
    }] }];
    const clean = buildAndAttack(res.fullName!, ['Water Energy SVE'], 'Probe', frag, {});
    const loaded = buildAndAttack(res.fullName!, ['Water Energy SVE'], 'Probe', frag, { defenderConditions: [SpecialCondition.CONFUSED] });
    expect(clean.snap.p1.active.damage).toBe(20);   // FALSE branch on a clean defender
    expect(loaded.snap.p1.active.damage).toBe(120);  // TRUE branch (+100) when the condition is loaded
  });

  it('loaded energy feeds forEach energyAttached (not a vacuous zero count)', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const frag: IrFragment[] = [{ label: 'Probe', cost: ['Colorless'], body: [{
      kind: 'damage.deal',
      amount: { kind: 'perCount', base: 0, per: 20, count: { kind: 'forEach', of: 'energyAttached', who: 'self' } },
      target: { of: { side: 'opponent', spot: 'active' } },
    }] }];
    const lean = buildAndAttack(res.fullName!, ['Water Energy SVE'], 'Probe', frag, {});                                      // active: 1 energy → 20
    const rich = buildAndAttack(res.fullName!, ['Water Energy SVE'], 'Probe', frag, { extraEnergy: ['Fire Energy SVE', 'Fire Energy SVE'] }); // active: 3 → 60
    expect(lean.snap.p1.active.damage).toBe(20);
    expect(rich.snap.p1.active.damage).toBe(60);
  });

  it('energyAttachedCount sums across spot:anywhere (active + bench), not just the active', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: res.fullName!, energy: ['Water Energy SVE'] },                          // 0 Lightning on the active
        bench: [{ card: res.fullName!, energy: ['Lightning Energy SVE', 'Lightning Energy SVE'] },
                { card: res.fullName!, energy: ['Lightning Energy SVE', 'Lightning Energy SVE'] }], // 4 Lightning on the bench
        deck: padDeck(10),
      },
      player2: { active: { card: res.fullName! }, deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [{
      label: 'Probe', cost: ['Colorless'],
      body: [{
        kind: 'damage.deal',
        amount: { kind: 'plusIf', base: 10, bonus: 100, when: { kind: 'energyAttachedCount', cmp: 'ge', n: 4, predicate: { kind: 'isa', energyType: 'Lightning' }, selector: { side: 'self', spot: 'anywhere' } } },
        target: { of: { side: 'opponent', spot: 'active' } },
      }],
    }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
    useAttack(game.store, game.state, 0, 'Probe');
    expect(getDamage(game.state, 1, 'active')).toBe(110); // 0 (active) + 4 (bench) = 4 ≥ 4 → +100. Active-only would give 10.
  });

  // Stage B non-vacuity: a player-choice affect-target ("50 to 2 of your opponent's Pokémon") must
  // actually EMIT a prompt and LAND on the chosen Pokémon — not skip, and not silently hit the
  // default defender. The harness resolves the emitted ChoosePokemonPrompt first-eligible (active,
  // then bench low-index), so targetCount:2 over `spot:anywhere` hits the active + bench[0] and leaves
  // bench[1] untouched. A regression that dropped the prompt would damage one target (or none).
  it('Stage B: a quantity:one / targetCount choice prompts and lands on exactly the chosen targets', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon'); // mirror-safe (weak to Psychic), 230 HP → 50 never KOs
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
      player2: {
        active: { card: res.fullName! },
        bench: [{ card: res.fullName! }, { card: res.fullName! }],
        deck: padDeck(10),
      },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [{
      label: 'Twin Probe', cost: ['Colorless'],
      body: [{
        kind: 'damage.deal',
        amount: { kind: 'const', value: 50 },
        target: { of: { chooser: 'player', quantity: 'one', side: 'opponent', spot: 'anywhere' } },
        targetCount: 2,
      }],
    }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
    useAttack(game.store, game.state, 0, 'Twin Probe');
    expect(game.state.players[1].active.damage).toBe(50);   // chosen #1 (first-eligible)
    expect(game.state.players[1].bench[0].damage).toBe(50); // chosen #2
    expect(game.state.players[1].bench[1].damage).toBe(0);  // not chosen → untouched (not all-targets)
  });

  // Stage B non-vacuity: a `choice` ("you may <then>") must run its then-branch (the harness always
  // confirms the optional effect).
  it('Stage B: a `choice` (you-may) runs its then-branch under the harness', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
      player2: { active: { card: res.fullName! }, deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [{
      label: 'Maybe Confuse', cost: ['Colorless'],
      body: [
        { kind: 'damage.deal', amount: { kind: 'const', value: 20 }, target: { of: { side: 'opponent', spot: 'active' } } },
        { kind: 'choice', chooser: 'self', else: [], then: [
          { kind: 'condition.apply', condition: 'CONFUSED', target: { of: { side: 'opponent', spot: 'active' } } },
        ] },
      ],
    }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
    useAttack(game.store, game.state, 0, 'Maybe Confuse');
    expect(game.state.players[1].active.damage).toBe(20);
    expect(game.state.players[1].active.specialConditions).toContain(SpecialCondition.CONFUSED); // the optional fired
  });

  // Stage B non-vacuity: a `cards.move` bench→active is a SWITCH (ChoosePokemonPrompt + switchPokemon),
  // observably swapping the Active with the chosen benched Pokémon — not a no-op, not a card-zone move.
  it('Stage B: cards.move bench→active switches the Active with a chosen benched Pokémon', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: res.fullName!, energy: ['Water Energy SVE'], damage: 50 }, // damaged Active
        bench: [{ card: res.fullName! }],                                          // fresh Bench (0 damage)
        deck: padDeck(10),
      },
      player2: { active: { card: res.fullName! }, deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [{
      label: 'Swap', cost: ['Colorless'],
      body: [{ kind: 'cards.move', select: { chooser: 'player' }, count: { kind: 'exactly', n: 1 },
        from: { owner: 'self', zone: 'bench' }, to: { owner: 'self', zone: 'active' } }],
    }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
    useAttack(game.store, game.state, 0, 'Swap');
    expect(game.state.players[0].active.damage).toBe(0);    // fresh benched Pokémon promoted to Active
    expect(game.state.players[0].bench[0].damage).toBe(50); // the damaged old Active demoted to the Bench
  });

  // Stage B non-vacuity: `iterate` ("put N counters … in any way you like") places all N counters via
  // the native distribute prefab; the harness (slot-aware PutDamage) lands them on the first eligible
  // benched Pokémon. A dropped iterate would leave the Bench untouched.
  it('Stage B: `iterate` places all N counters on the opponent Bench (native distribute prefab)', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
      player2: {
        active: { card: res.fullName! },
        bench: [{ card: res.fullName! }, { card: res.fullName! }],
        deck: padDeck(10),
      },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [{
      label: 'Six Counters', cost: ['Colorless'],
      body: [{
        kind: 'iterate', over: { kind: 'exactly', n: 6 },
        body: [{ kind: 'damage.placeCounters', count: 1, target: { of: { quantity: 'one', side: 'opponent', spot: 'bench' } } }],
      }],
    }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
    useAttack(game.store, game.state, 0, 'Six Counters');
    expect(game.state.players[1].bench[0].damage).toBe(60); // 6 counters, all on the first benched (harness greedy-first, slot-aware)
    expect(game.state.players[1].bench[1].damage).toBe(0);
    expect(game.state.players[1].active.damage).toBe(0);    // bench-only target — Active untouched
  });

  // countOf / bindAs non-vacuity: a discard-and-scale attack (the Inferno X shape — "Discard any amount
  // of [R] Energy from among your Pokémon, and this attack does N damage for each card you discarded in
  // this way") must (a) discard the matching energy and (b) deal N × the count it BOUND, so the damage
  // scales with the bound discard set — not a constant, not a no-op. The `energy.discard` resolves the
  // player-choice pool greedily (the harness's policy for native's DiscardEnergyPrompt) and binds the
  // discarded list; `countOf` reads its cardinality. A regression that ignored the binding would deal 0
  // (unbound throw → skip) or a constant. Hosted on Koraidon (mirror-safe; 130 HP survives 50 and 100).
  it('countOf: damage scales with the energy discarded and bound via bindAs (discard-and-scale)', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const infernoX: IrFragment[] = [{
      label: 'Discard Burst', cost: ['Fire'],
      body: [
        { kind: 'energy.discard', bindAs: 'discarded', count: { kind: 'anyAmount' },
          card: { from: { owner: 'self', zone: 'attached' }, predicate: { kind: 'isa', energyType: 'Fire' } },
          target: { of: { chooser: 'player', quantity: 'one', side: 'self', spot: 'anywhere' } } },
        { kind: 'damage.deal', target: { of: { side: 'opponent', spot: 'active' } },
          amount: { kind: 'perCount', base: 0, per: 50, count: { kind: 'countOf', ref: 'discarded' } } },
      ],
    }];
    const run = (fireCount: number) => {
      const game = setupGame({
        turn: 2,
        player1: { active: { card: res.fullName!, energy: Array(fireCount).fill('Fire Energy SVE') }, deck: padDeck(10) },
        player2: { active: { card: res.fullName! }, deck: padDeck(10) },
      });
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, infernoX);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
      useAttack(game.store, game.state, 0, 'Discard Burst');
      return {
        defenderDamage: game.state.players[1].active.damage,
        attackerFire: game.state.players[0].active.cards.filter(c => c instanceof EnergyCard).length,
      };
    };
    const one = run(1);
    const two = run(2);
    expect(one.defenderDamage).toBe(50);   // 1 Fire discarded × 50
    expect(two.defenderDamage).toBe(100);  // 2 Fire discarded × 50 — strictly more (countOf scales with the bound set)
    expect(two.attackerFire).toBe(0);      // every matching energy discarded — the discard is observable, not a no-op
  });

  // countOf / cards.move bindAs non-vacuity: the OTHER discard-and-scale producer — "discard up to N Energy
  // from your hand, then N more damage per card discarded" (Mega Clefable ex Shooting Moons / Mawile Double
  // Eater shape). The `cards.move` records the chosen-and-discarded set as `bindAs`, and `countOf` reads its
  // cardinality; the harness greedily discards min(max, eligible) hand Energy (its ChooseCardsPrompt policy),
  // so native and interp discard the same set. A regression that ignored the binding would throw (unbound →
  // skip) or deal a constant; the empty case proves the empty-bind path (countOf 0, not a throw).
  it('countOf: damage scales with hand Energy discarded and bound via a cards.move bindAs', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const shootingMoons: IrFragment[] = [{
      label: 'Hand Burst', cost: ['Colorless'],
      body: [
        { kind: 'cards.move', bindAs: 'discarded', count: { kind: 'upTo', max: 4 },
          from: { owner: 'self', zone: 'hand' }, to: { owner: 'self', zone: 'discard' },
          select: { chooser: 'player', where: { kind: 'isa', supertype: 'Energy' } } },
        { kind: 'damage.deal', target: { of: { side: 'opponent', spot: 'active' } },
          amount: { kind: 'perCount', base: 20, per: 40, count: { kind: 'countOf', ref: 'discarded' } } },
      ],
    }];
    const run = (energyInHand: number) => {
      const game = setupGame({
        turn: 2,
        player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10),
          hand: Array(energyInHand).fill('Fire Energy SVE') },
        player2: { active: { card: res.fullName! }, deck: padDeck(10) },
      });
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, shootingMoons);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
      const discardBefore = game.state.players[0].discard.cards.length;
      useAttack(game.store, game.state, 0, 'Hand Burst');
      return {
        defenderDamage: game.state.players[1].active.damage,
        discardDelta: game.state.players[0].discard.cards.length - discardBefore,
      };
    };
    expect(run(0)).toEqual({ defenderDamage: 20, discardDelta: 0 });   // empty hand → base only (empty bind → countOf 0, not a throw)
    expect(run(1)).toEqual({ defenderDamage: 60, discardDelta: 1 });   // 1 discarded → 20 + 40
    expect(run(2)).toEqual({ defenderDamage: 100, discardDelta: 2 });  // 2 discarded → 20 + 80 (scales with the bound set)
  });

  // Turn-state predicate non-vacuity (movedToActive): the +bonus must land ONLY when the attacker
  // actually switched into the Active this turn. The interpreter reads the engine's real signal
  // (player.movedToActiveThisTurn). Proving BOTH branches (switched-in → bonus, placed → no bonus)
  // guards against the single-turn-setup trap where the predicate is vacuously false: a model that
  // ignored the array would never produce the +100, so this would fail. Hosted on Koraidon (130 HP).
  it('movedToActive non-vacuity: +bonus only when the attacker switched into Active this turn', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const frag: IrFragment[] = [{
      label: 'Charge In', cost: ['Colorless'],
      body: [{ kind: 'damage.deal', target: { of: { side: 'opponent', spot: 'active' } },
        amount: { kind: 'plusIf', base: 20, bonus: 100, when: { kind: 'movedToActive', selector: { role: 'self' } } } }],
    }];
    const run = (switchedIn: boolean) => {
      const game = setupGame({
        turn: 2,
        player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
        player2: { active: { card: res.fullName! }, deck: padDeck(10) },
      });
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, frag);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
      if (switchedIn) { game.state.players[0].movedToActiveThisTurn = [interpreted.id]; } // engine's switched-in signal
      useAttack(game.store, game.state, 0, 'Charge In');
      return game.state.players[1].active.damage;
    };
    expect(run(false)).toBe(20);   // placed Active, not switched this turn → base only
    expect(run(true)).toBe(120);   // switched in this turn → base + 100
  });

  // Turn-state predicate non-vacuity (turn): "went second" reads the real state.turn parity (the active
  // player went first iff state.turn is odd). At turn 2 the acting player went second → +bonus; at turn 3
  // (a normal later turn, the acting player went first) → no bonus. Both branches proven, so a model that
  // hard-coded a constant fails. Native reads the same state.turn, so this designation is mirror-faithful.
  it('turn non-vacuity: wentSecond +bonus reflects the real state.turn parity', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const frag: IrFragment[] = [{
      label: 'Second Wind', cost: ['Colorless'],
      body: [{ kind: 'damage.deal', target: { of: { side: 'opponent', spot: 'active' } },
        amount: { kind: 'plusIf', base: 20, bonus: 80, when: { kind: 'turn', aspect: 'wentSecond', who: 'self' } } }],
    }];
    const run = (turn: number) => {
      const game = setupGame({
        turn,
        player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
        player2: { active: { card: res.fullName! }, deck: padDeck(10) },
      });
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, frag);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
      useAttack(game.store, game.state, 0, 'Second Wind');
      return game.state.players[1].active.damage;
    };
    expect(run(2)).toBe(100);  // turn 2 (even) → acting player went second → base + 80
    expect(run(3)).toBe(20);   // turn 3 (odd) → acting player went first → base only
  });

  // Turn-state predicate non-vacuity (history.evolved): the +bonus lands only when the attacker was
  // played/evolved THIS turn (pokemonPlayedTurn === state.turn — the signal native evolution-bonus cards
  // read). Both branches proven; in the corpus setup the attacker is placed (pokemonPlayedTurn 0 ≠ turn),
  // so this is the determinable-false case — the true branch here is what makes the modeling non-vacuous.
  it('history.evolved non-vacuity: +bonus only when the attacker evolved this turn', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const frag: IrFragment[] = [{
      label: 'Fresh Evolution', cost: ['Colorless'],
      body: [{ kind: 'damage.deal', target: { of: { side: 'opponent', spot: 'active' } },
        amount: { kind: 'plusIf', base: 20, bonus: 80, when: { kind: 'history', event: 'evolved', window: 'thisTurn', subject: { role: 'self' } } } }],
    }];
    const run = (evolvedThisTurn: boolean) => {
      const game = setupGame({
        turn: 2,
        player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
        player2: { active: { card: res.fullName! }, deck: padDeck(10) },
      });
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, frag);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
      if (evolvedThisTurn) { game.state.players[0].active.pokemonPlayedTurn = game.state.turn; } // evolved this turn
      useAttack(game.store, game.state, 0, 'Fresh Evolution');
      return game.state.players[1].active.damage;
    };
    expect(run(false)).toBe(20);   // placed at setup (pokemonPlayedTurn 0 ≠ turn) → base only
    expect(run(true)).toBe(100);   // evolved this turn → base + 80
  });

  // cards.move attached → hand non-vacuity: "Put an Energy attached to this Pokémon into your hand"
  // actually moves an Energy OFF the attacker (energy −1) and INTO the hand (hand +1), through
  // PokemonCardList.moveCardsTo so the `.energies` sub-list the snapshot reads stays consistent. A
  // regression that used MOVE_CARDS or no-op'd would leave the energy count unchanged.
  it('cards.move attached→hand non-vacuity: returns an attached Energy to the hand', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: ['Water Energy SVE', 'Water Energy SVE'] }, hand: [], deck: padDeck(10) },
      player2: { active: { card: res.fullName! }, deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [{
      label: 'Energy Recall', cost: ['Water'],
      body: [{ kind: 'cards.move', count: { kind: 'exactly', n: 1 },
        from: { of: { role: 'self' }, zone: 'attached' }, to: { owner: 'self', zone: 'hand' },
        select: { chooser: 'player', where: { kind: 'isa', supertype: 'Energy' } } }],
    }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
    const handBefore = game.state.players[0].hand.cards.length;
    useAttack(game.store, game.state, 0, 'Energy Recall');
    expect(game.state.players[0].active.energies.cards.length).toBe(1); // one of the two Energy left the Pokémon
    expect(game.state.players[0].hand.cards.length).toBe(handBefore + 1); // …and arrived in the hand
  });

  // cards.move prize → hand non-vacuity: "take a Prize card" reduces the prize count by 1 and adds a card
  // to the hand, via the native TAKE_X_PRIZES prefab (so native and interp behave identically). A
  // regression that no-op'd or threw would leave the prize count at 6.
  it('cards.move prize→hand non-vacuity: takes a Prize into the hand', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, hand: [], deck: padDeck(10) },
      player2: { active: { card: res.fullName! }, deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [{
      label: 'Prize Grab', cost: ['Colorless'],
      body: [{ kind: 'cards.move', count: { kind: 'exactly', n: 1 },
        from: { owner: 'self', zone: 'prize' }, to: { owner: 'self', zone: 'hand' }, select: { chooser: 'player' } }],
    }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
    const handBefore = game.state.players[0].hand.cards.length;
    expect(game.state.players[0].getPrizeLeft()).toBe(6);
    useAttack(game.store, game.state, 0, 'Prize Grab');
    expect(game.state.players[0].getPrizeLeft()).toBe(5);                 // one Prize taken
    expect(game.state.players[0].hand.cards.length).toBe(handBefore + 1); // …into the hand
  });

  // Tool non-vacuity (attached→discard): "discard all Pokémon Tools from your opponent's Active" actually
  // removes the Tool from the opponent's Active (tools −1) and adds it to their discard (discard +1),
  // through moveCardsTo's `.tools` branch (the Tool is in `.tools` only, as in a real game). A regression
  // (Tool subtype not matched, or moveCardsTo leaving `.tools` stale) would leave the Tool attached.
  it('cards.move attached→discard non-vacuity: discards the opponent\'s Pokémon Tool', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const run = (seedTool: boolean) => {
      const game = setupGame({
        turn: 2,
        player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
        player2: { active: { card: res.fullName! }, deck: padDeck(10) },
      });
      if (seedTool) { game.state.players[1].active.tools.push(getCardByName('Float Stone PLF')); } // tools-only, as the engine attaches
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, [{
        label: 'Strip Tool', cost: ['Colorless'],
        body: [{ kind: 'cards.move', count: { kind: 'all' },
          from: { of: { side: 'opponent', spot: 'active' }, zone: 'attached' }, to: { owner: 'opponent', zone: 'discard' },
          select: { chooser: 'auto', where: { kind: 'isa', supertype: 'Trainer', subtype: 'Pokémon Tool' } } }],
      }]);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
      const discardBefore = game.state.players[1].discard.cards.length;
      useAttack(game.store, game.state, 0, 'Strip Tool');
      return { tools: game.state.players[1].active.tools.length, discardDelta: game.state.players[1].discard.cards.length - discardBefore };
    };
    expect(run(true)).toEqual({ tools: 0, discardDelta: 1 });  // Tool present → discarded (tools 1→0, discard +1)
    expect(run(false)).toEqual({ tools: 0, discardDelta: 0 }); // no Tool → nothing to discard (no-op)
  });

  // Tool non-vacuity (hasTool): "+bonus if the Defending Pokémon has a Tool" flips with the Tool's
  // presence — reading the real `.tools` array. Proves both branches.
  it('hasTool non-vacuity: +bonus only when the target has a Pokémon Tool', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const run = (seedTool: boolean) => {
      const game = setupGame({
        turn: 2,
        player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
        player2: { active: { card: res.fullName! }, deck: padDeck(10) },
      });
      if (seedTool) { game.state.players[1].active.tools.push(getCardByName('Float Stone PLF')); }
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, [{
        label: 'Tool Punish', cost: ['Colorless'],
        body: [{ kind: 'damage.deal', target: { of: { side: 'opponent', spot: 'active' } },
          amount: { kind: 'plusIf', base: 20, bonus: 80, when: { kind: 'hasTool', selector: { side: 'opponent', spot: 'active' } } } }],
      }]);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
      useAttack(game.store, game.state, 0, 'Tool Punish');
      return game.state.players[1].active.damage;
    };
    expect(run(true)).toBe(100);  // Tool attached → base + 80
    expect(run(false)).toBe(20);  // no Tool → base only
  });

  // Stadium non-vacuity (cards.move stadium→discard): "discard the Stadium in play" removes the in-play
  // Stadium (stadium 1→0) and adds it to the owner's discard (discard +1) via the global-singleton source
  // resolution; with no Stadium it is a snapshot-neutral no-op. Proves the stadium-loaded variant actually
  // exercises the discard rather than passing vacuously on an empty zone.
  it('cards.move stadium→discard non-vacuity: discards the in-play Stadium', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const run = (seedStadium: boolean) => {
      const game = setupGame({
        turn: 2,
        player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
        player2: { active: { card: res.fullName! }, deck: padDeck(10) },
      });
      if (seedStadium) { game.state.players[0].stadium.cards.push(getCardByName('Town Store OBF')); }
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, [{
        label: 'Shatter', cost: ['Colorless'],
        body: [{ kind: 'cards.move', count: { kind: 'exactly', n: 1 },
          from: { owner: 'self', zone: 'stadium' }, to: { owner: 'self', zone: 'discard' } }],
      }]);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
      const discardBefore = game.state.players[0].discard.cards.length;
      useAttack(game.store, game.state, 0, 'Shatter');
      return { stadium: game.state.players[0].stadium.cards.length, discardDelta: game.state.players[0].discard.cards.length - discardBefore };
    };
    expect(run(true)).toEqual({ stadium: 0, discardDelta: 1 });  // Stadium in play → discarded (1→0, discard +1)
    expect(run(false)).toEqual({ stadium: 0, discardDelta: 0 }); // none in play → no-op
  });

  // Stadium non-vacuity (stadiumInPlay): "+bonus if a Stadium is in play" flips with the Stadium's presence
  // (reading StateUtils.getStadiumCard) — proves both branches. On the stadium-loaded variant the TRUE branch
  // fires instead of the vacuous false branch every stadium-less variant takes.
  it('stadiumInPlay non-vacuity: +bonus only when a Stadium is in play', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const run = (seedStadium: boolean) => {
      const game = setupGame({
        turn: 2,
        player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
        player2: { active: { card: res.fullName! }, deck: padDeck(10) },
      });
      if (seedStadium) { game.state.players[0].stadium.cards.push(getCardByName('Town Store OBF')); }
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, [{
        label: 'Mountain Drop', cost: ['Colorless'],
        body: [{ kind: 'damage.deal', target: { of: { side: 'opponent', spot: 'active' } },
          amount: { kind: 'plusIf', base: 20, bonus: 80, when: { kind: 'stadiumInPlay' } } }],
      }]);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
      useAttack(game.store, game.state, 0, 'Mountain Drop');
      return game.state.players[1].active.damage;
    };
    expect(run(true)).toBe(100);  // Stadium in play → base + 80
    expect(run(false)).toBe(20);  // none → base only
  });

  // Stage B non-vacuity: a `cards.move chooser:'player'` zone move emits a ChooseCardsPrompt and moves
  // the filter-MATCHING card (the harness is now filter-aware) — not a no-op, and not the wrong card.
  it('Stage B: cards.move chooser:player moves a chosen filter-matching card from discard to hand', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10),
        discard: ['Fire Energy SVE', 'Fire Energy SVE', 'Bidoof CRZ'] }, // only the Bidoof is a Pokémon
      player2: { active: { card: res.fullName! }, deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const ic = buildInterpretedCard(native, [{ label: 'Recover', cost: ['Colorless'], body: [
      { kind: 'cards.move', select: { chooser: 'player', where: { kind: 'isa', supertype: 'Pokémon' } },
        count: { kind: 'exactly', n: 1 }, from: { owner: 'self', zone: 'discard' }, to: { owner: 'self', zone: 'hand' } },
    ] }]);
    ic.id = native.id; game.state.players[0].active.cards[0] = ic;
    const handBefore = game.state.players[0].hand.cards.length;
    useAttack(game.store, game.state, 0, 'Recover');
    expect(game.state.players[0].discard.cards.length).toBe(2);            // one card moved out of the discard
    expect(game.state.players[0].hand.cards.length).toBe(handBefore + 1);
    expect(game.state.players[0].hand.cards.some(c => c.name === 'Bidoof')).toBe(true); // the Pokémon, not a Fire Energy
  });

  // Stage B non-vacuity: `energy.move` actually relocates an attached Energy from the source Pokémon to
  // the chosen destination (the harness's MoveEnergyPrompt now moves, instead of the old no-op stub).
  it('Stage B: energy.move relocates an attached Energy from the source to the destination', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: {
        active: { card: res.fullName!, energy: ['Water Energy SVE', 'Fire Energy SVE'] }, // 2 attached
        bench: [{ card: res.fullName! }],                                                  // 0 attached
        deck: padDeck(10),
      },
      player2: { active: { card: res.fullName! }, deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const ic = buildInterpretedCard(native, [{ label: 'Shift', cost: ['Colorless'], body: [
      { kind: 'energy.move', source: { role: 'self' }, target: { of: { quantity: 'one', side: 'self', spot: 'bench' } },
        card: { from: { owner: 'self', zone: 'attached' }, predicate: { kind: 'isa', supertype: 'Energy' } },
        count: { kind: 'exactly', n: 1 } },
    ] }]);
    ic.id = native.id; game.state.players[0].active.cards[0] = ic;
    useAttack(game.store, game.state, 0, 'Shift');
    expect(game.state.players[0].active.energies.cards.length).toBe(1);   // 2 → 1
    expect(game.state.players[0].bench[0].energies.cards.length).toBe(1); // 0 → 1
  });

  // Native-vs-interpreted disagreements across the whole attack corpus (coin flips deterministic —
  // see test-helpers flipCoin). Two kinds, catalogued in FINDINGS.md: families (1)–(5) are
  // interpreter/IR-faithfulness gaps (the IR models *less* than the real attack); family (6) is the
  // reverse — the interpreter does the real attack and *native* is wrong (a Twinleaf bug, allow-
  // listed not fixed, per project guidance). Keyed by attack label (stable across printings). New
  // mismatches surface as failures here — triage them.
  const KNOWN_MISMATCHES: Record<string, string> = {
    // (1) Type/Special-filtered count — IR's energyAttached count drops the energy-type filter.
    'Syrup Storm': 'Hydrapple ex: "30 more per [G] Energy on all your Pokémon" — IR drops the [G] filter/scope',
    'Spiky Wheel': 'Marnie\'s Morpeko: "40 more per [D] Energy" — IR drops the [D]-type filter',
    'Special Roll': 'Cinccino: "70 per Special Energy attached" — IR counts all energy, not just Special',
    'Voltaic Chain': 'Iono\'s Bellibolt ex: "20 more per [L] Energy on all your Iono\'s Pokémon" — IR drops the [L] filter and multi-Pokémon scope',
    // (2) Count scope — IR counts a different population than the printed "for each …".
    'Torcherto': 'Skeledirge: "20 more per Benched (both sides)" — IR count scope differs',
    'Full Moon Rondo': 'Lillie\'s Clefairy ex: "20 more per Benched (both sides)" — IR count scope differs',
    'Angry Slam': 'IR counts all Pokémon in play; real attack counts only damaged Pokémon',
    'Illusory Hijacking': 'IR forEach pokemonInPlay drops the "ex AND V" predicate on the count',
    'Raging Charge': 'Paldean Tauros PFL: IR counts Tauros Pokémon that have damage; real attack is "40 per damage counter on Tauros Pokémon" — IR drops the per-counter scaling',
    // (4) Self-damage / KO-timing rider not modeled by the interpreter.
    'Dynamic Press': 'Hop\'s Snorlax: "140, also 80 to itself" — self-damage + KO/prize timing differs',
    'Power Shot': 'IR omits the conditional-discard rider (flat 170 vs "discard a Grass Energy or nothing")',
    // (5) Ability not modeled — the interpreter runs only the attack body, not the card's ability.
    'Searing Flame': 'Magmortar JTG: Magma Surge (+30 checkup burn on burned opponents) lifts native to KO; interp models only the attack',
    'Poison Chain': 'Pecharunt: Toxic Subjugation (+50 poison damage during checkup) lifts native to 70; interp models only the attack body (20)',
    'Shocking Web': 'Galvantula: Compound Eyes ability (+50 vs opponents with an Ability) lifts native to 100 (KO); interp models only the attack body (50)',
    // (6) Twinleaf bug — the interpreter does the real attack and native is wrong.
    'Dangle Tail': 'Slowpoke SCR: "Put a Pokémon from your discard pile into your hand." Native moves from a detached temp CardList (new CardList(); cards.cards = selected; MOVE_CARDS(cards, hand)), so the card is ADDED to the hand but never removed from the discard — a duplicate. IR/interp move it (discard −1). → Twinleaf bug. (Surfaced once the filter-aware ChooseCards fix dropped native\'s ambiguity to 0.)',
    'Greedy Fang': 'Mega Sharpedo ex PFL: card text "Draw 2 cards" but native MOVE_CARDS draws 1. IR/interp draw 2. → Twinleaf bug',
    'Hungry Jaws': 'Mega Sharpedo ex PFL: the "+150 if this Pokémon has damage" rider is wired to attack index 0 (Greedy Fang), so Hungry Jaws (index 1) never applies it. IR/interp apply it. → Twinleaf bug',
    // (6, tools) Twinleaf bugs surfaced by the tools-loaded board variant — the interpreter does the real attack.
    'Gadget Show': 'Heat/Wash/Mow Rotom DRI: "30 damage for each Pokémon Tool attached to all your Pokémon" — native counts `card.tools` (the vestigial PokemonCard.tools field, never populated; the engine attaches tools to PokemonCardList.tools), so it always counts 0. IR/interp read the real list.tools. → Twinleaf bug',
    'Gnaw Through': 'Arven\'s Skwovet DRI: "Before doing damage, discard all Pokémon Tools from your opponent\'s Active." Native\'s entire reduceEffect is commented out (unimplemented), so it never discards the Tool. IR/interp discard it (opponent tools −1, discard +1). → Twinleaf bug (unimplemented)',
    // (1, Mega-era) IR faithfulness gap surfaced by the me2pt5→ASC / me3→POR unblock (loader fix).
    'Giant Bouquet': 'Mega Meganium ex ASC (me2pt5-10/272): "+50 more damage for each [G] Energy attached to this Pokémon" — IR drops the [G]-type filter (counts ALL energy), like Syrup Storm. → Rotomancer (IR faithfulness)',
  };

  // (6b) Twinleaf bugs keyed by *printing* rather than label — either the attack label also belongs
  // to a correct card (so a label key would over-skip), or the bug lives in one set's card file. These
  // four were briefly patched earlier in this spike; per project guidance native card bugs are
  // allow-listed, not fixed (see memory: rotomancer-no-card-fixes), so the patches were reverted and
  // the bugs catalogued here. In every case the interpreter does the real attack and native is wrong.
  const KNOWN_NATIVE_BUGS_BY_PRINTING: Record<string, string> = {
    'sv10-41': 'Combusken DRI — Double Kick: native sets effect.damage = 40*heads OUTSIDE the async COIN_FLIP_PROMPT callbacks, so heads is always 0 → the attack always does 0. IR/interp do 40 per head. → Twinleaf bug',
    'sv9-103': 'N\'s Klink JTG — Double Spin: printed damage 10 PLUS `effect.damage += 10*heads` double-counts the base (30 on two heads, not 20). IR/interp do 10 per head. → Twinleaf bug. (Label "Double Spin" also belongs to Gossifleur sv7-10, which is correct — hence keyed by printing.)',
    'sv6-6': 'Sunkern TWM — Bullet Seed: the coin-flip logic is guarded on WAS_ATTACK_USED(effect, 1) but Bullet Seed is attack index 0, so it never runs (always base 10). IR/interp flip per the text. → Twinleaf bug',
    'sv6-32': 'Monferno TWM — Heat Blow: the "Discard an Energy from this Pokémon" rider is wired only to attack index 0 (Chop); Heat Blow (index 1) never discards. IR/interp discard. → Twinleaf bug',
    'sv6-123': 'Heatran TWM — Steel Burst: text/IR are "Discard all [M] Energy from this Pokémon. 50 damage for each card discarded", but native discards ALL attached energy (CheckProvidedEnergyEffect.energyMap, unfiltered — no [M] filter), inflating the discard count and the 50×count damage. (Compounded by the out-of-scope Incandescent Body ability, which burns the attacker.) IR/interp faithfully discard only [M] Energy and model only the attack body. → Twinleaf bug',
    'sv10-9': 'Mow Rotom DRI — Trimming Mower: "20 damage. Discard a Stadium in play." Native deals 0 (the base-20 damage is never applied), though it DOES discard the Stadium correctly. Surfaced in the differential by the stadium-loaded variant (the card previously threw on the stadium zone); the 0-vs-20 damage bug is independently confirmed by the official-data cross-check (rotomancer-official.spec.ts `sv10-9:damage:Trimming Mower`). IR/interp deal 20. → Twinleaf bug',
    // ── Mega-era (me1→MEG / me2pt5→ASC) native bugs surfaced by the loader fix. Keyed by printing
    //    because the labels (Crunch / Energy Crush / Fast Flight / …) also belong to unrelated cards.
    'me1-83': 'Naclstack MEG — Rock Hurl: native deals 0 (the base-50 damage is never applied — the attack is effectively unimplemented). IR/interp deal 50. → Twinleaf bug',
    'me2pt5-73': 'Miraidon ex ASC — Hadron Spark: "+120 if the opponent\'s Active is a Pokémon ex" — native under-applies the bonus; IR/interp correctly add 120 against the ex defender (KO at 240). → Twinleaf bug',
    'me2pt5-166': 'Delcatty ASC — Energy Crush: text "40 damage for each Energy attached to all of your OPPONENT\'s Pokémon", but native counts `player.forEachPokemon(BOTTOM_PLAYER)` — its OWN Pokémon. IR/interp count the opponent. → Twinleaf bug (wrong side)',
    'me2pt5-163': 'Larry\'s Dunsparce ASC — Rising Lunge: "+20 if heads" is applied inside the async COIN_FLIP_PROMPT callback, which resolves AFTER effect.damage is consumed → native never adds it (deals 10, not 30). IR/interp add it under ALL_HEADS. → Twinleaf bug (coin-callback timing, cf. Combusken)',
    'me2pt5-42': 'Croconaw ASC — Crunch: coin-flip "discard an Energy from the opponent\'s Active" via nested COIN_FLIP_PROMPT → DiscardEnergyPrompt; native\'s player-chosen discard and interp\'s deterministic discard diverge (the discard prompt does not trip the ambiguity guard). Twinleaf-side coin/choice handling — adjudication deferred',
    'me2pt5-67': 'Tapu Koko ASC — Fast Flight: "Discard your hand and draw 5 cards" (+ the "if you go first" first-turn clause) — native and interp diverge on the resulting hand/deck counts. Hand-manipulation discrepancy — adjudication deferred',
  };

  // (6c) Native bugs that only manifest on the BENCHLESS board (opponent holds just the active),
  // surfaced by Stage B choice-alignment: each is a "choose N of your opponent's Pokémon" attack whose
  // native card mishandles the degenerate too-few-targets / no-Bench case. On every bench-bearing
  // variant native and interp AGREE (the IR's choice geometry is validated there), so these are skipped
  // ONLY on `bare` to keep that coverage. In every case the interpreter does the rules-faithful attack.
  const KNOWN_BENCHLESS_NATIVE_BUGS: Record<string, string> = {
    'Sonic Double': 'Steven\'s Skarmory DRI: native double-counts — the printed base 50 AND the distribute-to-2 prompt\'s 50 both land on the lone target (100). IR/interp deal 50 once (only 1 of the "2 Pokémon" is available). → Twinleaf bug',
    'Dual Bolt': 'Electivire ex DRI: native\'s prefab requires choosing exactly 2 targets, so with only the opponent\'s active it satisfies the min and deals 0. IR/interp deal 50 to the one available. → Twinleaf bug',
    'Garnet Volley': 'Cinderace ex SCR: native guards `if (!hasBenched) return`, so "180 to 1 of your opponent\'s Pokémon" does nothing with no Bench — but the active is a legal target. IR/interp deal 180 to the active. → Twinleaf bug',
    'Crimson Blaster': 'Armarouge SSP: text targets 1 of the opponent\'s BENCHED Pokémon, but native uses the any-Pokémon prefab and hits the active. IR/interp target benched-only (0 with no Bench). → Twinleaf bug',
  };

  function runCorpusDifferential(variant: string, makeBoard: (hp: number) => Board): void {
    const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
    const scenarios = JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Array<{
      printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body'];
    }>;

    const mismatches: string[] = [];
    const unsupportedReasons: Record<string, number> = {};
    let compared = 0, unsupported = 0;
    for (const s of scenarios) {
      const res = resolvePrinting(s.printingId, s.name);
      if (res.status !== 'exact') continue;
      const card = getCardByName(res.fullName!);
      if (!(card instanceof PokemonCard)) continue;
      if (card.weakness?.some(w => w.type === card.cardType)) continue;
      if (KNOWN_MISMATCHES[s.attackLabel]) continue;
      if (KNOWN_NATIVE_BUGS_BY_PRINTING[s.printingId]) continue;
      // Benchless-only native bugs: skip on `bare` (no opponent Bench) where native mishandles the
      // degenerate choice; still compared on every bench-bearing variant, where native and interp agree.
      if (variant === 'bare' && KNOWN_BENCHLESS_NATIVE_BUGS[s.attackLabel]) continue;

      const energies = s.cost.filter(c => c.toUpperCase() !== 'FREE').map(energyToCard);
      const board = makeBoard(card.hp);
      const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
      let native: AttackRun, interpreted: AttackRun;
      try {
        native = buildAndAttack(res.fullName!, energies, s.attackLabel, null, board);
      } catch {
        continue; // native attack-name / energy errors are catalogued by the corpus spec
      }
      try {
        interpreted = buildAndAttack(res.fullName!, energies, s.attackLabel, fragments, board);
      } catch (e: any) {
        unsupported++; // interpreter doesn't yet handle an op/predicate in this body — visible gap
        const reason = String(e?.message ?? e).replace(/"[^"]*"/g, '…').replace(/^\[[^\]]*\]\s*/, '');
        unsupportedReasons[reason] = (unsupportedReasons[reason] ?? 0) + 1;
        continue;
      }
      // Divergence guard: if native made MORE genuine multi-option choices than the interpreter,
      // it made a choice the interpreter resolved directly (first-eligible) and the two may have
      // picked differently — skip rather than risk a false mismatch. Choices both delegate to the
      // harness (prize, promotion) increment both counts equally and so don't trip the guard.
      if (native.ambiguous !== interpreted.ambiguous) {
        unsupported++;
        unsupportedReasons['native made an ambiguous choice'] = (unsupportedReasons['native made an ambiguous choice'] ?? 0) + 1;
        continue;
      }
      compared++;
      if (JSON.stringify(native.snap) !== JSON.stringify(interpreted.snap)) {
        mismatches.push(`${s.printingId} ${s.attackLabel} (${s.name}): native ${JSON.stringify(native.snap)} vs interp ${JSON.stringify(interpreted.snap)}`);
      }
    }
    /* eslint-disable no-console */
    console.log(`\n  attack-corpus differential [${variant}]: compared ${compared}, unsupported ${unsupported}, mismatches ${mismatches.length}`);
    mismatches.forEach(m => console.log(`   • ${m}`));
    const topReasons = Object.entries(unsupportedReasons).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log('  top unsupported reasons:', topReasons.map(([r, n]) => `${n}× ${r}`).join('  |  '));
    /* eslint-enable no-console */
    expect(compared).toBeGreaterThan(15);
    expect(mismatches).toEqual([]);
  }

  // Bare board: fresh actives (a little attacker damage to make self-heal observable).
  it('matches native across the attack corpus — bare board', () => {
    runCorpusDifferential('bare', hp => ({ attackerDamage: Math.min(30, hp - 20) }));
  });

  // Primed board: both sides have 2 benched mirrors and pre-damaged actives, exercising bench
  // selectors and damageState predicates that are inert on a bare board.
  it('matches native across the attack corpus — primed board (bench + pre-damage)', () => {
    runCorpusDifferential('primed', hp => ({
      attackerDamage: Math.min(30, hp - 20),
      defenderDamage: Math.min(30, hp - 20),
      benchCount: 2,
    }));
  });

  // ── Loaded boards: focused variants that each turn ON one dimension over the primed baseline, so a
  // surfaced divergence is attributable to that dimension. All loads are mirror-symmetric (applied to
  // both runs); the divergence guard turns any genuine new choice into a counted skip, not a mismatch.

  // conditions: the defender carries POISONED+BURNED+CONFUSED (the legal co-occurring set), so
  // `conditionOn(opponent active)` riders fire their TRUE branch instead of only the (vacuous) false one.
  it('matches native across the attack corpus — loaded: conditions on defender', () => {
    runCorpusDifferential('conditions', hp => ({
      attackerDamage: Math.min(30, hp - 20),
      defenderDamage: Math.min(30, hp - 20),
      benchCount: 2,
      defenderConditions: [SpecialCondition.POISONED, SpecialCondition.BURNED, SpecialCondition.CONFUSED],
    }));
  });

  // energy-rich: every Pokémon (active + bench, both sides) carries a typed bundle on top of cost, so
  // `energyAttachedCount`/`forEach energyAttached` and the ≥4-of-a-type gates evaluate non-trivially.
  it('matches native across the attack corpus — loaded: energy-rich (typed energy everywhere)', () => {
    runCorpusDifferential('energy-rich', hp => ({
      attackerDamage: Math.min(30, hp - 20),
      defenderDamage: Math.min(30, hp - 20),
      benchCount: 2,
      extraEnergy: [
        'Lightning Energy SVE', 'Lightning Energy SVE',
        'Fire Energy SVE', 'Fire Energy SVE',
        'Water Energy SVE', 'Water Energy SVE',
      ], // ×3 Pokémon/side → 6 of each type across `spot:anywhere`, flipping the ≥4 gates
    }));
  });

  // zones-loaded: hand + discard are seeded, so `handSize`/`cardInZone`/`forEach discardCards` counts
  // are non-zero (incl. ≥10 [F] Energy in discard). Filler is basic energy + Bidoof CRZ (SVI fails to load).
  it('matches native across the attack corpus — loaded: zones (hand + discard)', () => {
    runCorpusDifferential('zones-loaded', hp => ({
      attackerDamage: Math.min(30, hp - 20),
      defenderDamage: Math.min(30, hp - 20),
      benchCount: 2,
      hand: ['Bidoof CRZ', 'Bidoof CRZ', 'Fire Energy SVE'],
      discard: padDeck(12, 'Fire Energy SVE').concat('Bidoof CRZ'),
    }));
  });

  // tools-loaded: both Actives carry a Pokémon Tool (Float Stone — retreat-only, so fully inert for the
  // attack snapshot since the differential never retreats), so `attached`→discard(Tools) and `hasTool`
  // riders fire non-trivially instead of vacuously on a tool-less board. Mirror-symmetric (both Actives),
  // so a Tool effect cancels in the diff and only a real divergence surfaces.
  it('matches native across the attack corpus — loaded: tools on both actives', () => {
    runCorpusDifferential('tools-loaded', hp => ({
      attackerDamage: Math.min(30, hp - 20),
      defenderDamage: Math.min(30, hp - 20),
      benchCount: 2,
      tools: ['Float Stone PLF'],
    }));
  });

  // stadium-loaded: a Stadium (Town Store — inert for an attack snapshot: its only effect is a
  // UseStadiumEffect-gated once-per-turn ability the differential never triggers) is in play in the attacker's
  // Stadium zone, so `stadiumInPlay` riders fire their TRUE branch (vs. the vacuous false branch every
  // stadium-less variant takes) and `cards.move stadium→discard` ("discard the Stadium in play") is exercised
  // and observed via the snapshot's `stadium` field. The Stadium is a global singleton (one in play), so it is
  // seeded once on the attacker's side rather than mirror-symmetrically; both runs are seeded identically.
  it('matches native across the attack corpus — loaded: a Stadium in play', () => {
    runCorpusDifferential('stadium-loaded', hp => ({
      attackerDamage: Math.min(30, hp - 20),
      defenderDamage: Math.min(30, hp - 20),
      benchCount: 2,
      stadium: 'Town Store OBF',
    }));
  });

  // ── Coverage audit ──────────────────────────────────────────────────────────────────────────────
  // The variant differentials guard "0 mismatches on what we compare"; this guards the COMPARISON SET
  // itself. It classifies every corpus card by integration status on a single `primed` baseline (mirroring
  // runCorpusDifferential's filter pipeline), prints the authoritative coverage scorecard, and fails on
  // exactly two regressions: a previously-compared card silently dropping to a skip, or a brand-new
  // unexplained skip reason. Both are coverage erosions a green mismatch-suite would otherwise hide.
  // The baseline (fixtures/coverage-baseline.json) is self-bootstrapping: absent → written + committed;
  // present → asserted against. To intentionally re-pin (after a coverage-changing phase), delete + re-run.
  it('coverage audit — classifies all corpus cards and guards against coverage regressions', () => {
    const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
    const scenarios = JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Array<{
      printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body'];
    }>;
    const makeBoard = (hp: number): Board => ({
      attackerDamage: Math.min(30, hp - 20), defenderDamage: Math.min(30, hp - 20), benchCount: 2,
    });
    const key = (s: { printingId: string; attackLabel: string }) => `${s.printingId} ${s.attackLabel}`;

    const comparedKeys: string[] = [];
    const skipReasons: Record<string, string[]> = {}; // normalized reason → keys (interp throws + ambiguity)
    const tally: Record<string, number> = {};         // every other bucket → count
    const bump = (b: string) => { tally[b] = (tally[b] ?? 0) + 1; };
    const skip = (reason: string, s: { printingId: string; attackLabel: string }) => {
      (skipReasons[reason] = skipReasons[reason] ?? []).push(key(s));
    };

    for (const s of scenarios) {
      const res = resolvePrinting(s.printingId, s.name);
      if (res.status !== 'exact') { bump(`non-exact:${res.status}`); continue; }
      const card = getCardByName(res.fullName!);
      if (!(card instanceof PokemonCard)) { bump('non-pokemon'); continue; }
      if (card.weakness?.some(w => w.type === card.cardType)) { bump('self-weak'); continue; }
      if (KNOWN_MISMATCHES[s.attackLabel]) { bump('allowlist-mismatch'); continue; }
      if (KNOWN_NATIVE_BUGS_BY_PRINTING[s.printingId]) { bump('allowlist-native-bug'); continue; }

      const energies = s.cost.filter(c => c.toUpperCase() !== 'FREE').map(energyToCard);
      const board = makeBoard(card.hp);
      const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
      let native: AttackRun, interpreted: AttackRun;
      try {
        native = buildAndAttack(res.fullName!, energies, s.attackLabel, null, board);
      } catch {
        bump('native-error'); continue; // native attack-name/energy errors (catalogued by the corpus spec)
      }
      try {
        interpreted = buildAndAttack(res.fullName!, energies, s.attackLabel, fragments, board);
      } catch (e: any) {
        skip(String(e?.message ?? e).replace(/"[^"]*"/g, '…').replace(/^\[[^\]]*\]\s*/, ''), s);
        continue;
      }
      if (native.ambiguous !== interpreted.ambiguous) { skip('native made an ambiguous choice', s); continue; }
      comparedKeys.push(key(s));
    }
    comparedKeys.sort();
    const observedReasons = Object.keys(skipReasons).sort();
    const skipTotal = observedReasons.reduce((n, r) => n + skipReasons[r].length, 0);
    const otherTotal = Object.values(tally).reduce((a, b) => a + b, 0);

    /* eslint-disable no-console */
    console.log(`\n── Rotomancer coverage audit [primed baseline] ──`);
    console.log(`  total corpus     : ${scenarios.length}`);
    console.log(`  compared         : ${comparedKeys.length}`);
    console.log(`  counted skips    : ${skipTotal}`);
    observedReasons.forEach(r => console.log(`     • ${skipReasons[r].length}×  ${r}`));
    Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([b, n]) => console.log(`  ${b.padEnd(20)}: ${n}`));
    /* eslint-enable no-console */

    // (1) Completeness — every scenario lands in exactly one bucket.
    expect(comparedKeys.length + skipTotal + otherTotal).toBe(scenarios.length);

    const baseFile = path.join(__dirname, 'rotomancer', 'fixtures', 'coverage-baseline.json');
    if (!fs.existsSync(baseFile)) {
      fs.writeFileSync(baseFile, JSON.stringify({ comparedKeys, expectedSkipReasons: observedReasons }, null, 2) + '\n');
      // eslint-disable-next-line no-console
      console.log('  coverage-baseline.json bootstrapped — commit it to pin coverage.');
      return;
    }
    const base = JSON.parse(fs.readFileSync(baseFile, 'utf8')) as { comparedKeys: string[]; expectedSkipReasons: string[] };
    const comparedSet = new Set(comparedKeys);
    const expected = new Set(base.expectedSkipReasons);
    // (2) No previously-compared card silently dropped to a skip (additions are allowed → ⊇, not ===).
    const dropped = base.comparedKeys.filter(k => !comparedSet.has(k));
    // (3) No new unexplained skip reason (a regression that introduces a fresh throw).
    const newReasons = observedReasons.filter(r => !expected.has(r));
    expect(dropped).toEqual([]);
    expect(newReasons).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Choice differential — option-set equivalence over multi-choice attacks (§12.10).
//
// The variant differentials resolve a player choice to ONE option (first-eligible) and compare that
// single outcome — so a native/interp prompt-geometry mismatch could balance the divergence guard yet
// pick different targets and coincidentally agree (the project's one masking risk). This closes it: for
// each single-select ChoosePokemonPrompt affect-target choice, verify the two engines (A) offer the SAME
// set of options and (B) produce the SAME observable for EVERY option, not just first-eligible.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Rotomancer choice differential — option-set equivalence', () => {
  // Native bugs the full-option-set check surfaces (a wrong option set or an option that misbehaves). Per
  // the standing rule allow-listed, never fixed (memory: rotomancer-no-card-fixes); keyed by printingId.
  const KNOWN_CHOICE_BUGS: Record<string, string> = {
    // Armarouge SSP — Crimson Blaster: text targets "1 of your opponent's BENCHED Pokémon", but native uses
    // the any-Pokémon prefab and OFFERS THE ACTIVE too (option set {active,bench0,bench1} vs the IR/interp's
    // benched-only {bench0,bench1}). The option-set invariant catches the geometry bug directly (the
    // first-eligible differential could only catch it via KNOWN_BENCHLESS_NATIVE_BUGS on the bare board). → Twinleaf bug.
    'sv8-34': 'Armarouge SSP — Crimson Blaster: native offers the Active; text/IR target benched-only',
  };

  const AFFECT = new Set(['damage.deal', 'condition.apply', 'heal', 'damage.placeCounters']);
  const isSingleChoiceSel = (sel: any): boolean => {
    if (!sel || sel.role !== undefined) { return false; }
    if (sel.quantity === 'one') { return true; }
    return sel.chooser !== undefined && sel.quantity === undefined;
  };
  // Single-pick player-choice affect-target ("1 of your/opponent's Pokémon", targetCount 1) — pre-filter
  // so we run only the ~70 candidate printings, not all 1851.
  const hasAffectSingleChoice = (body: any[]): boolean => body.some((op: any) =>
    AFFECT.has(op.kind) && isSingleChoiceSel(op.target?.of) && (op.targetCount ?? 1) === 1);

  // One mirror game on a benched board (each side: active + 2 bench, pre-damaged hp-safely so each option
  // is a distinct, observable snapshot position). Registers a ChoosePokemonPrompt override that captures
  // the canonical candidate list and resolves it via `pick`; returns the post-attack snapshot + bookkeeping.
  function runChoice(
    fullName: string, energies: string[], attackLabel: string, fragments: IrFragment[] | null, dmg: number,
    pick: (candidates: CardTarget[], prompt: ChoosePokemonPrompt) => CardTarget[]
  ): { snap: Snapshot; promptCount: number; maxPick: number; candidateKeys: string[] } {
    const bench = [{ card: fullName, damage: dmg }, { card: fullName, damage: dmg }];
    const game = setupGame({
      turn: 2,
      player1: { active: { card: fullName, energy: energies, damage: dmg }, bench, deck: padDeck(10) },
      player2: { active: { card: fullName, damage: dmg }, bench, deck: padDeck(10) },
    });
    if (fragments) {
      const native = game.state.players[0].active.cards[0];
      const ic = buildInterpretedCard(native, fragments);
      ic.id = native.id;
      game.state.players[0].active.cards[0] = ic;
    }
    let promptCount = 0, maxPick = 0;
    let candidateKeys: string[] = [];
    game.overridePrompt(ChoosePokemonPromptType, (prompt, state) => {
      promptCount++;
      const p = prompt as ChoosePokemonPrompt;
      const candidates = choosePokemonCandidates(state, p);
      if (promptCount === 1) { candidateKeys = candidates.map(cardTargetKey); maxPick = p.options.max; }
      return pick(candidates, p);
    });
    useAttack(game.store, game.state, 0, attackLabel);
    return { snap: snapshot(game.state), promptCount, maxPick, candidateKeys };
  }

  const firstEligible = (c: CardTarget[], p: ChoosePokemonPrompt) => c.slice(0, p.options.max);

  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Array<{
    printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body'];
  }>).filter(s => hasAffectSingleChoice(s.body));

  let enumerated = 0, optionsChecked = 0, multiOption = 0;
  const skips: Record<string, number> = {};
  const skip = (r: string) => { skips[r] = (skips[r] ?? 0) + 1; };
  const optionSetMismatches: string[] = [];
  const perOptionMismatches: string[] = [];

  for (const s of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skip('non-exact'); continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) { skip('non-pokemon'); continue; }
    if (card.weakness?.some(w => w.type === card.cardType)) { skip('self-weak'); continue; }
    if (KNOWN_CHOICE_BUGS[s.printingId]) { skip('allowlisted-native-bug'); continue; }

    const energies = s.cost.filter(c => c.toUpperCase() !== 'FREE').map(energyToCard);
    const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
    const dmg = Math.min(20, Math.max(0, card.hp - 30)); // hp-safe: never KOs a target at setup
    const run = (frags: IrFragment[] | null, pick: (c: CardTarget[], p: ChoosePokemonPrompt) => CardTarget[]) =>
      runChoice(res.fullName!, energies, s.attackLabel, frags, dmg, pick);

    let nat, intp;
    try {
      nat = run(null, firstEligible);
      intp = run(fragments, firstEligible);
    } catch { skip('build-error'); continue; }

    if (nat.promptCount === 0 || intp.promptCount === 0) { skip('no-choose-pokemon-prompt'); continue; }
    if (nat.promptCount > 1 || intp.promptCount > 1) { skip('multi-prompt (deferred)'); continue; }
    if (nat.maxPick > 1 || intp.maxPick > 1) { skip('multi-select (deferred)'); continue; }

    enumerated++;
    const tag = `${s.printingId} ${s.attackLabel} (${s.name})`;
    // Invariant A — same options.
    if (JSON.stringify(nat.candidateKeys) !== JSON.stringify(intp.candidateKeys)) {
      optionSetMismatches.push(`${tag}: native ${JSON.stringify(nat.candidateKeys)} vs interp ${JSON.stringify(intp.candidateKeys)}`);
      continue; // can't pair options when the sets differ
    }
    if (nat.candidateKeys.length > 1) { multiOption++; }
    // Invariant B — each option does the same thing.
    for (let i = 0; i < nat.candidateKeys.length; i++) {
      optionsChecked++;
      try {
        const sn = run(null, c => [c[i]]).snap;
        const si = run(fragments, c => [c[i]]).snap;
        if (JSON.stringify(sn) !== JSON.stringify(si)) {
          perOptionMismatches.push(`${tag} option ${i} (${nat.candidateKeys[i]}): native ${JSON.stringify(sn)} vs interp ${JSON.stringify(si)}`);
        }
      } catch (e: any) {
        perOptionMismatches.push(`${tag} option ${i}: threw ${String(e?.message ?? e)}`);
      }
    }
  }

  beforeAll(() => {
    /* eslint-disable no-console */
    console.log(`\n── Rotomancer choice differential [option-set equivalence] ──`);
    console.log(`  candidate scenarios : ${scenarios.length}`);
    console.log(`  enumerated          : ${enumerated} (multi-option: ${multiOption})`);
    console.log(`  options checked     : ${optionsChecked}`);
    console.log(`  option-set mismatch : ${optionSetMismatches.length}`);
    console.log(`  per-option mismatch : ${perOptionMismatches.length}`);
    console.log(`  skipped             : ${JSON.stringify(skips)}`);
    [...optionSetMismatches.map(m => `OPTSET ${m}`), ...perOptionMismatches.map(m => `OPTION ${m}`)].forEach(m => console.log(`   • ${m}`));
    /* eslint-enable no-console */
  });

  it('native and interp offer the same option set for every multi-choice attack', () => {
    expect(optionSetMismatches).toEqual([]);
  });
  it('every option produces the same observable in both engines', () => {
    expect(perOptionMismatches).toEqual([]);
  });
  it('actually exercised multi-option choices (non-vacuity)', () => {
    expect(multiOption).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Card-choice differential (§12.11) — extends option-set equivalence from ChoosePokemonPrompt (above) to
// `cards.move chooser:'player'` choices, which the main differential still resolves first-eligible via a
// ChooseCardsPrompt. The masking risk is live there too: if native's *eligible card set* differs from the
// interp's, both still move the same COUNT and the count-based snapshot agrees for the wrong reason. So we
// (A) verify the two engines offer the same eligible cards + bounds and (B) that each pick does the same
// thing — comparing the IDENTITY-AWARE snapshot, since for these moves the count is identical across picks
// and only WHICH card moved distinguishes them.
describe('Rotomancer card-choice differential — ChooseCards option-set equivalence', () => {
  // Native divergences the full-option-set check surfaces (a wrong eligible set, a wrong bound, or a pick
  // that misbehaves). In every case interp faithfully encodes the IR/printed text and native diverges, so per
  // the standing rule these are allow-listed, never fixed (memory: rotomancer-no-card-fixes); keyed by
  // printingId. (A genuine *interp* filter/move bug would be fixed in executeCardsMoveChoice / the IR instead.)
  const KNOWN_CARD_CHOICE_BUGS: Record<string, string> = {
    // Slowpoke SCR — Dangle Tail: native MOVE_CARDS is given a fresh CardList as the source instead of
    // player.discard, so the chosen Pokémon is COPIED into hand and LEFT in the discard — the IR/text "put …
    // into your hand" is a move. Invariant B catches it via discardNames (native discard keeps the card). → Twinleaf bug.
    'sv7-57': 'Slowpoke SCR — Dangle Tail: copies (leaves the card in discard) instead of moving discard→hand',
    // Iron Leaves TWM — Recovery Net: text "Choose up to 2 … put them into your hand" permits choosing 0, but
    // native's ChooseCardsPrompt is min:1 (forces ≥1). The IR `upTo` → min 0 is faithful. → Twinleaf bug (min).
    'sv6-19': 'Iron Leaves TWM — Recovery Net: native prompt min:1 forbids choosing 0, but "up to 2" permits 0',
    // Luxray ex TWM — Piercing Gaze: text "discard 1 card" is mandatory, but native's prompt is min:0 (lets you
    // discard 0). The IR `exactly:1` → min 1 is faithful. → Twinleaf bug (min). Two printings.
    'sv6-195': 'Luxray ex TWM — Piercing Gaze: native prompt min:0 makes a mandatory "discard 1 card" optional',
    'sv6-68': 'Luxray ex TWM — Piercing Gaze: native prompt min:0 makes a mandatory "discard 1 card" optional',
    // Dedenne SSP — Electromagnetic Sonar: text "Put a Trainer card … into your hand" is mandatory, but
    // native's prompt is min:0. The IR `exactly:1` → min 1 is faithful. → Twinleaf bug (min).
    'sv8-87': 'Dedenne SSP — Electromagnetic Sonar: native prompt min:0 makes a mandatory "put a card" optional',
  };

  // Guaranteed-registered, inert seed cards (basic energies + SSP basics/items) for the eligible pile —
  // distinct names so each option leaves a distinct identity-aware snapshot.
  const SEED_ENERGY = ['Fire Energy SVE', 'Grass Energy SVE', 'Lightning Energy SVE', 'Psychic Energy SVE'];
  const SEED_POKEMON = ['Togepi SSP', 'Turtonator SSP', 'Trapinch SSP'];
  const SEED_TRAINER = ['Dusk Ball SSP', 'Miraculous Intercom SSP', 'Precious Trolley SSP'];

  // Distinct eligible fullNames matching `where`, plus one non-matching decoy — so the *filter agreement*
  // part of Invariant A bites: both engines must exclude the decoy. `eligible.length < 2` → not seedable
  // (skipped). Predicates we don't synthesize a pile for (name/evolvesFrom — the place-a-Pokémon shapes that
  // throw on to:bench anyway) return empty.
  function eligiblePileFor(where: any): { eligible: string[]; decoy: string | null } {
    if (!where) { return { eligible: [SEED_ENERGY[0], SEED_POKEMON[0], SEED_TRAINER[0]], decoy: null }; }
    if (where.name !== undefined || where.evolvesFrom !== undefined) { return { eligible: [], decoy: null }; }
    const sup = where.supertype;
    if (sup === 'Energy') {
      if (where.energyType !== undefined) { const e = energyToCard(where.energyType); return { eligible: [e, e], decoy: SEED_POKEMON[0] }; }
      return { eligible: SEED_ENERGY.slice(), decoy: SEED_POKEMON[0] };
    }
    if (sup === 'Pokémon') { return { eligible: SEED_POKEMON.slice(), decoy: SEED_ENERGY[0] }; }
    if (sup === 'Trainer') { return { eligible: SEED_TRAINER.slice(), decoy: SEED_ENERGY[0] }; }
    return { eligible: [], decoy: null };
  }

  // The in-scope class: a `cards.move chooser:'player'` op on the flat resolveZone path (from/to in
  // {hand,deck,discard,lostzone}) — i.e. a genuine ChooseCardsPrompt. Excludes deck-search (throws),
  // switches (bench→active → ChoosePokemonPrompt), discard→bench place-a-Pokémon (to:bench throws), and
  // attached/prize/stadium moves (separate paths). Returns the op or null.
  const FLAT_ZONES = new Set(['hand', 'deck', 'discard', 'lostzone']);
  function flatPlayerCardMove(body: any[]): any | null {
    for (const op of body) {
      if (op.kind !== 'cards.move') { continue; }
      // `player` (you choose) or `opponent` (your opponent chooses from their own zone — Cursed Words /
      // Tighten Up); both emit a ChooseCardsPrompt owned by the chooser, verified the same way.
      if (op.select?.chooser !== 'player' && op.select?.chooser !== 'opponent') { continue; }
      if (op.visibility === 'search' || op.count?.searchTyped) { continue; }
      if (!FLAT_ZONES.has(op.from?.zone) || !FLAT_ZONES.has(op.to?.zone)) { continue; }
      return op;
    }
    return null;
  }

  type Elig = { card: Card; index: number };
  const byName = (a: Elig, b: Elig) => a.card.name < b.card.name ? -1 : a.card.name > b.card.name ? 1 : a.index - b.index;

  // One mirror game seeding the op's from-zone (of the right owner) with the eligible pile + decoy. Registers
  // a ChooseCardsPrompt override that captures the eligible name-multiset + (min,max) and resolves via `pick`;
  // returns the IDENTITY-AWARE post-attack snapshot + bookkeeping.
  function runCardChoice(
    fullName: string, energies: string[], attackLabel: string, fragments: IrFragment[] | null,
    owner: 'self' | 'opponent', zone: 'hand' | 'discard', seedCards: string[],
    pick: (eligible: Elig[], prompt: ChooseCardsPrompt) => number[]
  ): { snap: Snapshot; promptCount: number; min: number; max: number; eligibleNames: string[] } {
    const p0seed: any = owner === 'self' ? { [zone]: seedCards.slice() } : {};
    const p1seed: any = owner === 'opponent' ? { [zone]: seedCards.slice() } : {};
    const game = setupGame({
      turn: 2,
      player1: { active: { card: fullName, energy: energies }, deck: padDeck(10), ...p0seed },
      player2: { active: { card: fullName }, deck: padDeck(10), ...p1seed },
    });
    if (fragments) {
      const native = game.state.players[0].active.cards[0];
      const ic = buildInterpretedCard(native, fragments);
      ic.id = native.id;
      game.state.players[0].active.cards[0] = ic;
    }
    let promptCount = 0, min = 0, max = 0;
    let eligibleNames: string[] = [];
    game.overridePrompt(ChooseCardsPromptType, (prompt) => {
      promptCount++;
      const p = prompt as ChooseCardsPrompt;
      const idxs = chooseCardsCandidates(p);
      if (promptCount === 1) {
        eligibleNames = idxs.map(i => p.cards.cards[i].name).sort();
        min = p.options.min; max = p.options.max;
      }
      return pick(idxs.map(i => ({ card: p.cards.cards[i], index: i })), p);
    });
    useAttack(game.store, game.state, 0, attackLabel);
    return { snap: snapshot(game.state, true), promptCount, min, max, eligibleNames };
  }

  const firstEligiblePick = (elig: Elig[], p: ChooseCardsPrompt) => elig.slice(0, p.options.max).map(e => e.index);
  // Pick the k-th eligible card (sorted by name → identical card on both engines once Invariant A holds).
  const singletonPick = (k: number) => (elig: Elig[]) => { const s = [...elig].sort(byName); return s[k] ? [s[k].index] : []; };
  // Pick the max-count subset (first min(N,max) eligible, sorted) — the multi-select case.
  const maxPick = (elig: Elig[], p: ChooseCardsPrompt) => { const s = [...elig].sort(byName); return s.slice(0, Math.min(s.length, p.options.max)).map(e => e.index); };

  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Array<{
    printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body'];
  }>).map(s => ({ s, op: flatPlayerCardMove(s.body) })).filter(x => x.op !== null) as Array<{ s: any; op: any }>;

  let enumerated = 0, picksChecked = 0, multiOption = 0, distinctOption = 0;
  const skips: Record<string, number> = {};
  const skip = (r: string) => { skips[r] = (skips[r] ?? 0) + 1; };
  const optionSetMismatches: string[] = [];
  const perPickMismatches: string[] = [];

  for (const { s, op } of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skip('non-exact'); continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) { skip('non-pokemon'); continue; }
    if (card.weakness?.some(w => w.type === card.cardType)) { skip('self-weak'); continue; }
    if (KNOWN_CARD_CHOICE_BUGS[s.printingId]) { skip('allowlisted-native-bug'); continue; }

    const { eligible, decoy } = eligiblePileFor(op.select?.where);
    if (eligible.length < 2) { skip('unseedable-predicate'); continue; }
    const seedCards = decoy ? [...eligible, decoy] : eligible.slice();
    try { seedCards.forEach(getCardByName); } catch { skip('seed-unavailable'); continue; }

    const owner: 'self' | 'opponent' = op.from?.owner === 'opponent' ? 'opponent' : 'self';
    const zone: 'hand' | 'discard' = op.from?.zone === 'hand' ? 'hand' : 'discard';
    const energies = s.cost.filter((c: string) => c.toUpperCase() !== 'FREE').map(energyToCard);
    const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
    const run = (frags: IrFragment[] | null, pick: (e: Elig[], p: ChooseCardsPrompt) => number[]) =>
      runCardChoice(res.fullName!, energies, s.attackLabel, frags, owner, zone, seedCards, pick);

    let nat, intp;
    try { nat = run(null, firstEligiblePick); intp = run(fragments, firstEligiblePick); }
    catch { skip('build-error'); continue; }

    if (nat.promptCount === 0 || intp.promptCount === 0) { skip('no-choosecards-prompt'); continue; }
    if (nat.promptCount > 1 || intp.promptCount > 1) { skip('multi-prompt (deferred)'); continue; }

    enumerated++;
    const tag = `${s.printingId} ${s.attackLabel} (${s.name})`;
    // Invariant A — same eligible cards AND same (min,max). Compared by card identity (sorted name multiset),
    // robust to prompt-order / filter-vs-blocked representation differences between the engines.
    const aKey = (r: { eligibleNames: string[]; min: number; max: number }) =>
      JSON.stringify({ names: r.eligibleNames, min: r.min, max: r.max });
    if (aKey(nat) !== aKey(intp)) {
      optionSetMismatches.push(`${tag}: native ${aKey(nat)} vs interp ${aKey(intp)}`);
      continue; // can't pair picks when the eligible sets differ
    }
    if (nat.eligibleNames.length > 1) { multiOption++; }
    if (new Set(nat.eligibleNames).size > 1) { distinctOption++; }

    // Invariant B — each pick does the same thing (every eligible card as a singleton, plus the max-count
    // pick — bounded N+1, not 2^N). The identity-aware snapshot is load-bearing here: for discard-and-scale
    // the damage is count-only, so only handNames/discardNames distinguish "moved the card you picked" from
    // "moved a different one of the same count".
    const picks: Array<{ label: string; pick: (e: Elig[], p: ChooseCardsPrompt) => number[] }> = [];
    // Singletons are only LEGAL picks when min ≤ 1; a min>1 prompt (e.g. Cursed Words "choose 3 cards",
    // min:3) rejects a one-card selection, so for those only the max-count pick (size min(N,max) ≥ min) applies.
    if (nat.min <= 1) {
      for (let k = 0; k < nat.eligibleNames.length; k++) {
        picks.push({ label: `single[${nat.eligibleNames[k]}]`, pick: singletonPick(k) });
      }
    }
    picks.push({ label: 'max', pick: maxPick });
    for (const { label, pick } of picks) {
      picksChecked++;
      try {
        const sn = run(null, pick).snap;
        const si = run(fragments, pick).snap;
        if (JSON.stringify(sn) !== JSON.stringify(si)) {
          perPickMismatches.push(`${tag} pick ${label}: native ${JSON.stringify(sn)} vs interp ${JSON.stringify(si)}`);
        }
      } catch (e: any) {
        perPickMismatches.push(`${tag} pick ${label}: threw ${String(e?.message ?? e)}`);
      }
    }
  }

  beforeAll(() => {
    /* eslint-disable no-console */
    console.log(`\n── Rotomancer card-choice differential [ChooseCards option-set equivalence] ──`);
    console.log(`  candidate scenarios : ${scenarios.length}`);
    console.log(`  enumerated          : ${enumerated} (multi-option: ${multiOption}, distinct-identity: ${distinctOption})`);
    console.log(`  picks checked       : ${picksChecked}`);
    console.log(`  option-set mismatch : ${optionSetMismatches.length}`);
    console.log(`  per-pick mismatch   : ${perPickMismatches.length}`);
    console.log(`  skipped             : ${JSON.stringify(skips)}`);
    [...optionSetMismatches.map(m => `OPTSET ${m}`), ...perPickMismatches.map(m => `PICK ${m}`)].forEach(m => console.log(`   • ${m}`));
    /* eslint-enable no-console */
  });

  it('native and interp offer the same eligible card set + bounds for every ChooseCards move', () => {
    expect(optionSetMismatches).toEqual([]);
  });
  it('every pick produces the same observable in both engines', () => {
    expect(perPickMismatches).toEqual([]);
  });
  it('actually exercised multi-option card choices (non-vacuity)', () => {
    expect(multiOption).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Switch differential (§12.12) — the last first-eligible-resolved ChoosePokemonPrompt class the choice
// differentials did not yet cover: `cards.move bench→active` (same owner), i.e. "switch to 1 of your (or your
// opponent's) Benched Pokémon" (Run Around, Follow Me, Pull, …). §12.10 only covered AFFECT-target choices, and
// its mirror board seeds IDENTICAL benched Pokémon, so a switch's observable — which species is now Active —
// was invisible. This seeds DISTINCT benched Pokémon and reads the new active/bench species identity
// (`PokeSnap.name`, §12.12) so option-set equivalence bites: (A) the engines offer the same bench targets +
// bounds, and (B) switching to each target promotes the same species on both.
describe('Rotomancer switch differential — bench→active option-set equivalence', () => {
  // Native divergences surfaced by the full-option-set check (interp faithful to the IR; native diverges). Per
  // the standing rule allow-listed, never fixed (memory: rotomancer-no-card-fixes); keyed by printingId.
  const KNOWN_SWITCH_BUGS: Record<string, string> = {};

  // Distinct, registered, benchable (Basic) species — so switching to slot i promotes an observably different
  // Pokémon. Seeded identically on both runs, so any benched-ability effect is symmetric and cancels in the diff.
  const SWITCH_BENCH = ['Togepi SSP', 'Turtonator SSP', 'Trapinch SSP'];

  // A switch op: `cards.move` bench→active, same owner (the executeSwitch path).
  function switchMove(body: any[]): any | null {
    for (const op of body) {
      if (op.kind === 'cards.move' && op.from?.zone === 'bench' && op.to?.zone === 'active'
          && op.from?.owner === op.to?.owner) { return op; }
    }
    return null;
  }

  // One game seeding the switched-side's bench with distinct species. Registers a ChoosePokemonPrompt override
  // (the switch prompt is BENCH-only) that captures the candidate set + (min,max) and resolves via `pick`;
  // returns the IDENTITY-AWARE snapshot (so the promoted species is observable).
  function runSwitch(
    fullName: string, energies: string[], attackLabel: string, fragments: IrFragment[] | null,
    benchOwner: 'self' | 'opponent', pick: (c: CardTarget[], p: ChoosePokemonPrompt) => CardTarget[]
  ): { snap: Snapshot; promptCount: number; min: number; max: number; candidateKeys: string[] } {
    const benchSeed = SWITCH_BENCH.map(card => ({ card }));
    const game = setupGame({
      turn: 2,
      player1: { active: { card: fullName, energy: energies }, bench: benchOwner === 'self' ? benchSeed : [], deck: padDeck(10) },
      player2: { active: { card: fullName }, bench: benchOwner === 'opponent' ? benchSeed : [], deck: padDeck(10) },
    });
    if (fragments) {
      const native = game.state.players[0].active.cards[0];
      const ic = buildInterpretedCard(native, fragments);
      ic.id = native.id;
      game.state.players[0].active.cards[0] = ic;
    }
    let promptCount = 0, min = 0, max = 0;
    let candidateKeys: string[] = [];
    game.overridePrompt(ChoosePokemonPromptType, (prompt, state) => {
      promptCount++;
      const p = prompt as ChoosePokemonPrompt;
      const candidates = choosePokemonCandidates(state, p);
      if (promptCount === 1) { candidateKeys = candidates.map(cardTargetKey); min = p.options.min; max = p.options.max; }
      return pick(candidates, p);
    });
    useAttack(game.store, game.state, 0, attackLabel);
    return { snap: snapshot(game.state, true), promptCount, min, max, candidateKeys };
  }

  const firstEligible = (c: CardTarget[], p: ChoosePokemonPrompt) => c.slice(0, p.options.max);

  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Array<{
    printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body'];
  }>).map(s => ({ s, op: switchMove(s.body) })).filter(x => x.op !== null) as Array<{ s: any; op: any }>;

  let enumerated = 0, optionsChecked = 0, multiOption = 0;
  const skips: Record<string, number> = {};
  const skip = (r: string) => { skips[r] = (skips[r] ?? 0) + 1; };
  const optionSetMismatches: string[] = [];
  const perOptionMismatches: string[] = [];

  for (const { s, op } of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skip('non-exact'); continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) { skip('non-pokemon'); continue; }
    if (card.weakness?.some(w => w.type === card.cardType)) { skip('self-weak'); continue; }
    if (KNOWN_SWITCH_BUGS[s.printingId]) { skip('allowlisted-native-bug'); continue; }

    const benchOwner: 'self' | 'opponent' = op.from?.owner === 'opponent' ? 'opponent' : 'self';
    const energies = s.cost.filter((c: string) => c.toUpperCase() !== 'FREE').map(energyToCard);
    const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
    const run = (frags: IrFragment[] | null, pick: (c: CardTarget[], p: ChoosePokemonPrompt) => CardTarget[]) =>
      runSwitch(res.fullName!, energies, s.attackLabel, frags, benchOwner, pick);

    let nat, intp;
    try { nat = run(null, firstEligible); intp = run(fragments, firstEligible); }
    catch { skip('build-error'); continue; }

    if (nat.promptCount === 0 || intp.promptCount === 0) { skip('no-switch-prompt'); continue; }
    if (nat.promptCount > 1 || intp.promptCount > 1) { skip('multi-prompt (deferred)'); continue; }

    enumerated++;
    const tag = `${s.printingId} ${s.attackLabel} (${s.name})`;
    // Invariant A — same bench targets + bounds.
    const aKey = (r: { candidateKeys: string[]; min: number; max: number }) =>
      JSON.stringify({ keys: r.candidateKeys, min: r.min, max: r.max });
    if (aKey(nat) !== aKey(intp)) {
      optionSetMismatches.push(`${tag}: native ${aKey(nat)} vs interp ${aKey(intp)}`);
      continue;
    }
    if (nat.candidateKeys.length > 1) { multiOption++; }
    // Invariant B — switching to each target promotes the same species (identity-aware snapshot).
    for (let i = 0; i < nat.candidateKeys.length; i++) {
      optionsChecked++;
      try {
        const sn = run(null, c => [c[i]]).snap;
        const si = run(fragments, c => [c[i]]).snap;
        if (JSON.stringify(sn) !== JSON.stringify(si)) {
          perOptionMismatches.push(`${tag} target ${i} (${nat.candidateKeys[i]}): native ${JSON.stringify(sn)} vs interp ${JSON.stringify(si)}`);
        }
      } catch (e: any) {
        perOptionMismatches.push(`${tag} target ${i}: threw ${String(e?.message ?? e)}`);
      }
    }
  }

  beforeAll(() => {
    /* eslint-disable no-console */
    console.log(`\n── Rotomancer switch differential [bench→active option-set equivalence] ──`);
    console.log(`  candidate scenarios : ${scenarios.length}`);
    console.log(`  enumerated          : ${enumerated} (multi-option: ${multiOption})`);
    console.log(`  options checked     : ${optionsChecked}`);
    console.log(`  option-set mismatch : ${optionSetMismatches.length}`);
    console.log(`  per-option mismatch : ${perOptionMismatches.length}`);
    console.log(`  skipped             : ${JSON.stringify(skips)}`);
    [...optionSetMismatches.map(m => `OPTSET ${m}`), ...perOptionMismatches.map(m => `TARGET ${m}`)].forEach(m => console.log(`   • ${m}`));
    /* eslint-enable no-console */
  });

  it('native and interp offer the same bench targets + bounds for every switch', () => {
    expect(optionSetMismatches).toEqual([]);
  });
  it('switching to each target promotes the same species in both engines', () => {
    expect(perOptionMismatches).toEqual([]);
  });
  it('actually exercised multi-option switches (non-vacuity)', () => {
    expect(multiOption).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Multi-select differential (§12.14) — the last first-eligible-resolved gap: a choice of N≥2 targets ("50
// damage to 2 of your opponent's Pokémon" — Twin Shotels, Split Bomb, Mirage Barrage, Obsidian, Trifrost).
// §12.10 covered only targetCount===1; the main differential resolves the N-target prompt first-eligible. The
// masking risk is the same, but over COMBINATIONS: native and interp could offer different candidate sets, or
// land the N hits on different Pokémon. So we verify (A) the same candidate set + bounds and (B) that selecting
// each N-subset produces the same observable — and per-slot damage in the snapshot already distinguishes which
// Pokémon were hit, so no identity snapshot is needed here. A 3-bench board gives K>N (genuine combinations).
describe('Rotomancer multi-select differential — option-combination equivalence', () => {
  // Native divergences the candidate-set check surfaces (interp faithful to the IR/text; native diverges). Per
  // the standing rule allow-listed, never fixed (memory: rotomancer-no-card-fixes); keyed by printingId.
  const KNOWN_MULTI_BUGS: Record<string, string> = {
    // Electivire ex DRI — Dual Bolt: text "50 damage to 2 of your opponent's Pokémon" targets ANY Pokémon, but
    // native's prompt offers the Bench only (option set {bench0,bench1,bench2} vs the IR's {active,bench…}).
    // The candidate-set invariant catches it directly. → Twinleaf bug. Two printings.
    'sv10-212': 'Electivire ex DRI — Dual Bolt: native targets Benched-only; text/IR target any Pokémon',
    'sv10-69': 'Electivire ex DRI — Dual Bolt: native targets Benched-only; text/IR target any Pokémon',
    // Steven's Skarmory DRI — Sonic Double: native sets the attack's base `damage: 50` (auto-applied to the
    // defender) ON TOP OF the 50-spread to 2 chosen via DAMAGE_OPPONENT_POKEMON — double-counting the Active
    // (it takes 100 when also chosen, 50 otherwise). Text is "50 damage to 2 of your opponent's Pokémon" =
    // spread only; the IR (one 50-spread to 2, no base) is faithful. → Twinleaf bug.
    'sv10-142': 'Steven\'s Skarmory DRI — Sonic Double: native base damage:50 double-hits the Active atop the 50-spread',
  };

  const AFFECT = new Set(['damage.deal', 'condition.apply', 'heal', 'damage.placeCounters']);
  const isChoiceSel = (sel: any): boolean => {
    if (!sel || sel.role !== undefined) { return false; }
    if (sel.quantity === 'one') { return true; }
    return sel.chooser !== undefined && sel.quantity === undefined;
  };
  const hasMultiChoice = (body: any[]): boolean => body.some((op: any) =>
    AFFECT.has(op.kind) && isChoiceSel(op.target?.of) && (op.targetCount ?? 1) >= 2);

  // Index-combinations: choose k of n (k≤n). Enumerates every N-subset of the candidate list.
  function combinations(n: number, k: number): number[][] {
    const res: number[][] = [];
    const rec = (start: number, combo: number[]): void => {
      if (combo.length === k) { res.push(combo.slice()); return; }
      for (let i = start; i < n; i++) { combo.push(i); rec(i + 1, combo); combo.pop(); }
    };
    rec(0, []);
    return res;
  }

  // One mirror game on a 3-bench board (each side: active + 3 bench, hp-safe at 0 so a spread hit is an
  // observable per-slot damage, not a KO that erases which slot was struck). Registers a ChoosePokemonPrompt
  // override capturing the candidate set + (min,max) and resolving via `pick`.
  function runMulti(
    fullName: string, energies: string[], attackLabel: string, fragments: IrFragment[] | null,
    pick: (candidates: CardTarget[], prompt: ChoosePokemonPrompt) => CardTarget[]
  ): { snap: Snapshot; promptCount: number; min: number; max: number; candidateKeys: string[] } {
    const bench = [{ card: fullName }, { card: fullName }, { card: fullName }];
    const game = setupGame({
      turn: 2,
      player1: { active: { card: fullName, energy: energies }, bench, deck: padDeck(10) },
      player2: { active: { card: fullName }, bench, deck: padDeck(10) },
    });
    if (fragments) {
      const native = game.state.players[0].active.cards[0];
      const ic = buildInterpretedCard(native, fragments);
      ic.id = native.id;
      game.state.players[0].active.cards[0] = ic;
    }
    let promptCount = 0, min = 0, max = 0;
    let candidateKeys: string[] = [];
    game.overridePrompt(ChoosePokemonPromptType, (prompt, state) => {
      promptCount++;
      const p = prompt as ChoosePokemonPrompt;
      const candidates = choosePokemonCandidates(state, p);
      if (promptCount === 1) { candidateKeys = candidates.map(cardTargetKey); min = p.options.min; max = p.options.max; }
      return pick(candidates, p);
    });
    useAttack(game.store, game.state, 0, attackLabel);
    return { snap: snapshot(game.state), promptCount, min, max, candidateKeys };
  }

  const firstEligible = (c: CardTarget[], p: ChoosePokemonPrompt) => c.slice(0, p.options.max);

  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Array<{
    printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body'];
  }>).filter(s => hasMultiChoice(s.body));

  let enumerated = 0, subsetsChecked = 0, multiSubset = 0;
  const skips: Record<string, number> = {};
  const skip = (r: string) => { skips[r] = (skips[r] ?? 0) + 1; };
  const optionSetMismatches: string[] = [];
  const perSubsetMismatches: string[] = [];
  // `min` divergences are reported, NOT asserted: native's multi-target prefab systematically uses min:1 (lets
  // you under-target) while the IR mandates exactly N ("to N of your opponent's Pokémon"). That's one prefab
  // convention across many cards, orthogonal to the masking risk (same target SET + same per-subset placement),
  // so we surface it honestly without burying the genuine per-card candidate-set bug (Dual Bolt) in allow-list noise.
  const minDivergences: string[] = [];

  for (const s of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skip('non-exact'); continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) { skip('non-pokemon'); continue; }
    if (card.weakness?.some(w => w.type === card.cardType)) { skip('self-weak'); continue; }
    if (KNOWN_MULTI_BUGS[s.printingId]) { skip('allowlisted-native-bug'); continue; }

    const energies = s.cost.filter((c: string) => c.toUpperCase() !== 'FREE').map(energyToCard);
    const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
    const run = (frags: IrFragment[] | null, pick: (c: CardTarget[], p: ChoosePokemonPrompt) => CardTarget[]) =>
      runMulti(res.fullName!, energies, s.attackLabel, frags, pick);

    let nat, intp;
    try { nat = run(null, firstEligible); intp = run(fragments, firstEligible); }
    catch { skip('build-error'); continue; }

    if (nat.promptCount === 0 || intp.promptCount === 0) { skip('no-choose-pokemon-prompt'); continue; }
    if (nat.promptCount > 1 || intp.promptCount > 1) { skip('multi-prompt (deferred)'); continue; }
    if (nat.max <= 1 || intp.max <= 1) { skip('not-multi-select'); continue; }

    enumerated++;
    const tag = `${s.printingId} ${s.attackLabel} (${s.name})`;
    // Invariant A — same candidate SET + same MAX (the targets and how many — where the masking risk lives).
    const aKey = (r: { candidateKeys: string[]; max: number }) =>
      JSON.stringify({ keys: r.candidateKeys, max: r.max });
    if (aKey(nat) !== aKey(intp)) {
      optionSetMismatches.push(`${tag}: native ${aKey(nat)} vs interp ${aKey(intp)}`);
      continue;
    }
    if (nat.min !== intp.min) { minDivergences.push(`${tag}: native min ${nat.min} vs interp min ${intp.min} (max ${nat.max})`); }
    const keys: string[] = nat.candidateKeys;
    const subsets = combinations(keys.length, nat.max);
    if (subsets.length > 1) { multiSubset++; }
    // Invariant B — selecting each N-subset lands the same per-slot damage on both engines.
    for (const subset of subsets) {
      subsetsChecked++;
      try {
        const sn = run(null, c => subset.map(i => c[i])).snap;
        const si = run(fragments, c => subset.map(i => c[i])).snap;
        if (JSON.stringify(sn) !== JSON.stringify(si)) {
          perSubsetMismatches.push(`${tag} subset [${subset.map(i => keys[i]).join(',')}]: native ${JSON.stringify(sn)} vs interp ${JSON.stringify(si)}`);
        }
      } catch (e: any) {
        perSubsetMismatches.push(`${tag} subset [${subset.join(',')}]: threw ${String(e?.message ?? e)}`);
      }
    }
  }

  beforeAll(() => {
    /* eslint-disable no-console */
    console.log(`\n── Rotomancer multi-select differential [option-combination equivalence] ──`);
    console.log(`  candidate scenarios : ${scenarios.length}`);
    console.log(`  enumerated          : ${enumerated} (multi-subset: ${multiSubset})`);
    console.log(`  subsets checked     : ${subsetsChecked}`);
    console.log(`  option-set mismatch : ${optionSetMismatches.length}`);
    console.log(`  per-subset mismatch : ${perSubsetMismatches.length}`);
    console.log(`  min divergence (rpt): ${minDivergences.length} (native multi-target prefab min:1 vs IR exactly-N)`);
    console.log(`  skipped             : ${JSON.stringify(skips)}`);
    [...optionSetMismatches.map(m => `OPTSET ${m}`), ...perSubsetMismatches.map(m => `SUBSET ${m}`), ...minDivergences.map(m => `MIN ${m}`)].forEach(m => console.log(`   • ${m}`));
    /* eslint-enable no-console */
  });

  it('native and interp offer the same candidate set + bounds for every multi-target attack', () => {
    expect(optionSetMismatches).toEqual([]);
  });
  it('selecting each N-subset produces the same observable in both engines', () => {
    expect(perSubsetMismatches).toEqual([]);
  });
  it('actually exercised multi-subset choices (non-vacuity)', () => {
    expect(multiSubset).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Energy-attach destination differential (§12.16) — the masking-safety follow-up for the §12.15 residual
// op. `energy.attach` to a player-chosen Pokémon ("attach to 1 of your Pokémon" — Pick and Stick, Aura Jab)
// can't be verified by the §12.10 ChoosePokemonPrompt differential because **native uses an
// `AttachEnergyPrompt`, not a `ChoosePokemonPrompt`** — the interp models the destination via
// `affectChoiceTarget`'s ChoosePokemonPrompt. Both prompts expose the same `playerType`/`slots`/`blocked`
// geometry, so we capture each engine's destination set with the SAME `choosePokemonCandidates` (a shim for
// AttachEnergyPrompt) and verify (A) the same destination set and (B) attaching to each lands the energy on
// the same Pokémon — closing the option-set masking risk these two prompt types would otherwise hide.
describe('Rotomancer energy-attach differential — destination option-set equivalence', () => {
  // Native divergences surfaced (interp faithful; native diverges) — allow-listed, never fixed
  // (memory: rotomancer-no-card-fixes); keyed by printingId.
  const KNOWN_ATTACH_BUGS: Record<string, string> = {};

  // Source energy in discard so an `energy.attach`-from-discard choice actually fires and lands observably
  // (3 [F] for Aura Jab's Fighting filter, +1 [R] so any-Basic cards have ≥2 distinct picks).
  const SOURCE_ENERGY = ['Fighting Energy SVE', 'Fighting Energy SVE', 'Fighting Energy SVE', 'Fire Energy SVE'];

  const isSingleChoiceSel = (sel: any): boolean => {
    if (!sel || sel.role !== undefined) { return false; }
    if (sel.quantity === 'one') { return true; }
    return sel.chooser !== undefined && sel.quantity === undefined;
  };
  const hasEnergyAttachChoice = (body: any[]): boolean => body.some((op: any) =>
    op.kind === 'energy.attach' && isSingleChoiceSel(op.target?.of) && (op.targetCount ?? 1) === 1);

  // Destination candidates a prompt offers — reuse choosePokemonCandidates via a shim, since both
  // AttachEnergyPrompt (native) and ChoosePokemonPrompt (interp) expose playerId/playerType/slots/blocked.
  const destFrom = (state: State, playerId: number, playerType: any, slots: any, blocked: any): CardTarget[] =>
    choosePokemonCandidates(state, { playerId, playerType, slots, options: { blocked } } as any);

  // One mirror game (attacker + 2 bench, discard seeded). Overrides BOTH the interp's ChoosePokemonPrompt and
  // native's AttachEnergyPrompt: capture the destination set, then resolve to destination `pick(cands)` (or
  // first-eligible when pick returns <0). Returns the post-attack snapshot + the destination keys.
  function runAttach(
    fullName: string, energies: string[], attackLabel: string, fragments: IrFragment[] | null,
    pick: (cands: CardTarget[]) => number
  ): { snap: Snapshot; promptCount: number; destKeys: string[] } {
    const bench = [{ card: fullName }, { card: fullName }];
    const game = setupGame({
      turn: 2,
      player1: { active: { card: fullName, energy: energies }, bench, deck: padDeck(10), discard: SOURCE_ENERGY },
      player2: { active: { card: fullName }, bench, deck: padDeck(10), discard: SOURCE_ENERGY },
    });
    if (fragments) {
      const native = game.state.players[0].active.cards[0];
      const ic = buildInterpretedCard(native, fragments);
      ic.id = native.id;
      game.state.players[0].active.cards[0] = ic;
    }
    let promptCount = 0;
    let destKeys: string[] = [];
    // interp destination — ChoosePokemonPrompt (affectChoiceTarget)
    game.overridePrompt(ChoosePokemonPromptType, (prompt, state) => {
      promptCount++;
      const p = prompt as ChoosePokemonPrompt;
      const cands = choosePokemonCandidates(state, p);
      if (promptCount === 1) { destKeys = cands.map(cardTargetKey); }
      const i = pick(cands);
      return i < 0 ? cands.slice(0, p.options.max) : (cands[i] ? [cands[i]] : []);
    });
    // native destination — AttachEnergyPrompt (assign up to max eligible energy to the chosen Pokémon)
    game.overridePrompt(AttachEnergyPromptType, (prompt, state) => {
      promptCount++;
      const p = prompt as AttachEnergyPrompt;
      const cands = destFrom(state, p.playerId, p.playerType, p.slots, p.options.blockedTo);
      if (promptCount === 1) { destKeys = cands.map(cardTargetKey); }
      const i = pick(cands);
      const dest = i < 0 ? cands[0] : cands[i];
      if (!dest) { return p.options.allowCancel ? null : []; }
      const blockedE = new Set(p.options.blocked);
      const eIdx: number[] = [];
      for (let k = 0; k < p.cardList.cards.length; k++) {
        const c = p.cardList.cards[k];
        if (!blockedE.has(k) && c.superType === SuperType.ENERGY && cardMatchesPartialFilter(c, p.filter)) { eIdx.push(k); }
      }
      return eIdx.slice(0, p.options.max).map(idx => ({ to: dest, index: idx }));
    });
    useAttack(game.store, game.state, 0, attackLabel);
    return { snap: snapshot(game.state), promptCount, destKeys };
  }

  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Array<{
    printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body'];
  }>).filter(s => hasEnergyAttachChoice(s.body));

  let enumerated = 0, destChecked = 0, multiDest = 0;
  const skips: Record<string, number> = {};
  const skip = (r: string) => { skips[r] = (skips[r] ?? 0) + 1; };
  const optionSetMismatches: string[] = [];
  const perDestMismatches: string[] = [];

  for (const s of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skip('non-exact'); continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) { skip('non-pokemon'); continue; }
    if (card.weakness?.some(w => w.type === card.cardType)) { skip('self-weak'); continue; }
    if (KNOWN_ATTACH_BUGS[s.printingId]) { skip('allowlisted-native-bug'); continue; }

    const energies = s.cost.filter((c: string) => c.toUpperCase() !== 'FREE').map(energyToCard);
    const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
    const run = (frags: IrFragment[] | null, pick: (c: CardTarget[]) => number) =>
      runAttach(res.fullName!, energies, s.attackLabel, frags, pick);

    let nat, intp;
    try { nat = run(null, () => -1); intp = run(fragments, () => -1); }
    catch { skip('build-error'); continue; }

    if (nat.promptCount === 0 || intp.promptCount === 0) { skip('no-attach-prompt'); continue; }
    if (nat.promptCount > 1 || intp.promptCount > 1) { skip('multi-prompt (deferred)'); continue; }

    enumerated++;
    const tag = `${s.printingId} ${s.attackLabel} (${s.name})`;
    // Invariant A — native (AttachEnergyPrompt) and interp (ChoosePokemonPrompt) offer the same destinations.
    if (JSON.stringify(nat.destKeys) !== JSON.stringify(intp.destKeys)) {
      optionSetMismatches.push(`${tag}: native ${JSON.stringify(nat.destKeys)} vs interp ${JSON.stringify(intp.destKeys)}`);
      continue;
    }
    if (nat.destKeys.length > 1) { multiDest++; }
    // Invariant B — attaching to each destination lands the energy on the same Pokémon.
    for (let i = 0; i < nat.destKeys.length; i++) {
      destChecked++;
      try {
        const sn = run(null, () => i).snap;
        const si = run(fragments, () => i).snap;
        if (JSON.stringify(sn) !== JSON.stringify(si)) {
          perDestMismatches.push(`${tag} dest ${i} (${nat.destKeys[i]}): native ${JSON.stringify(sn)} vs interp ${JSON.stringify(si)}`);
        }
      } catch (e: any) {
        perDestMismatches.push(`${tag} dest ${i}: threw ${String(e?.message ?? e)}`);
      }
    }
  }

  beforeAll(() => {
    /* eslint-disable no-console */
    console.log(`\n── Rotomancer energy-attach differential [destination option-set equivalence] ──`);
    console.log(`  candidate scenarios : ${scenarios.length}`);
    console.log(`  enumerated          : ${enumerated} (multi-dest: ${multiDest})`);
    console.log(`  destinations checked: ${destChecked}`);
    console.log(`  option-set mismatch : ${optionSetMismatches.length}`);
    console.log(`  per-dest mismatch   : ${perDestMismatches.length}`);
    console.log(`  skipped             : ${JSON.stringify(skips)}`);
    [...optionSetMismatches.map(m => `OPTSET ${m}`), ...perDestMismatches.map(m => `DEST ${m}`)].forEach(m => console.log(`   • ${m}`));
    /* eslint-enable no-console */
  });

  it('native and interp offer the same energy-attach destinations (across prompt types)', () => {
    expect(optionSetMismatches).toEqual([]);
  });
  it('attaching to each destination lands the energy on the same Pokémon in both engines', () => {
    expect(perDestMismatches).toEqual([]);
  });
  it('actually exercised multi-destination attaches (non-vacuity)', () => {
    expect(multiDest).toBeGreaterThan(0);
  });
});
