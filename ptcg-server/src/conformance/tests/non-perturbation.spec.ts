import { importState } from '../state-adapter';
import { topLevelMenu } from '../legal-actions';
import { buildCapabilities } from '../capabilities';
import { NeutralState } from '../neutral-types';
import { snapshotRawState } from './support/raw-snapshot';
import { mulberry32, genBoard } from './support/generators';
import { materializeNeutral, BoardSpec } from './support/scenario-runner';

/**
 * Tier 4 — non-perturbation (testing design doc §7). `topLevelMenu` reduces five `Check*` effects on
 * the LIVE state to enumerate legal moves; the whole adapter rests on that being read-only. This pins
 * it: building the menu must not change the observable projection, must not leave an orphan prompt or
 * a stray log, and must be idempotent. (`buildCapabilities` takes no State, so it has nothing to
 * perturb — the design doc overstated it.)
 */

const L = 'Lightning Energy SVE';
const P = 'Psychic Energy SVE';

// Crafted boards that guarantee each Check* path fires (attack-cost/provided-energy/pokemon-attacks,
// retreat-cost, pokemon-powers); the fuzz seeds add breadth.
const CRAFTED: Array<{ name: string; board: BoardSpec }> = [
  { name: 'attack-ready', board: { turn: 3, players: {
    A: { active: { card: 'Raichu SIT', energy: [L] }, deck: [L] }, B: { active: { card: 'Ralts SIT' }, deck: [L] } } } },
  { name: 'retreat-ready', board: { turn: 3, players: {
    A: { active: { card: 'Ralts SIT', energy: [P] }, bench: [{ card: 'Rufflet SIT' }], deck: [P] }, B: { active: { card: 'Ralts SIT' }, deck: [P] } } } },
  { name: 'ability-ready', board: { turn: 3, players: {
    A: { active: { card: 'Kirlia SIT' }, hand: [P], deck: [P] }, B: { active: { card: 'Ralts SIT' }, deck: [P] } } } },
];

function boards(): Array<{ name: string; initial: NeutralState }> {
  const out = CRAFTED.map(c => ({ name: c.name, initial: materializeNeutral(c.board) }));
  for (let seed = 1; seed <= 25; seed++) {
    out.push({ name: `fuzz-${seed}`, initial: genBoard(mulberry32(seed)) });
  }
  return out;
}

describe('Conformance Tier 4 — non-perturbation (menu build is read-only)', () => {
  for (const { name, initial } of boards()) {
    it(`topLevelMenu does not perturb state: ${name}`, () => {
      const g = importState(initial);
      const before = snapshotRawState(g.state);
      const promptsBefore = g.state.prompts.length;
      const logsBefore = g.state.logs.length;

      const menu1 = topLevelMenu(g);

      // Observable projection unchanged (zones / damage / conditions / energy / tools / flags / hp).
      expect(snapshotRawState(g.state)).toEqual(before);
      expect(g.state.prompts.length).toBe(promptsBefore); // no orphan prompt raised by a query effect
      expect(g.state.logs.length).toBe(logsBefore);       // no stray log emitted

      // Idempotent: a second build yields the same menu and leaves the same state.
      const menu2 = topLevelMenu(g);
      expect(menu2).toEqual(menu1);
      expect(snapshotRawState(g.state)).toEqual(before);
    });
  }

  it('buildCapabilities takes no game State, so it cannot perturb one', () => {
    expect(buildCapabilities.length).toBe(0); // arity 0 — pure card-registry enumeration
  });
});
