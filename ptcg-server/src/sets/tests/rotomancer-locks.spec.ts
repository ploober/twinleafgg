import * as fs from 'fs';
import * as path from 'path';
import { setupGame, padDeck, getCardByName } from './test-helpers';
import { useAttack } from './card-test-helpers';
import { resolvePrinting, energyToCard } from './rotomancer/bridge';
import { buildInterpretedCard, IrFragment } from './rotomancer/ir-interpreter';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { GamePhase } from '../../game/store/state/state';
import { AttackEffect } from '../../game/store/effects/game-effects';
import { DealDamageEffect } from '../../game/store/effects/attack-effects';

/**
 * Multi-turn LOCK differential. The single-turn differential can't see "during your opponent's
 * next turn" riders — the interpreter no-ops them, so they're vacuously "compared". This spec
 * probes them: it runs the lock attack, then on the opponent's turn deals a known synthetic hit to
 * the locked Pokémon and compares the *observed* result (mechanism-independent) between the native
 * card and the IR-interpreted card.
 *
 * Scope so far: self-targeted, opponent's-next-turn *incoming-damage* modifiers — the family the
 * synthetic damage probe can observe directly:
 *   - `continuous.modifier { damageReduction }` ("this Pokémon takes N less damage next turn"),
 *     backed by the engine-enforced `damageReductionNextTurn` property.
 *   - `continuous.modifier { preventDamage }` ("prevent all damage from <matching> Pokémon next
 *     turn"); natively a marker + preventDefault, reproduced by the interpreter as a large
 *     `damageReductionNextTurn` sentinel decided against self (the mirror probe's attacker is the
 *     same printing). See ir-interpreter.
 * The interpreter applies the modifier, the engine reduces the probe, and we compare the landed
 * damage. A divergence is an IR-vs-native amount/applicability discrepancy.
 */

interface Scenario { printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body']; }

// A self-targeted, next-turn incoming-damage modifier the probe can observe. Returns the modifier
// kind for the scorecard, or null if the body has none (→ scenario is not a probe candidate).
function selfIncomingDamageModifier(body: any[]): 'damageReduction' | 'preventDamage' | null {
  for (const op of body) {
    if (op.kind !== 'continuous.modifier' || op.appliesTo?.role !== 'self') { continue; }
    const k = op.modifier?.kind;
    if (k === 'damageReduction' || k === 'preventDamage') { return k; }
  }
  return null;
}

// Run the lock attack, then deal a known synthetic hit to the (locked) attacker on the opponent's
// turn. Returns the damage the probe landed (probe − reduction), or 'KO'. The probe is sized just
// under the card's remaining HP so the reduction is visible and the probe never knocks out.
function lockAndProbe(fullName: string, cost: string[], attackLabel: string, fragments: IrFragment[] | null): number | 'KO' {
  const game = setupGame({
    turn: 2,
    player1: { active: { card: fullName, energy: cost.map(energyToCard) }, deck: padDeck(10) },
    player2: { active: { card: fullName }, deck: padDeck(10) },
  });
  if (fragments) {
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, fragments);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
  }
  useAttack(game.store, game.state, 0, attackLabel); // P0's lock attack ends the turn → P1's turn

  const p0 = game.state.players[0], p1 = game.state.players[1];
  const card = p0.active.getPokemonCard() as PokemonCard;
  if (!card) { return 'KO'; }
  const before = p0.active.damage;
  const probe = Math.max(10, card.hp - before - 10); // never KO

  // Probe as a real attack: set ATTACK phase so native's phase-gated reduction interceptors fire
  // (some cards reduce via a custom marker checked only during GamePhase.ATTACK; others use the
  // phase-independent engine property — this covers both).
  game.state.phase = GamePhase.ATTACK;
  const atk = new AttackEffect(p1, p0, { name: '__probe__', cost: [], damage: probe, text: '' });
  atk.target = p0.active;
  const hit = new DealDamageEffect(atk, probe);
  hit.target = p0.active;
  game.store.reduceEffect(game.state, hit);

  if (p0.active.getPokemonCard() === undefined) { return 'KO'; }
  return p0.active.damage - before; // landed damage = probe − damageReductionNextTurn
}

describe('Rotomancer lock differential — incoming-damage modifiers (multi-turn probe)', () => {
  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Scenario[])
    .filter(s => selfIncomingDamageModifier(s.body) !== null);

  // Native lock bugs surfaced by this probe (Twinleaf bugs — allow-listed, not fixed, per project
  // guidance). Keyed by attack label.
  const KNOWN_LOCK_BUGS: Record<string, string> = {
    'Flame Screen': 'Team Rocket\'s Moltres ex: reduceEffect adds FLAME_SCREEN_MARKER but never reads it to reduce damage — the "takes 50 less" is a dead marker, never enforced. → Twinleaf bug.',
  };

  const mismatches: string[] = [];
  let compared = 0, skipped = 0;
  const byFamily: Record<string, number> = { damageReduction: 0, preventDamage: 0 };

  for (const s of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skipped++; continue; }
    if (KNOWN_LOCK_BUGS[s.attackLabel]) { skipped++; continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard) || card.weakness?.some(w => w.type === card.cardType)) { skipped++; continue; }

    const cost = s.cost.filter(c => c.toUpperCase() !== 'FREE');
    const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
    let native: number | 'KO', interp: number | 'KO';
    try {
      native = lockAndProbe(res.fullName!, cost, s.attackLabel, null);
    } catch { skipped++; continue; }
    try {
      interp = lockAndProbe(res.fullName!, cost, s.attackLabel, fragments);
    } catch { skipped++; continue; } // interpreter doesn't support some op in the body
    compared++;
    byFamily[selfIncomingDamageModifier(s.body)!]++;
    if (native !== interp) {
      mismatches.push(`${s.printingId} ${s.attackLabel} (${s.name}): native took ${native}, interp took ${interp}`);
    }
  }

  /* eslint-disable no-console */
  it('reports the lock scorecard', () => {
    console.log(`\n  lock differential [incoming-damage]: scenarios ${scenarios.length}, compared ${compared} (damageReduction ${byFamily.damageReduction}, preventDamage ${byFamily.preventDamage}), skipped ${skipped}, mismatches ${mismatches.length}`);
    mismatches.forEach(m => console.log(`   • ${m}`));
    expect(compared).toBeGreaterThan(0);
  });
  /* eslint-enable no-console */

  it('native and interpreted agree on the damage reduction', () => {
    expect(mismatches).toEqual([]);
  });
});
