import { importState } from '../state-adapter';
import { replay } from '../driver';
import { classify } from '../decomposers';
import { mapLog } from '../event-mapper';
import { NeutralState, NeutralAction } from '../neutral-types';
import { Prompt } from '../../game/store/prompts/prompt';
import { mulberry32, genBoard, playRandomGame } from './support/generators';
import { materializeNeutral, BoardSpec } from './support/scenario-runner';

const L = 'Lightning Energy SVE';
const W = 'Water Energy SVE';

// Crafted board that forces the KO -> prize -> promote seam (Raichu's 40 KOs a pre-damaged Ralts;
// both hold 6 prizes so the KO is non-terminal). Guarantees ChoosePrizePrompt/ChoosePokemonPrompt.
const KO_BOARD: BoardSpec = {
  turn: 3,
  players: {
    A: { active: { card: 'Raichu SIT', energy: [L] }, deck: [W, W, W], prizeCount: 6 },
    B: { active: { card: 'Ralts SIT', damage: 60 }, bench: [{ card: 'Rufflet SIT' }], deck: [W, W, W], prizeCount: 6 },
  },
};

interface Seams {
  prompts: Set<string>;
  mapped: Set<string>;
  dropped: Set<string>;
}

// GameLogs consumed by the SIGNIFICANT-event derivation (events.ts), not the informational mapLog.
// They are handled, not silently dropped — the seam guard counts them as mapped.
const SIGNIFICANT_LOGS = new Set<string>([
  'LOG_PLAYER_DRAWS_CARD', 'LOG_PLAYER_DEALS_DAMAGE', 'LOG_PLAYER_PLACES_DAMAGE_COUNTERS',
  'LOG_POKEMON_KO', 'LOG_PLAYER_ENDS_TURN', 'LOG_TURN',
]);

// Action types that ANSWER an open prompt (decomposer picks + system inputs). The open prompt at a
// frontier is always consumed by one of these, so we only re-import at those prefixes (top-level
// actions leave the synthetic menu, not a `state.prompts` entry) — far cheaper than every prefix.
const FOLLOWUP_TYPES = new Set<string>([
  'choose', 'takePrize', 'placeCounter', 'promoteBench', 'discard', 'shuffle', 'flip',
]);

/** Collect open prompt types (at follow-up frontiers) + every GameLog (from a full replay). */
function collectSeams(initial: NeutralState, log: NeutralAction[], s: Seams): void {
  for (let k = 0; k < log.length; k++) {
    if (!FOLLOWUP_TYPES.has(log[k].type)) { continue; } // no engine prompt is open before a top-level action
    const g = importState(initial);
    try {
      replay(g, log.slice(0, k));
    } catch {
      continue; // a prefix that splits an inline-flip attack from its flip throws — not prompt-observable
    }
    const open = g.state.prompts.find(p => p.result === undefined);
    if (open) { s.prompts.add(open.type); }
  }
  // GameLogs from a clean full replay (all inline flips present, so it never throws).
  const full = importState(initial);
  replay(full, log);
  for (const entry of full.state.logs) {
    const handled = mapLog(entry) !== undefined || SIGNIFICANT_LOGS.has(String(entry.message));
    (handled ? s.mapped : s.dropped).add(String(entry.message));
  }
}

function buildCorpus(): Array<{ name: string; initial: NeutralState; log: NeutralAction[] }> {
  const corpus: Array<{ name: string; initial: NeutralState; log: NeutralAction[] }> = [];
  for (let seed = 1; seed <= 25; seed++) {
    const rng = mulberry32(seed);
    const initial = genBoard(rng);
    corpus.push({ name: `fuzz-${seed}`, initial, log: playRandomGame(initial, rng, 25).log });
  }
  const koInitial = materializeNeutral(KO_BOARD);
  for (let seed = 1; seed <= 6; seed++) {
    const rng = mulberry32(7000 + seed);
    corpus.push({ name: `ko-${seed}`, initial: koInitial, log: playRandomGame(koInitial, rng, 25).log });
  }
  return corpus;
}

// Prompt types the corpus may raise that are intentionally NOT decomposed (deferred). Empty today —
// the in-scope pool + the M2/Step-C decomposers cover every prompt it raises. An entry here documents
// a deliberate gap; a NEW unsupported prompt (not listed) fails the test.
const ALLOW_UNSUPPORTED = new Set<string>([]);

// GameLogs intentionally not surfaced as neutral events (closed vocabulary; impl §4.8). Each is a
// game-state transition projected elsewhere, or UI/flip/transient narration with no event kind.
const ALLOW_UNMAPPED = new Set<string>([
  'LOG_GAME_FINISHED_WINNER',     // consumed by events.ts as gameOver.winner, not by the mapper
  'LOG_PLAYER_FLIPS_HEADS',       // coin faces are system-actor INPUTS, not observable output events
  'LOG_PLAYER_FLIPS_TAILS',
  'LOG_PLAYER_DISABLES_ATTACK',   // e.g. Memory Skip — effect narration, no event kind
  'LOG_PLAYER_NO_ACTIVE_POKEMON', // consumed by events.ts as gameOver.cause=noPokemonInPlay (KO transient)
  'LOG_PLAYER_NO_CARDS_IN_DECK',  // consumed by events.ts as gameOver.cause=deckOut (folded deckedOut)
  'LOG_PLAYER_NO_PRIZE_CARD',     // prize-state narration
]);
// LOG_PLAYER_PLAYS_STADIUM is now MAPPED to `stadiumPlayed` (event-vocabulary standardization), so it
// left this allow-list; LOG_PLAYER_HEALS_POKEMON is consumed by events.ts as the `healed` event.

// Floors so the guard cannot pass vacuously — the corpus must actually exercise these seams.
const FLOOR_PROMPTS = ['Choose prize', 'Coin flip', 'Choose cards', 'Choose attack', 'Choose energy', 'Choose pokemon'];
const FLOOR_MAPPED = ['LOG_PLAYER_USES_ATTACK', 'LOG_PLAYER_DEALS_DAMAGE', 'LOG_POKEMON_KO', 'LOG_TURN', 'LOG_PLAYER_RETREATS', 'LOG_PLAYER_USES_ABILITY'];

describe('Conformance Tier 4 — seam exhaustiveness', () => {
  const seams: Seams = { prompts: new Set(), mapped: new Set(), dropped: new Set() };

  beforeAll(() => {
    for (const game of buildCorpus()) { collectSeams(game.initial, game.log, seams); }
  });

  it('every prompt the corpus raises is classified — none silently unsupported', () => {
    const unsupported = [...seams.prompts]
      .filter(t => classify({ type: t } as Prompt<unknown>) === 'unsupported' && !ALLOW_UNSUPPORTED.has(t));
    expect(unsupported.sort()).toEqual([]);
  });

  it('every GameLog the corpus emits is mapped or allow-listed — none silently dropped', () => {
    const droppedBeyondAllow = [...seams.dropped].filter(g => !ALLOW_UNMAPPED.has(g));
    expect(droppedBeyondAllow.sort()).toEqual([]);
  });

  it('exercises the high-value prompt + event seams (guard is not vacuous)', () => {
    expect(FLOOR_PROMPTS.filter(p => !seams.prompts.has(p))).toEqual([]);
    expect(FLOOR_MAPPED.filter(m => !seams.mapped.has(m))).toEqual([]);
  });
});
