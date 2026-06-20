import { step } from '../driver';
import { NeutralAction } from '../neutral-types';
import { mulberry32, genBoard, playRandomGame } from './support/generators';
import { stepChecked, withNoRandomness } from './support/invariants';
import { materializeNeutral, BoardSpec } from './support/scenario-runner';

/**
 * Tier 3 — seeded property/fuzz (testing design doc §6). For each fixed seed: generate a random valid
 * board, drive random *legal* play (the adapter's menu is the legal-move oracle) to a bounded depth,
 * then assert the properties that must hold for any in-scope game:
 *   - menu-legality: no menu-listed action is rejected by the engine, and nothing throws (no
 *     unsupported prompt escapes the curated pool + supported decomposers);
 *   - invariants + import determinism: `stepChecked` (Step A);
 *   - replay determinism: the same log replays to identical events + state, under `withNoRandomness`
 *     (no `Math.random` leaks onto the in-scope path).
 * Seeds are fixed, so runs are reproducible and CI-stable; new coverage = more seeds / deeper games.
 */

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const MAX_ACTIONS = 25;

describe('Conformance Tier 3 — seeded fuzz', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: legal, invariant, deterministic`, () => {
      const rng = mulberry32(seed);
      const initial = genBoard(rng);
      const gen = playRandomGame(initial, rng, MAX_ACTIONS);

      const repro = () => `seed=${seed} actions=${gen.log.length} backedOut=${gen.backedOut}\n${JSON.stringify({ initial, log: gen.log })}`;
      if (gen.error !== undefined) {
        throw new Error(`[fuzz] dispatch threw (out of supported seam?): ${gen.error.message}\n${repro()}`);
      }

      // Invariants + import determinism + replay determinism, with no randomness on the in-scope path.
      try {
        withNoRandomness(() => {
          const a = stepChecked(initial, gen.log);
          const b = stepChecked(initial, gen.log);
          expect(b.events).toEqual(a.events);
          expect(b.state).toEqual(a.state);
        });
      } catch (err) {
        throw new Error(`[fuzz] property failed: ${(err as Error).message}\n${repro()}`);
      }
    });
  }
});

// ── negative-space legality: an engine-illegal (but well-formed) action -> invalidAction, never a crash ──

const L = 'Lightning Energy SVE';

function oneActive(card: string, extra: Partial<BoardSpec['players']['A']> = {}): BoardSpec {
  return {
    turn: 3,
    players: {
      A: { active: { card }, deck: [L], ...extra },
      B: { active: { card: 'Ralts SIT' }, deck: [L] },
    },
  };
}

describe('Conformance Tier 3 — negative-space legality (rejection, not crash)', () => {

  it('an attack with insufficient energy is invalidAction', () => {
    const initial = materializeNeutral(oneActive('Raichu SIT')); // no energy attached
    const res = step(initial, [{ actor: 'A', type: 'declareAttack', source: 'A-act-s0', name: 'Ambushing Spark' }]);
    expect(res.status).toBe('invalidAction');
    expect(res.rejection).toBeDefined();
  });

  it('retreating with an empty bench is invalidAction', () => {
    const initial = materializeNeutral(oneActive('Ralts SIT'));
    const res = step(initial, [{ actor: 'A', type: 'retreat', to: 0 }]);
    expect(res.status).toBe('invalidAction');
    expect(res.rejection).toBeDefined();
  });

  it('declaring an attack the active does not have is invalidAction', () => {
    const initial = materializeNeutral(oneActive('Ralts SIT'));
    const res = step(initial, [{ actor: 'A', type: 'declareAttack', source: 'A-act-s0', name: 'No Such Attack' } as NeutralAction]);
    expect(res.status).toBe('invalidAction');
    expect(res.rejection).toBeDefined();
  });
});
