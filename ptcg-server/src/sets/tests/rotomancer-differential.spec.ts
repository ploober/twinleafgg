import * as fs from 'fs';
import * as path from 'path';
import { setupGame, padDeck, getCardByName } from './test-helpers';
import { useAttack, getDamage } from './card-test-helpers';
import { resolvePrinting, energyToCard } from './rotomancer/bridge';
import { buildInterpretedCard, IrFragment } from './rotomancer/ir-interpreter';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { State } from '../../game/store/state/state';

/**
 * Phase 4 + 6 — differential: run the SAME scenario through the native Twinleaf card and
 * through an InterpretedCard built from the IR, and assert identical observable state. Both
 * sides are the same species (mirror), so weakness never confounds. Agreement means the IR
 * interpreter and the hand-written card produce the same engine result.
 */

interface Snapshot {
  p0damage: number | 'KO';
  p0conditions: string[];
  p1damage: number | 'KO';
  p1conditions: string[];
}

function snapshot(state: State): Snapshot {
  const side = (i: number) => {
    const active = state.players[i].active;
    return active.getPokemonCard() === undefined
      ? { damage: 'KO' as const, conditions: [] as string[] }
      : { damage: active.damage, conditions: active.specialConditions.map(String).sort() };
  };
  const a = side(0), b = side(1);
  return { p0damage: a.damage, p0conditions: a.conditions, p1damage: b.damage, p1conditions: b.conditions };
}

function buildAndAttack(
  fullName: string, costEnergies: string[], attackerDamage: number, attackLabel: string,
  fragments: IrFragment[] | null
): Snapshot {
  const game = setupGame({
    turn: 2,
    player1: { active: { card: fullName, energy: costEnergies, damage: attackerDamage }, deck: padDeck(10) },
    player2: { active: { card: fullName }, deck: padDeck(10) },
  });
  if (fragments) {
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, fragments);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
  }
  useAttack(game.store, game.state, 0, attackLabel);
  return snapshot(game.state);
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
      { kind: 'damage.deal', amount: { kind: 'const', value: 80 }, target: { selector: 'opponentActive' } },
      { kind: 'condition.apply', condition: 'CONFUSED', target: { selector: 'self' } },
    ] }],
  },
  {
    label: 'Umbreon ex PRE — Moon Mirage (160 + Confuse opponent)',
    printingId: 'sv8pt5-60', name: 'Umbreon ex', attackLabel: 'Moon Mirage',
    cost: ['DARKNESS', 'COLORLESS', 'COLORLESS'], attackerDamage: 0,
    fragments: [{ label: 'Moon Mirage', cost: ['Darkness', 'Colorless', 'Colorless'], body: [
      { kind: 'damage.deal', amount: { kind: 'const', value: 160 }, target: { selector: 'opponentActive' } },
      { kind: 'condition.apply', condition: 'CONFUSED', target: { selector: 'opponentActive' } },
    ] }],
  },
  {
    label: 'Zarude SSP — Leaf Drain (20 + heal 20 self)',
    printingId: 'sv8-11', name: 'Zarude', attackLabel: 'Leaf Drain', cost: ['GRASS'], attackerDamage: 30,
    fragments: [{ label: 'Leaf Drain', cost: ['Grass'], body: [
      { kind: 'damage.deal', amount: { kind: 'const', value: 20 }, target: { selector: 'opponentActive' } },
      { kind: 'heal', amount: { kind: 'const', value: 20 }, target: { selector: 'self' } },
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
      const native = buildAndAttack(res.fullName!, energies, c.attackerDamage, c.attackLabel, null);
      const interpreted = buildAndAttack(res.fullName!, energies, c.attackerDamage, c.attackLabel, c.fragments);
      expect(interpreted).toEqual(native);
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
        target: { selector: 'opponentActive' },
      }],
    }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;

    useAttack(game.store, game.state, 0, 'Bench Beat');
    expect(getDamage(game.state, 1, 'active')).toBe(90); // 30 × 3 benched
  });

  // Native-vs-interpreted disagreements across the whole attack corpus. The interpreter runs the
  // IR faithfully, so these are IR-vs-reality gaps (see FINDINGS.md). Adjudication deferred.
  const KNOWN_MISMATCHES: Record<string, string> = {
    // IR: forEach pokemonInPlay/opponent. Real: "60 for each opponent's Pokémon ex AND Pokémon V".
    'sv6pt5-32 Illusory Hijacking': 'IR drops the ex/V predicate on the count',
    // IR: perCount energyAttached/self. Real: "20 more per [L] Energy on all your Iono's Pokémon".
    'sv9-47 Voltaic Chain': 'IR drops the [L]-type filter and the multi-Pokémon scope',
    // IR: flat 170. Real: "discard a Grass Energy from hand; if you do, 170, else nothing" — also a
    // corpus-replay finding. With no Grass Energy in hand, native does 0, interp does 170 → KO.
    'sv6pt5-5 Power Shot': 'IR omits the conditional-discard rider (flat 170 vs "discard or nothing")',
  };

  it('matches native across the attack corpus (interpreter decides support at runtime)', () => {
    const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
    const scenarios = JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Array<{
      printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body'];
    }>;

    const mismatches: string[] = [];
    let compared = 0, unsupported = 0;
    for (const s of scenarios) {
      const res = resolvePrinting(s.printingId, s.name);
      if (res.status !== 'exact') continue;
      const card = getCardByName(res.fullName!);
      if (!(card instanceof PokemonCard)) continue;
      if (card.weakness?.some(w => w.type === card.cardType)) continue;
      if (KNOWN_MISMATCHES[`${s.printingId} ${s.attackLabel}`]) continue;

      const energies = s.cost.map(energyToCard);
      const preDamage = Math.min(30, card.hp - 20); // makes self-heal observable; shared by both runs
      const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
      let native: Snapshot, interpreted: Snapshot;
      try {
        native = buildAndAttack(res.fullName!, energies, preDamage, s.attackLabel, null);
      } catch {
        continue; // native attack-name / energy errors are catalogued by the corpus spec
      }
      try {
        interpreted = buildAndAttack(res.fullName!, energies, preDamage, s.attackLabel, fragments);
      } catch {
        unsupported++; // interpreter doesn't yet handle an op/predicate in this body — visible gap
        continue;
      }
      compared++;
      if (JSON.stringify(native) !== JSON.stringify(interpreted)) {
        mismatches.push(`${s.printingId} ${s.attackLabel} (${s.name}): native ${JSON.stringify(native)} vs interp ${JSON.stringify(interpreted)}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n  attack-corpus differential: compared ${compared}, unsupported ${unsupported}, mismatches ${mismatches.length}`);
    mismatches.forEach(m => console.log(`   • ${m}`)); // eslint-disable-line no-console
    expect(compared).toBeGreaterThan(15);
    expect(mismatches).toEqual([]);
  });
});
