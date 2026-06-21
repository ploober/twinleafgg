import * as fs from 'fs';
import * as path from 'path';
import { setupGame, padDeck, getCardByName } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';
import { resolvePrinting, energyToCard } from './rotomancer/bridge';
import { buildInterpretedCard, IrFragment } from './rotomancer/ir-interpreter';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { State } from '../../game/store/state/state';
import { PokemonCardList } from '../../game/store/state/pokemon-card-list';

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
}
interface SideSnapshot {
  active: PokeSnap;
  bench: PokeSnap[];   // occupied bench slots, in slot order — verifies spread / per-bench effects
  hand: number;
  deck: number;
  discard: number;
  prizes: number;
}
interface Snapshot { p0: SideSnapshot; p1: SideSnapshot; }

function pokeSnap(list: PokemonCardList): PokeSnap {
  const ko = list.getPokemonCard() === undefined;
  return {
    damage: ko ? 'KO' : list.damage,
    conditions: ko ? [] : list.specialConditions.map(String).sort(),
    energy: ko ? 0 : list.energies.cards.length,
  };
}

function snapshot(state: State): Snapshot {
  const side = (i: number): SideSnapshot => {
    const p = state.players[i];
    return {
      active: pokeSnap(p.active),
      bench: p.bench.filter(b => b.getPokemonCard() !== undefined).map(pokeSnap),
      hand: p.hand.cards.length,
      deck: p.deck.cards.length,
      discard: p.discard.cards.length,
      prizes: p.getPrizeLeft(),
    };
  };
  return { p0: side(0), p1: side(1) };
}

interface Board { attackerDamage?: number; defenderDamage?: number; benchCount?: number; }

interface AttackRun { snap: Snapshot; ambiguous: number; }

function buildAndAttack(
  fullName: string, costEnergies: string[], attackLabel: string,
  fragments: IrFragment[] | null, board: Board = {}
): AttackRun {
  const bench = Array.from({ length: board.benchCount ?? 0 }, () => ({ card: fullName }));
  const game = setupGame({
    turn: 2,
    player1: { active: { card: fullName, energy: costEnergies, damage: board.attackerDamage ?? 0 }, bench, deck: padDeck(10) },
    player2: { active: { card: fullName, damage: board.defenderDamage ?? 0 }, bench, deck: padDeck(10) },
  });
  if (fragments) {
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, fragments);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
  }
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
    'Greedy Fang': 'Mega Sharpedo ex PFL: card text "Draw 2 cards" but native MOVE_CARDS draws 1. IR/interp draw 2. → Twinleaf bug',
    'Hungry Jaws': 'Mega Sharpedo ex PFL: the "+150 if this Pokémon has damage" rider is wired to attack index 0 (Greedy Fang), so Hungry Jaws (index 1) never applies it. IR/interp apply it. → Twinleaf bug',
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
});
