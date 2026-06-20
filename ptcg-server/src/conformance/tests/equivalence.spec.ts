import { runScenario, Scenario } from './support/scenario-runner';

/**
 * Tier 2 — native-vs-adapter equivalence (testing design doc §5). Each scenario is authored once and
 * materialized two ways — the conformance adapter (`importState`→`replay`) and the engine's own
 * canonical headless driver (`setupGame` + `card-test-helpers`). `runScenario` asserts:
 *   1. Import fidelity — the freshly-built raw engine states are structurally identical (a deep diff
 *      that includes fields the projection ignores: `isPublic`/`isSecret`, `hp`, flag counters …),
 *      catching a non-canonical `importState`.
 *   2. Replay fidelity — after driving the steps, the canonicalized neutral projections are identical,
 *      proving the adapter's dispatch path lands where the engine's own driver lands.
 * Plus the Step A physical invariants on both post-action states, under `withNoRandomness`.
 *
 * Scope = robust core: prompt-free / deterministic only (no native auto-resolver alignment). Boards
 * stay in the intersection both builders express; conditions / stadium-in-play arise via actions.
 * Deferred to Step C (Tier 3 fuzz, which feeds decomposer follow-ups systematically): KO→promote,
 * mixed-energy retreat, and once-per-turn abilities (no in-scope ability is prompt-free — e.g.
 * Dynamotor raises pick prompts).
 */

const L = 'Lightning Energy SVE';
const W = 'Water Energy SVE';
const P = 'Psychic Energy SVE';

describe('Conformance Tier 2 — native-vs-adapter equivalence', () => {

  // ── import fidelity: static boards, no actions ──

  it('static rich board: multi-slot, energies, tool, damage, deck order, discard, asymmetric prizes', () => {
    const scenario: Scenario = {
      name: 'static-rich',
      board: {
        turn: 2,
        players: {
          A: {
            active: { card: 'Raichu SIT', energy: [L], damage: 20, tools: ['Bravery Charm PAL'] },
            bench: [{ card: 'Ralts SIT', energy: [P] }, { card: 'Rufflet SIT' }],
            hand: ['Kirlia SIT', W],
            deck: [W, P, L],            // order is significant — checked exactly
            discard: [W],
            prizeCount: 3,
          },
          B: {
            active: { card: 'Ralts SIT' },
            bench: [{ card: 'Rufflet SIT', energy: [W] }],
            hand: [W],
            deck: [W, W],
            prizeCount: 6,
          },
        },
      },
      steps: [],
    };
    runScenario(scenario);
  });

  it('static minimal board: lone actives, empty benches, single prizes', () => {
    runScenario({
      name: 'static-minimal',
      board: {
        turn: 2,
        players: {
          A: { active: { card: 'Ralts SIT' }, deck: [W] },
          B: { active: { card: 'Ralts SIT' }, deck: [W] },
        },
      },
      steps: [],
    });
  });

  // ── replay fidelity: prompt-free drives ──

  it('bench a basic from hand', () => {
    runScenario({
      name: 'bench-basic',
      board: {
        turn: 2,
        players: {
          A: { active: { card: 'Ralts SIT' }, hand: ['Rufflet SIT'], deck: [W] },
          B: { active: { card: 'Ralts SIT' }, deck: [W] },
        },
      },
      steps: [{ kind: 'benchBasic', hand: 0 }],
    });
  });

  it('attach energy to the active', () => {
    runScenario({
      name: 'attach-energy',
      board: {
        turn: 2,
        players: {
          A: { active: { card: 'Ralts SIT' }, hand: [P], deck: [W] },
          B: { active: { card: 'Ralts SIT' }, deck: [W] },
        },
      },
      steps: [{ kind: 'attachEnergy', hand: 0, target: 'active' }],
    });
  });

  it('evolve the active (Ralts -> Kirlia)', () => {
    runScenario({
      name: 'evolve',
      board: {
        turn: 3, // turns 0–2 are "first turn" for evolution purposes (play-pokemon-effect.ts)
        players: {
          A: { active: { card: 'Ralts SIT' }, hand: ['Kirlia SIT'], deck: [W] },
          B: { active: { card: 'Ralts SIT' }, deck: [W] },
        },
      },
      steps: [{ kind: 'evolve', hand: 0, target: 'active' }],
    });
  });

  it('prompt-free attack: damage + auto-end + opponent draw (Raichu "Ambushing Spark")', () => {
    runScenario({
      name: 'attack-promptfree',
      board: {
        turn: 2,
        players: {
          A: { active: { card: 'Raichu SIT', energy: [L] }, deck: [W, W] },
          B: { active: { card: 'Ralts SIT' }, deck: [W, W] },
        },
      },
      steps: [{ kind: 'attack', name: 'Ambushing Spark' }],
    });
  });

  it('heads coin-flip attack via the system actor (Rufflet "Jump On")', () => {
    runScenario({
      name: 'coinflip-attack-heads',
      board: {
        turn: 2,
        players: {
          A: { active: { card: 'Rufflet SIT', energy: [W, W] }, deck: [W, W] },
          B: { active: { card: 'Ralts SIT' }, deck: [W, W] },
        },
      },
      steps: [{ kind: 'attack', name: 'Jump On' }, { kind: 'flip', face: 'heads' }],
    });
  });

  it('exact-energy retreat (single attached energy, no discard choice)', () => {
    runScenario({
      name: 'retreat-exact',
      board: {
        turn: 2,
        players: {
          A: {
            active: { card: 'Ralts SIT', energy: [P] }, // retreat cost [C] paid by the lone energy
            bench: [{ card: 'Rufflet SIT' }],
            deck: [W],
          },
          B: { active: { card: 'Ralts SIT' }, deck: [W] },
        },
      },
      steps: [{ kind: 'retreat', to: 0 }],
    });
  });

  it('play a stadium (Primordial Altar — placed, not used)', () => {
    runScenario({
      name: 'play-stadium',
      board: {
        turn: 2,
        players: {
          A: { active: { card: 'Ralts SIT' }, hand: ['Primordial Altar SIT'], deck: [W] },
          B: { active: { card: 'Ralts SIT' }, deck: [W] },
        },
      },
      steps: [{ kind: 'playStadium', hand: 0 }],
    });
  });

  it('deck-out at the start of the opponent turn ends the game (winA)', () => {
    runScenario({
      name: 'deckout',
      board: {
        turn: 2,
        players: {
          A: { active: { card: 'Ralts SIT' }, deck: [W] },
          B: { active: { card: 'Ralts SIT' }, deck: [] }, // B decks out on its forced draw
        },
      },
      steps: [{ kind: 'endTurn' }],
    });
  });

  it('multi-step: attach then end turn (crosses the turn boundary + opponent draw)', () => {
    runScenario({
      name: 'attach-then-endturn',
      board: {
        turn: 2,
        players: {
          A: { active: { card: 'Ralts SIT' }, hand: [P], deck: [W] },
          B: { active: { card: 'Ralts SIT' }, deck: [W, W] },
        },
      },
      steps: [{ kind: 'attachEnergy', hand: 0, target: 'active' }, { kind: 'endTurn' }],
    });
  });
});
