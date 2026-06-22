import * as fs from 'fs';
import * as path from 'path';
import { setupGame, padDeck, getCardByName } from './test-helpers';
import { useAttack, endTurn } from './card-test-helpers';
import { resolvePrinting, energyToCard } from './rotomancer/bridge';
import { buildInterpretedCard, IrFragment } from './rotomancer/ir-interpreter';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { GamePhase } from '../../game/store/state/state';
import { AttackEffect, RetreatEffect } from '../../game/store/effects/game-effects';
import { DealDamageEffect } from '../../game/store/effects/attack-effects';
import { PlayItemEffect } from '../../game/store/effects/play-card-effects';
import { TrainerCard } from '../../game/store/card/trainer-card';
import { GameError } from '../../game/game-error';
import { GameMessage } from '../../game/game-message';

/**
 * Multi-turn LOCK differential. The single-turn differential can't see "during your opponent's
 * next turn" riders — the interpreter no-ops them, so they're vacuously "compared". This spec
 * probes them: it runs the lock attack, then on the opponent's turn deals a known synthetic hit to
 * the locked Pokémon and compares the *observed* result (mechanism-independent) between the native
 * card and the IR-interpreted card.
 *
 * Scope so far: opponent's-next-turn modifiers that reduce the damage *this* (lock-user's) Pokémon
 * takes — the family the synthetic damage probe can observe directly:
 *   - `continuous.modifier { damageReduction }` on self ("this Pokémon takes N less damage next
 *     turn"), backed by the engine-enforced `damageReductionNextTurn` property.
 *   - `continuous.modifier { preventDamage }` on self ("prevent all damage from <matching> Pokémon
 *     next turn"); natively a marker + preventDefault, reproduced by the interpreter as a large
 *     `damageReductionNextTurn` sentinel decided against self (the mirror probe's attacker is the
 *     same printing).
 *   - `continuous.modifier { damageDebuff }` on the defending Pokémon ("attacks used by the
 *     Defending Pokémon do N less next turn", Growl/Charm); natively reduces the defender's
 *     *outgoing* damage, but in the mirror probe the defender's only next-turn attack hits this
 *     Pokémon, so it reduces the probe by N just like an incoming reduction. See ir-interpreter.
 * The interpreter applies the modifier, the engine reduces the probe, and we compare the landed
 * damage. A divergence is an IR-vs-native amount/applicability discrepancy.
 */

interface Scenario { printingId: string; name: string; attackLabel: string; cost: string[]; body: IrFragment['body']; }

// A next-turn modifier whose effect on the probe (damage taken by the lock user's active) the spec
// can observe. Returns the modifier kind for the scorecard, or null if the body has none. Self-
// targeted reduction/prevention and a defender-side outgoing debuff all land on the same observable.
function selfIncomingDamageModifier(body: any[]): 'damageReduction' | 'preventDamage' | 'damageDebuff' | null {
  for (const op of body) {
    if (op.kind !== 'continuous.modifier') { continue; }
    const k = op.modifier?.kind;
    if ((k === 'damageReduction' || k === 'preventDamage') && op.appliesTo?.role === 'self') { return k; }
    if (k === 'damageDebuff' && op.appliesTo?.role === 'defending') { return k; }
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
  const byFamily: Record<string, number> = { damageReduction: 0, preventDamage: 0, damageDebuff: 0 };

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
    console.log(`\n  lock differential [incoming-damage]: scenarios ${scenarios.length}, compared ${compared} (damageReduction ${byFamily.damageReduction}, preventDamage ${byFamily.preventDamage}, damageDebuff ${byFamily.damageDebuff}), skipped ${skipped}, mismatches ${mismatches.length}`);
    mismatches.forEach(m => console.log(`   • ${m}`));
    expect(compared).toBeGreaterThan(0);
  });
  /* eslint-enable no-console */

  it('native and interpreted agree on the damage reduction', () => {
    expect(mismatches).toEqual([]);
  });
});

// `rule.override { retreatShutoff }` on the defending Pokémon ("the Defending Pokémon can't retreat
// during the opponent's next turn"). Not a damage measurement — a *blocked-action* probe: run the
// lock attack, then attempt to retreat the locked (opponent's) active and observe whether the engine
// throws BLOCKED_BY_EFFECT. Native cards enforce it via BLOCK_RETREAT/BLOCK_RETREAT_IF_MARKER
// (DEFENDING_POKEMON_CANNOT_RETREAT_MARKER); the interpreter calls the same prefabs, so the probe is
// mechanism-independent and needs no bench/energy (the block throws in propagateEffect, before the
// retreat reducer's own bench/cost checks).
function retreatShutoffDefending(body: any[]): boolean {
  return body.some(op => op.kind === 'rule.override'
    && op.override?.kind === 'retreatShutoff'
    && op.override?.target?.role === 'defending'
    && op.scope === 'opponentNextTurn');
}

function retreatBlocked(fullName: string, cost: string[], attackLabel: string, fragments: IrFragment[] | null): boolean {
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
  useAttack(game.store, game.state, 0, attackLabel); // P0's lock attack → P1's turn; locks P1's active

  const p1 = game.state.players[1];
  try {
    game.store.reduceEffect(game.state, new RetreatEffect(p1, 0));
    return false; // retreat was not blocked by the lock
  } catch (e) {
    return e instanceof GameError && e.message === GameMessage.BLOCKED_BY_EFFECT;
  }
}

describe('Rotomancer lock differential — retreatShutoff (block probe)', () => {
  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Scenario[])
    .filter(s => retreatShutoffDefending(s.body));

  // Native retreat-lock bugs surfaced by this probe (Twinleaf bugs — allow-listed, not fixed, per
  // project guidance). Keyed by attack label.
  const KNOWN_RETREAT_LOCK_BUGS: Record<string, string> = {
    'Numbing Hold': 'Wugtrio ex (TEF): the BLOCK_RETREAT for Numbing Hold is guarded by '
      + 'WAS_ATTACK_USED(effect, 0) — but index 0 is Tricolor Pump; Numbing Hold is index 1. So the '
      + 'retreat lock is never installed when Numbing Hold is used (wrong attack index). The IR and '
      + 'interpreter correctly lock retreat. → Twinleaf bug.',
  };

  const mismatches: string[] = [];
  let compared = 0, skipped = 0;

  for (const s of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skipped++; continue; }
    if (KNOWN_RETREAT_LOCK_BUGS[s.attackLabel]) { skipped++; continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) { skipped++; continue; }

    const cost = s.cost.filter(c => c.toUpperCase() !== 'FREE');
    const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
    let native: boolean, interp: boolean;
    try {
      native = retreatBlocked(res.fullName!, cost, s.attackLabel, null);
    } catch { skipped++; continue; }
    try {
      interp = retreatBlocked(res.fullName!, cost, s.attackLabel, fragments);
    } catch { skipped++; continue; } // interpreter doesn't support some other op in the body
    compared++;
    if (native !== interp) {
      mismatches.push(`${s.printingId} ${s.attackLabel} (${s.name}): native blocked=${native}, interp blocked=${interp}`);
    }
  }

  /* eslint-disable no-console */
  it('reports the retreat-lock scorecard', () => {
    console.log(`\n  lock differential [retreatShutoff]: scenarios ${scenarios.length}, compared ${compared}, skipped ${skipped}, mismatches ${mismatches.length}`);
    mismatches.forEach(m => console.log(`   • ${m}`));
    expect(compared).toBeGreaterThan(0);
  });
  /* eslint-enable no-console */

  it('native and interpreted agree on the retreat lock', () => {
    expect(mismatches).toEqual([]);
  });
});

// `rule.override { attackShutoff }` on self with scope `ownNextAttack` — the "recharge" lock ("during
// your next turn, this Pokémon can't use <attackName>", e.g. Mega Lucario ex / Mega Brave). This needs
// an OWN-turn probe: use the attack, pass the opponent's turn, then re-attempt the same attack and
// observe BLOCKED_BY_EFFECT. Both engines push the name to the central cannotUseAttacksNextTurnPending,
// so the probe verifies the IR names the right attack (and catches a native that locks the wrong one).
// Restricted to the standard recharge case (the locked attackName equals the attack used). The
// opponent gets a Bidoof on the bench so the recharge attack's damage can't end the game before the
// lock user's next turn.
function attackShutoffSelfRecharge(body: any[], attackLabel: string): boolean {
  return body.some(op => op.kind === 'rule.override'
    && op.override?.kind === 'attackShutoff'
    && op.override?.target?.role === 'self'
    && op.scope === 'ownNextAttack'
    && op.override?.attackName === attackLabel);
}

function ownAttackBlocked(fullName: string, cost: string[], attackLabel: string, fragments: IrFragment[] | null): boolean {
  const energy = cost.map(energyToCard);
  const game = setupGame({
    turn: 2,
    player1: { active: { card: fullName, energy }, deck: padDeck(10) },
    player2: { active: { card: fullName }, bench: [{ card: 'Bidoof CRZ' }], deck: padDeck(10) },
  });
  if (fragments) {
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, fragments);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
  }
  useAttack(game.store, game.state, 0, attackLabel); // P0 uses the recharge attack → lock on P0, → P1's turn
  endTurn(game.store, game.state);                   // P1 passes → back to P0's next turn

  try {
    useAttack(game.store, game.state, 0, attackLabel); // P0 re-attempts the same attack
    return false; // not blocked by the recharge lock
  } catch (e) {
    return e instanceof GameError && e.message === GameMessage.BLOCKED_BY_EFFECT;
  }
}

describe('Rotomancer lock differential — attackShutoff recharge (own-turn probe)', () => {
  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Scenario[])
    .filter(s => attackShutoffSelfRecharge(s.body, s.attackLabel));

  const mismatches: string[] = [];
  let compared = 0, skipped = 0;

  for (const s of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skipped++; continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) { skipped++; continue; }

    const cost = s.cost.filter(c => c.toUpperCase() !== 'FREE');
    const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
    let native: boolean, interp: boolean;
    try {
      native = ownAttackBlocked(res.fullName!, cost, s.attackLabel, null);
    } catch { skipped++; continue; }
    try {
      interp = ownAttackBlocked(res.fullName!, cost, s.attackLabel, fragments);
    } catch { skipped++; continue; } // interpreter doesn't support some other op in the body
    compared++;
    if (native !== interp) {
      mismatches.push(`${s.printingId} ${s.attackLabel} (${s.name}): native blocked=${native}, interp blocked=${interp}`);
    }
  }

  /* eslint-disable no-console */
  it('reports the recharge-lock scorecard', () => {
    console.log(`\n  lock differential [attackShutoff recharge]: scenarios ${scenarios.length}, compared ${compared}, skipped ${skipped}, mismatches ${mismatches.length}`);
    mismatches.forEach(m => console.log(`   • ${m}`));
    expect(compared).toBeGreaterThan(0);
  });
  /* eslint-enable no-console */

  it('native and interpreted agree on the recharge lock', () => {
    expect(mismatches).toEqual([]);
  });
});

// `continuous.modifier { damageBuff | attackBaseDamageOverride }` on self with scope `ownNextAttack` —
// "during your next turn, this Pokémon's <attack> does +N / has base N." Invisible to the single-turn
// snapshot, so the interpreter previously no-op'd them. This is an OWN-turn DAMAGE probe (sibling of the
// recharge probe): use the setup attack, pass the opponent's turn, then re-attack on the lock user's own
// next turn and compare the landed damage. The interpreter reproduces the buff with the exact native
// prefabs (NEXT_TURN_ATTACK_BONUS / NEXT_TURN_ATTACK_BASE_DAMAGE), so a divergence is a real IR-vs-native
// amount/applicability discrepancy. (damageVulnerability is NOT probed: the only mapped case — Vibrava
// Screech — is a 0-damage setup, so the +N can't be observed by a re-attack; the damaging case, Stunfisk,
// is unmapped me2pt5.)
function ownNextAttackBuff(body: any[]): { kind: string; boostedLabel: string } | null {
  for (const op of body) {
    if (op.kind !== 'continuous.modifier') { continue; }
    const mod = op.modifier;
    if (!mod || (mod.kind !== 'damageBuff' && mod.kind !== 'attackBaseDamageOverride')) { continue; }
    if (op.appliesTo?.role === 'self' && op.scope === 'ownNextAttack'
      && typeof mod.attackName === 'string' && mod.amount?.kind === 'const') {
      return { kind: mod.kind, boostedLabel: mod.attackName };
    }
  }
  return null;
}

describe('Rotomancer lock differential — next-turn damage buffs (own-turn damage probe)', () => {
  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const allScenarios = JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Scenario[];
  const scenarios = allScenarios.filter(s => ownNextAttackBuff(s.body) !== null);
  const findScenario = (printingId: string, label: string) =>
    allScenarios.find(x => x.printingId === printingId && x.attackLabel === label);

  // Use the setup attack, pass the opponent's turn, then re-attack with the boosted attack on the lock
  // user's own next turn; return the boosted attack's landed damage (base + buff) or 'KO'. P2 gets a
  // Bidoof bench so an early KO can't end the game; enough energy for BOTH attacks is attached.
  function ownDamageProbe(s: Scenario, buff: { boostedLabel: string }, fragments: boolean): number | 'KO' {
    const res = resolvePrinting(s.printingId, s.name);
    const boosted = findScenario(s.printingId, buff.boostedLabel);
    const costStrs = s.cost.concat(boosted ? boosted.cost : []).filter(c => c.toUpperCase() !== 'FREE');
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: costStrs.map(energyToCard) }, deck: padDeck(10) },
      player2: { active: { card: res.fullName! }, bench: [{ card: 'Bidoof CRZ' }], deck: padDeck(10) },
    });
    if (fragments) {
      const frags: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
      if (boosted && buff.boostedLabel !== s.attackLabel) {
        frags.push({ label: boosted.attackLabel, cost: boosted.cost, body: boosted.body }); // boosted ≠ setup → need both
      }
      const native = game.state.players[0].active.cards[0];
      const interpreted = buildInterpretedCard(native, frags);
      interpreted.id = native.id;
      game.state.players[0].active.cards[0] = interpreted;
    }
    useAttack(game.store, game.state, 0, s.attackLabel); // setup attack → installs the buff, → P1's turn
    endTurn(game.store, game.state);                     // P1 passes → P0's own next turn
    const p1 = game.state.players[1];
    if (p1.active.getPokemonCard() === undefined) { return 'KO'; }
    const before = p1.active.damage;
    useAttack(game.store, game.state, 0, buff.boostedLabel); // boosted attack, now buffed
    if (p1.active.getPokemonCard() === undefined) { return 'KO'; }
    return p1.active.damage - before;
  }

  const mismatches: string[] = [];
  let compared = 0, skipped = 0;
  const byKind: Record<string, number> = { damageBuff: 0, attackBaseDamageOverride: 0 };

  for (const s of scenarios) {
    const buff = ownNextAttackBuff(s.body)!;
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skipped++; continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard) || card.weakness?.some(w => w.type === card.cardType)) { skipped++; continue; }

    let native: number | 'KO', interp: number | 'KO';
    try {
      native = ownDamageProbe(s, buff, false);
    } catch { skipped++; continue; }
    try {
      interp = ownDamageProbe(s, buff, true);
    } catch { skipped++; continue; } // interpreter doesn't support some op in the setup/boosted body
    compared++;
    byKind[buff.kind]++;
    if (native !== interp) {
      mismatches.push(`${s.printingId} ${s.attackLabel}→${buff.boostedLabel} (${s.name}): native dealt ${native}, interp dealt ${interp}`);
    }
  }

  /* eslint-disable no-console */
  it('reports the next-turn-buff scorecard', () => {
    console.log(`\n  lock differential [next-turn damage buff]: scenarios ${scenarios.length}, compared ${compared} (damageBuff ${byKind.damageBuff}, attackBaseDamageOverride ${byKind.attackBaseDamageOverride}), skipped ${skipped}, mismatches ${mismatches.length}`);
    mismatches.forEach(m => console.log(`   • ${m}`));
    expect(compared).toBeGreaterThan(0);
  });
  /* eslint-enable no-console */

  it('native and interpreted agree on the next-turn damage buff', () => {
    expect(mismatches).toEqual([]);
  });

  // Non-vacuity: the buff must actually fire on the own next turn (turn-2 damage = base + bonus), not be
  // a vacuous no-op. A hand-written self-buff: 20 base now, +60 to itself next turn.
  it('a damageBuff actually adds to the boosted attack on the own next turn', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon'); // mirror-safe, high HP (survives both hits)
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
      player2: { active: { card: res.fullName! }, bench: [{ card: 'Bidoof CRZ' }], deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [{ label: 'Pump', cost: ['Colorless'], body: [
      { kind: 'damage.deal', amount: { kind: 'const', value: 20 }, target: { of: { side: 'opponent', spot: 'active' } } },
      { kind: 'continuous.modifier', appliesTo: { role: 'self' }, scope: 'ownNextAttack',
        modifier: { kind: 'damageBuff', attackName: 'Pump', amount: { kind: 'const', value: 60 } } },
    ] }]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
    useAttack(game.store, game.state, 0, 'Pump');         // turn 1: 20 damage + install buff
    expect(game.state.players[1].active.damage).toBe(20);
    endTurn(game.store, game.state);                       // P1 passes → P0's next turn
    const before = game.state.players[1].active.damage;
    useAttack(game.store, game.state, 0, 'Pump');          // turn 2: 20 base + 60 buff = 80
    expect(game.state.players[1].active.damage - before).toBe(80);
  });

  // Non-vacuity for attackBaseDamageOverride (no mapped corpus card exercises it — Watchog rsv10pt5
  // name-mismatches — so verify the reproduction directly): a setup attack overrides a *different*
  // boosted attack's base next turn (50 → 100, an overwrite not an add).
  it('an attackBaseDamageOverride overwrites the boosted attack base on the own next turn', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const game = setupGame({
      turn: 2,
      player1: { active: { card: res.fullName!, energy: ['Water Energy SVE'] }, deck: padDeck(10) },
      player2: { active: { card: res.fullName! }, bench: [{ card: 'Bidoof CRZ' }], deck: padDeck(10) },
    });
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, [
      { label: 'Setup', cost: ['Colorless'], body: [
        { kind: 'continuous.modifier', appliesTo: { role: 'self' }, scope: 'ownNextAttack',
          modifier: { kind: 'attackBaseDamageOverride', attackName: 'Blast', amount: { kind: 'const', value: 100 } } },
      ] },
      { label: 'Blast', cost: ['Colorless'], body: [
        { kind: 'damage.deal', amount: { kind: 'const', value: 50 }, target: { of: { side: 'opponent', spot: 'active' } } },
      ] },
    ]);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
    useAttack(game.store, game.state, 0, 'Setup');        // turn 1: install the override for Blast (0 damage)
    expect(game.state.players[1].active.damage).toBe(0);
    endTurn(game.store, game.state);                       // P1 passes → P0's next turn
    const before = game.state.players[1].active.damage;
    useAttack(game.store, game.state, 0, 'Blast');         // turn 2: base 50 overwritten to 100
    expect(game.state.players[1].active.damage - before).toBe(100);
  });
});

// `rule.override { itemPlayRestriction }` on the opponent ("during your opponent's next turn, they can't
// play Item cards"). A play-a-card block probe (sibling of the retreat-block probe): run the lock attack,
// then on the opponent's turn attempt to play an Item and observe BLOCKED_BY_EFFECT. The interpreter
// installs the engine's central ATTACK_EFFECT_ITEM_LOCK marker on the opponent (playTrainerReducer
// enforces it); native item-lock cards produce the same observable, so the probe is mechanism-independent.
// (evolvePlayRestriction is NOT probed: the engine has no evolve-lock mechanism, and it's a single corpus
// card — Bronzong sv5-69 — so it stays a counted no-op.)
function itemPlayRestrictionOpponent(body: any[]): boolean {
  return body.some(op => op.kind === 'rule.override'
    && op.override?.kind === 'itemPlayRestriction'
    && op.override?.target?.side === 'opponent'
    && op.scope === 'opponentNextTurn');
}

function itemPlayBlocked(fullName: string, cost: string[], attackLabel: string, fragments: IrFragment[] | null): boolean {
  const game = setupGame({
    turn: 2,
    player1: { active: { card: fullName, energy: cost.map(energyToCard) }, deck: padDeck(10) },
    player2: { active: { card: fullName }, hand: ['Electric Generator PAF'], deck: padDeck(10) },
  });
  if (fragments) {
    const native = game.state.players[0].active.cards[0];
    const interpreted = buildInterpretedCard(native, fragments);
    interpreted.id = native.id;
    game.state.players[0].active.cards[0] = interpreted;
  }
  useAttack(game.store, game.state, 0, attackLabel); // P0's lock attack → P1's turn; locks P1's items

  const p1 = game.state.players[1];
  const item = p1.hand.cards.find(c => c.name === 'Electric Generator') as TrainerCard | undefined;
  if (!item) { throw new Error('item not in opponent hand'); } // → skipped by the caller's try/catch
  try {
    game.store.reduceEffect(game.state, new PlayItemEffect(p1, item));
    return false; // the item play was not blocked
  } catch (e) {
    return e instanceof GameError && e.message === GameMessage.BLOCKED_BY_EFFECT;
  }
}

describe('Rotomancer lock differential — itemPlayRestriction (play-block probe)', () => {
  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Scenario[])
    .filter(s => itemPlayRestrictionOpponent(s.body));

  const mismatches: string[] = [];
  let compared = 0, skipped = 0;

  for (const s of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') { skipped++; continue; }
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) { skipped++; continue; }

    const cost = s.cost.filter(c => c.toUpperCase() !== 'FREE');
    const fragments: IrFragment[] = [{ label: s.attackLabel, cost: s.cost, body: s.body }];
    let native: boolean, interp: boolean;
    try {
      native = itemPlayBlocked(res.fullName!, cost, s.attackLabel, null);
    } catch { skipped++; continue; }
    try {
      interp = itemPlayBlocked(res.fullName!, cost, s.attackLabel, fragments);
    } catch { skipped++; continue; } // interpreter doesn't support some other op in the body
    compared++;
    if (native !== interp) {
      mismatches.push(`${s.printingId} ${s.attackLabel} (${s.name}): native blocked=${native}, interp blocked=${interp}`);
    }
  }

  /* eslint-disable no-console */
  it('reports the item-lock scorecard', () => {
    console.log(`\n  lock differential [itemPlayRestriction]: scenarios ${scenarios.length}, compared ${compared}, skipped ${skipped}, mismatches ${mismatches.length}`);
    mismatches.forEach(m => console.log(`   • ${m}`));
    expect(compared).toBeGreaterThan(0);
  });
  /* eslint-enable no-console */

  it('native and interpreted agree on the item lock', () => {
    expect(mismatches).toEqual([]);
  });

  // Non-vacuity: the rider must actually block the opponent's Item play (and a control without it must
  // not), proving the reproduction installs the lock and the probe distinguishes blocked from not.
  it('the itemPlayRestriction rider blocks the opponent Item play (control does not)', () => {
    const res = resolvePrinting('sv8-116', 'Koraidon');
    expect(res.status).toBe('exact');
    const lock: IrFragment[] = [{ label: 'Jam', cost: ['Colorless'], body: [
      { kind: 'damage.deal', amount: { kind: 'const', value: 10 }, target: { of: { side: 'opponent', spot: 'active' } } },
      { kind: 'rule.override', scope: 'opponentNextTurn', override: { kind: 'itemPlayRestriction', target: { side: 'opponent', spot: 'active' } } },
    ] }];
    const control: IrFragment[] = [{ label: 'Jam', cost: ['Colorless'], body: [
      { kind: 'damage.deal', amount: { kind: 'const', value: 10 }, target: { of: { side: 'opponent', spot: 'active' } } },
    ] }];
    expect(itemPlayBlocked(res.fullName!, ['Colorless'], 'Jam', lock)).toBe(true);
    expect(itemPlayBlocked(res.fullName!, ['Colorless'], 'Jam', control)).toBe(false);
  });
});
