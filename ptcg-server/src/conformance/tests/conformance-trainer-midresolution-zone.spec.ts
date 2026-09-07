import { importState, projectState } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * CF-42 — a Trainer mid-resolution has NO zone on the wire, and the adapter's workaround makes an
 * entire rules class undetectable.
 *
 * ## What the engine does (correct)
 *
 * Compendium **#919** (*Trainers in General*, WotC Chat 2000-03-02): *"first you pay the cost (if
 * any), then you resolve the effect of the Trainer card, then you discard that Trainer card."*
 * Three ordered steps — cost -> effect -> **discard**. So while a Supporter's own prompt is open the
 * card must NOT be in the discard pile; a card that reads its own discard mid-resolution (Tarragon
 * `por-116`, *"Put up to 4 ... from your discard pile into your hand"*) must not be able to retrieve
 * itself.
 *
 * twinleaf implements this correctly and GENERICALLY, in `play-trainer-effect.ts`:
 *   - the `TrainerEffect` reducer moves a Supporter hand -> `player.supporter` (not the discard);
 *   - `restorePlayedTrainerToPlayZoneIfNeeded` pulls it back out of the discard if a legacy card
 *     implementation discarded it eagerly while prompts are open;
 *   - `finalizeTrainerCleanup` defers `supporter -> discard` behind `store.waitPrompt`.
 * This holds for every Supporter regardless of what its own card file does — which is why the
 * card-file headcount that originally motivated TA-188 ("265 of 395 files use the zone") had no
 * bearing on the observable at all.
 *
 * ## What the wire USED to say (wrong, and blinding) — FIXED 2026-08-18
 *
 * The neutral DTO had no "resolving" zone, so `state-adapter.ts` surfaced the staged card inside
 * `discard`:  `discard: player.discard.cards.concat(player.supporter.cards)`.
 * Card conservation held, but the projected state asserted something #919 forbids.
 *
 * **The cost was a blind spot, not just a cosmetic lie.** Because the projection was the union of the
 * two zones, an engine that CORRECTLY defers the discard and an engine that WRONGLY discards early
 * produced a byte-identical projection. The harness could not detect a #919 violation in either
 * engine, by construction.
 *
 * **Schema 0.5.0 added `PlayerState.resolving` (CF-42) and this adapter now projects it.** The cell
 * at the bottom of this file is the one that matters: it used to assert that a correct engine and a
 * violating engine are INDISTINGUISHABLE, and it now asserts that they DIVERGE. Same board, same
 * mutation, opposite expectation — which is the only honest way to show a blind spot was closed
 * rather than merely described.
 *
 * Filed as CF-42 (contract). See also TA-188, which was filed against twinleaf on the strength of
 * the old projection and is WITHDRAWN — the engine was right and the harness was wrong.
 */

const BELLSPROUT = 'asc-004';
const IRIS = 'jtg-149';        // Iris's Fighting Spirit — opens a ChooseCardsPrompt during resolution
const WATER = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function basic(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function prize(tag: string): PrizeRef[] {
  return [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }];
}

function board(): NeutralState {
  const A: PlayerState = {
    active: basic('A-act', BELLSPROUT), bench: [],
    hand: [
      { iid: 'A-iris', printing: IRIS },
      { iid: 'A-h1', printing: WATER },
      { iid: 'A-h2', printing: WATER },
    ],
    deck: Array.from({ length: 10 }, (_, i) => ({ iid: `A-d${i}`, printing: WATER })),
    discard: [], lostZone: [], prizes: prize('A'), flags: flags(),
  };
  const B: PlayerState = {
    active: basic('B-act', BELLSPROUT), bench: [], hand: [],
    deck: [{ iid: 'B-d0', printing: WATER }],
    discard: [], lostZone: [], prizes: prize('B'), flags: flags(),
  };
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}

function playedMidPrompt() {
  const game = importState(board());
  replay(game, [{ actor: 'A', type: 'playSupporter', card: 'A-iris' } as any]);
  return game;
}

describe('Conformance — CF-42 Trainer mid-resolution has no wire zone', () => {

  it('an ITEM whose effect ends in a shuffle stays in player.supporter until the shuffle resolves — not self-discarded first [TA-378 tef-144]', () => {
    // #919: cost -> effect -> discard. Buddy-Buddy Poffin's effect is "search … put onto your Bench.
    // Then, shuffle your deck." — the shuffle IS the effect's last step. The card file discarded
    // itself BEFORE raising the ShuffleDeckPrompt (`player.supporter.moveCardTo(this, player.discard)`
    // one line above `new ShuffleDeckPrompt`), so at the shuffle pause the wire read discard=[poffin]
    // where rotomancer reads resolving=[poffin] (fuzz-20260904-enum `enum-asc-102`, 17 occ; Call Bell
    // ssp-165 2,183 occ). The generic finalizeTrainerCleanup already defers the discard behind
    // store.waitPrompt, which fires only when NO prompt is open — i.e. after the shuffle — so the
    // card-level early discard is both wrong and redundant.
    const POFFIN = 'tef-144';
    const A: PlayerState = {
      active: basic('A-act', BELLSPROUT), bench: [],
      hand: [{ iid: 'A-poffin', printing: POFFIN }, { iid: 'A-h1', printing: WATER }],
      deck: [{ iid: 'A-d0', printing: BELLSPROUT }, ...Array.from({ length: 6 }, (_, i) => ({ iid: `A-d${i + 1}`, printing: WATER }))],
      discard: [], lostZone: [], prizes: prize('A'), flags: flags(),
    };
    const B: PlayerState = {
      active: basic('B-act', BELLSPROUT), bench: [], hand: [], deck: [{ iid: 'B-d0', printing: WATER }],
      discard: [], lostZone: [], prizes: prize('B'), flags: flags(),
    };
    const st: NeutralState = {
      schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
      phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
    };
    // play, then take the first pick the search offers, until the system shuffle is the pending
    const acts: any[] = [{ actor: 'A', type: 'playItem', card: 'A-poffin' }];
    let game = importState(st);
    let r = replay(game, acts);
    for (let i = 0; i < 4 && r.pending && r.pending.actor !== 'system'; i++) {
      const a = r.pending.legalActions[0] as any;
      const ans: any = { actor: a.actor, type: a.type };
      for (const k of ['card', 'target', 'source', 'owner', 'to', 'index', 'cards', 'value']) { if (a[k] !== undefined) { ans[k] = a[k]; } }
      acts.push(ans);
      game = importState(st); r = replay(game, acts);
    }
    expect(r.pending?.actor).withContext('paused at the owed shuffle').toBe('system');
    const P = game.state.players[0];
    expect(P.supporter.cards.map(c => c.name)).withContext('engine: still staged').toEqual(['Buddy-Buddy Poffin']);
    expect(P.discard.cards.map(c => c.name)).withContext('engine: not yet discarded').toEqual([]);
    const proj = projectState(game.state, game.ctx).players.A;
    expect(proj.resolving?.map(c => c.printing)).toEqual([POFFIN]);
    expect(proj.discard.map(c => c.printing)).toEqual([]);
  });

  it('the ENGINE keeps a mid-resolution Supporter in player.supporter, not the discard (#919)', () => {
    const game = playedMidPrompt();
    const A = game.state.players[0];

    // Precondition: we really are paused inside the Supporter's own prompt.
    expect(game.state.prompts.length).toBe(1);

    expect(A.supporter.cards.map(c => c.name)).toEqual(['Iris\'s Fighting Spirit']);
    expect(A.discard.cards.map(c => c.name)).toEqual([]);
  });

  it('the PROJECTION now says it: staged in `resolving`, and NOT in the discard', () => {
    const game = playedMidPrompt();
    const A = projectState(game.state, game.ctx).players.A;

    expect(A.resolving?.map(c => c.printing)).toEqual([IRIS]);
    // The half that was inexpressible before the field. `discard` no longer over-reports.
    expect(A.discard.map(c => c.printing)).toEqual([]);
  });

  it('`resolving` is EMPTY, not absent, at a quiescent boundary', () => {
    // Load-bearing, and not a style choice. The harness compare is GATED on both engines projecting
    // the field: `[]` means "nothing staged", ABSENT means "does not model the distinction". An
    // engine that omitted the field when empty would read as the latter and the cross-engine compare
    // would switch itself off silently at exactly the boundaries where most states live.
    const game = importState(board());
    const A = projectState(game.state, game.ctx).players.A;
    expect(A.resolving).toEqual([]);
  });

  it('the staged card ROUND-TRIPS: export -> import -> export preserves the zone', () => {
    // Without ingest support the staged card would be silently DROPPED on re-import and card
    // conservation would break across the round trip — the same class of bug as the fold, moved.
    const game = playedMidPrompt();
    const once = projectState(game.state, game.ctx);
    const reimported = importState(once);
    const twice = projectState(reimported.state, reimported.ctx);

    expect(twice.players.A.resolving?.map(c => c.printing)).toEqual([IRIS]);
    expect(twice.players.A.discard.map(c => c.printing)).toEqual([]);
  });

  it('card conservation holds across the fold: the card is observable in exactly one place', () => {
    const game = playedMidPrompt();
    const st = projectState(game.state, game.ctx);
    const A = st.players.A;
    const zones = [A.hand, A.deck, A.discard, A.lostZone, A.resolving ?? []].map(z => z.map(c => c.printing));
    const seen = zones.reduce((n, z) => n + z.filter(p => p === IRIS).length, 0);

    expect(seen).toBe(1);
  });

  it('a #919 violation is now DETECTABLE: correct-defer and wrong-early-discard project differently', () => {
    // ⚠️ THIS CELL IS THE INVERSE OF ITS FORMER SELF, deliberately. It used to end
    // `expect(violating).toEqual(correct)` — the blind spot demonstrated rather than asserted. Same
    // board, same mutation, opposite expectation. A blind spot is only shown to be CLOSED by taking
    // the exact input that used to be invisible and watching it become visible.
    const game = playedMidPrompt();
    const A = game.state.players[0];
    const correct = projectState(game.state, game.ctx).players.A;

    // Simulate an engine that WRONGLY discards the Trainer before resolving it (the #919 violation),
    // by moving the staged card into the discard pile ourselves. In-memory only; nothing is edited.
    A.supporter.moveTo(A.discard);
    const violating = projectState(game.state, game.ctx).players.A;

    expect(violating.discard.map(c => c.printing)).toEqual([IRIS]);
    expect(violating.resolving ?? []).toEqual([]);
    expect(correct.discard.map(c => c.printing)).toEqual([]);
    expect(correct.resolving?.map(c => c.printing)).toEqual([IRIS]);

    // The projections now differ, which is the whole point of the field.
    expect(JSON.stringify(violating)).not.toEqual(JSON.stringify(correct));
  });
});
