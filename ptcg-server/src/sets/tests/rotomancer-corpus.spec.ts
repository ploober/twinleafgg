import * as fs from 'fs';
import * as path from 'path';
import { setupGame, padDeck, getCardByName } from './test-helpers';
import { useAttack, getDamage, hasActivePokemon } from './card-test-helpers';
import { resolvePrinting, energyToCard } from './rotomancer/bridge';
import { PokemonCard } from '../../game/store/card/pokemon-card';

/**
 * Phase 3 — corpus replay. Every pure const-damage attack in Rotomancer's IR (vendored in
 * fixtures/plain-attack-scenarios.json) is replayed against the native Twinleaf card as a
 * mirror match (same species both sides → weakness never triggers). The IR's printed damage
 * is the oracle; we assert Twinleaf computes the same (or a KO when damage >= HP).
 *
 * Non-exact printings are skipped (printing-precise only). Genuine engine disagreements are
 * recorded in KNOWN_DISAGREEMENTS (adjudication deferred — the goal here is measurement, not
 * deciding which engine is right). A NEW disagreement or harness error fails the suite.
 */

interface Scenario {
  printingId: string;
  name: string;
  attackLabel: string;
  cost: string[];
  expectedDamage: number;
}

type Category = 'agree' | 'disagree' | 'error' | 'skip';
interface Result {
  scenario: Scenario;
  category: Category;
  reason?: string;
  detail?: string;
}

// printingId + attackLabel -> reason. Genuine cross-engine discrepancies surfaced by this
// replay; adjudication (which project to fix) is deferred. See rotomancer/FINDINGS.md.
const KNOWN_DISAGREEMENTS: Record<string, string> = {
  // IR drops the "you may discard a Grass Energy from your hand; if you do, 170" rider and
  // encodes a flat 170. Twinleaf implements the rider, so with no Grass Energy in hand the
  // attack does 0 and the mirror survives. → IR faithfulness gap.
  'sv6pt5-5 Power Shot': 'IR omits the conditional discard rider (flat 170 vs real "discard or nothing")',
  // Twinleaf has no attack named "Headbutt Bounce" on DRI-82.
  'sv10-82 Headbutt Bounce': 'attack-name mismatch on this printing',
  // Twinleaf "Beat" throws CANNOT_PLAY_THIS_CARD when used — likely an attack-wiring bug.
  'sv5-136 Beat': 'Twinleaf Beat errors (CANNOT_PLAY_THIS_CARD) — Twinleaf bug candidate',
  // Attack-name typo: Twinleaf "Cutter Wind" vs IR/real "Cutting Wind".
  'sv8-105 Cutting Wind': 'attack-name typo: Twinleaf "Cutter Wind" vs IR "Cutting Wind"',
  // Energy-cost type mismatch: Twinleaf costs Fire (Turtonator is a fire attacker); IR says Fighting.
  'sv8-137 Steaming Stomp': 'cost-type mismatch: Twinleaf Fire vs IR Fighting (likely IR error)',
};

function key(s: Scenario): string {
  return `${s.printingId} ${s.attackLabel}`;
}

function loadScenarios(): Scenario[] {
  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'plain-attack-scenarios.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Scenario[];
}

function runScenario(s: Scenario): Result {
  const res = resolvePrinting(s.printingId, s.name);
  if (res.status !== 'exact') {
    return { scenario: s, category: 'skip', reason: res.status };
  }
  const card = getCardByName(res.fullName!);
  if (!(card instanceof PokemonCard)) {
    return { scenario: s, category: 'skip', reason: 'not-a-pokemon' };
  }
  // Mirror match would double damage if the species is weak to its own type — skip those.
  if (card.weakness?.some(w => w.type === card.cardType)) {
    return { scenario: s, category: 'skip', reason: 'self-weakness' };
  }
  try {
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: s.cost.map(energyToCard) }, deck: padDeck(10) },
      player2: { active: { card: res.fullName! }, deck: padDeck(10) },
    });
    useAttack(game.store, game.state, 0, s.attackLabel);

    if (s.expectedDamage < card.hp) {
      const actual = getDamage(game.state, 1, 'active');
      return actual === s.expectedDamage
        ? { scenario: s, category: 'agree' }
        : { scenario: s, category: 'disagree', detail: `expected ${s.expectedDamage} damage, got ${actual}` };
    }
    // expectedDamage >= HP: the mirror should be knocked out.
    return !hasActivePokemon(game.state, 1)
      ? { scenario: s, category: 'agree' }
      : { scenario: s, category: 'disagree', detail: `expected KO (${s.expectedDamage} >= ${card.hp} HP), survived` };
  } catch (e: any) {
    return { scenario: s, category: 'error', detail: String(e?.message ?? e) };
  }
}

describe('Rotomancer corpus replay — pure const-damage attacks vs native Twinleaf', () => {
  const results = loadScenarios().map(runScenario);

  const by = (c: Category) => results.filter(r => r.category === c);
  const skipReasons = by('skip').reduce<Record<string, number>>((m, r) => {
    m[r.reason!] = (m[r.reason!] ?? 0) + 1; return m;
  }, {});

  const unexpectedDisagreements = by('disagree').filter(r => !(key(r.scenario) in KNOWN_DISAGREEMENTS));
  const unexpectedErrors = by('error').filter(r => !(key(r.scenario) in KNOWN_DISAGREEMENTS));

  beforeAll(() => {
    const lines = [
      `\n── Rotomancer corpus replay scorecard ──`,
      `  total scenarios : ${results.length}`,
      `  agree           : ${by('agree').length}`,
      `  disagree        : ${by('disagree').length} (known: ${by('disagree').length - unexpectedDisagreements.length})`,
      `  error           : ${by('error').length} (known: ${by('error').length - unexpectedErrors.length})`,
      `  skip            : ${by('skip').length}  ${JSON.stringify(skipReasons)}`,
    ];
    for (const r of [...by('disagree'), ...by('error')]) {
      lines.push(`   • ${r.category.toUpperCase()} ${key(r.scenario)} (${r.scenario.name}): ${r.detail}`);
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  });

  it('replays a meaningful number of exact-printing cards', () => {
    expect(by('agree').length + by('disagree').length + by('error').length).toBeGreaterThan(10);
  });

  it('has no unexpected disagreements', () => {
    expect(unexpectedDisagreements.map(r => `${key(r.scenario)}: ${r.detail}`)).toEqual([]);
  });

  it('has no unexpected harness errors', () => {
    expect(unexpectedErrors.map(r => `${key(r.scenario)}: ${r.detail}`)).toEqual([]);
  });
});
