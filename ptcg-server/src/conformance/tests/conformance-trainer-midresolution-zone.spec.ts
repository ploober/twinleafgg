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
 * ## What the wire says (wrong, and blinding)
 *
 * The neutral DTO has no "resolving" zone, so `state-adapter.ts` surfaces the staged card inside
 * `discard`:  `discard: player.discard.cards.concat(player.supporter.cards)`.
 * Card conservation holds, but the projected state asserts something #919 forbids.
 *
 * **The cost is a blind spot, not just a cosmetic lie.** Because the projection is the union of the
 * two zones, an engine that CORRECTLY defers the discard and an engine that WRONGLY discards early
 * produce a byte-identical projection. The harness therefore cannot detect a #919 violation in
 * either engine, by construction. That is what these specs pin.
 *
 * Filed as CF-42 (contract). See also TA-188, which was filed against twinleaf on the strength of
 * this projection and is WITHDRAWN — the engine was right and the harness was wrong.
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

  it('the ENGINE keeps a mid-resolution Supporter in player.supporter, not the discard (#919)', () => {
    const game = playedMidPrompt();
    const A = game.state.players[0];

    // Precondition: we really are paused inside the Supporter's own prompt.
    expect(game.state.prompts.length).toBe(1);

    expect(A.supporter.cards.map(c => c.name)).toEqual(['Iris\'s Fighting Spirit']);
    expect(A.discard.cards.map(c => c.name)).toEqual([]);
  });

  it('the PROJECTION folds it into discard — the documented workaround, pinned so it cannot drift silently', () => {
    const game = playedMidPrompt();
    const projected = projectState(game.state, game.ctx).players.A.discard.map(c => c.printing);

    // If this ever stops being true, the DTO gained a real zone (or the fold was removed) and CF-42
    // should be revisited — including the twinleaf/rotomancer wire agreement it currently manufactures.
    expect(projected).toEqual([IRIS]);
  });

  it('card conservation holds across the fold: the card is observable in exactly one place', () => {
    const game = playedMidPrompt();
    const st = projectState(game.state, game.ctx);
    const A = st.players.A;
    const zones = [A.hand, A.deck, A.discard, A.lostZone].map(z => z.map(c => c.printing));
    const seen = zones.reduce((n, z) => n + z.filter(p => p === IRIS).length, 0);

    expect(seen).toBe(1);
  });

  it('the fold makes a #919 violation undetectable: correct-defer and wrong-early-discard project identically', () => {
    const game = playedMidPrompt();
    const A = game.state.players[0];
    const correct = projectState(game.state, game.ctx).players.A.discard.map(c => c.printing);

    // Simulate an engine that WRONGLY discards the Trainer before resolving it (the #919 violation),
    // by moving the staged card into the discard pile ourselves. In-memory only; nothing is edited.
    A.supporter.moveTo(A.discard);
    const violating = projectState(game.state, game.ctx).players.A.discard.map(c => c.printing);

    // Byte-identical. This is the blind spot, demonstrated rather than asserted.
    expect(violating).toEqual(correct);
  });
});
