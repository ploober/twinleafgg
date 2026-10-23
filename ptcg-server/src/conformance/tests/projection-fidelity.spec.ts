import { importState, ImportedGame } from '../state-adapter';
import { replay, projectGame } from '../driver';
import { assertProjectionMatchesState } from './support/projection-fidelity';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// Tier 1 (testing design doc §4): the projection faithfully reflects the raw engine State.
// Each scenario drives a mutation that pushes a different projected field off its default, then
// asserts the whole projection against the raw state. The four hardcoded-default fields are
// adjudicated separately at the bottom (confirmed gaps — no faithful engine source).

const PSY = 'Psychic Energy SVE';
const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT';   // Memory Skip [P]; retreat [C]
const KIRLIA = 'Kirlia SIT'; // Slap [P,C] 30 dmg, prompt-free; evolves from Ralts
const ALAKAZAM = 'Radiant Alakazam SIT'; // ability "Painful Spoons"
const ALTAR = 'Primordial Altar SIT';    // Stadium

function markers(played = 1): PokemonMarkers {
  return { playedOnTurn: played, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(over: Partial<PlayerFlags> = {}): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0,
    vstarUsed: false, ...over,
  };
}
interface PipOpts { energy?: CardRef[]; conditions?: ConditionToken[]; damage?: number; }
function pip(iid: string, printing: string, o: PipOpts = {}): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: o.energy ?? [], tools: [],
    damage: o.damage ?? 0, conditions: o.conditions ?? [], markers: markers(),
  };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState, over: Partial<NeutralState> = {}): NeutralState {
  const withDeck = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }],
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withDeck(A, 'A'), B: withDeck(B, 'B') }, ...over,
  };
}

/** Import, replay, and assert the projection matches the raw engine state. Returns the game. */
function check(initial: NeutralState, actions: NeutralAction[] = []): ImportedGame {
  const game = importState(initial);
  replay(game, actions);
  assertProjectionMatchesState(projectGame(game), game.state, game.ctx);
  return game;
}

describe('Tier 1 — projection matches raw State', () => {

  it('static rich board: damage, conditions, energy, stack, bench, zones, prizes+faceUp, flags', () => {
    check(board(
      player({
        active: pip('A-act', RALTS, { energy: [{ iid: 'e0', printing: PSY }, { iid: 'e1', printing: WATER }], conditions: ['poisoned'], damage: 20 }),
        bench: [pip('A-b0', RALTS)],
        hand: [{ iid: 'h0', printing: KIRLIA }, { iid: 'h1', printing: PSY }],
        deck: [{ iid: 'd0', printing: WATER }, { iid: 'd1', printing: PSY }, { iid: 'd2', printing: WATER }],
        discard: [{ iid: 'x0', printing: WATER }],
        prizes: [{ iid: 'pz0', printing: WATER, faceUp: false }, { iid: 'pz1', printing: PSY, faceUp: true }],
        flags: flags({ energyAttachedThisTurn: true, prizesTakenThisTurn: 1, prizesTakenLastTurn: 2 }),
      }),
      player({ active: pip('B-act', RALTS) }),
    ));
  });

  it('firstPlayer is echoed from initialState, not hardcoded: B-goes-first is preserved', () => {
    // Regression guard: the adapter used to project firstPlayer: 'A' unconditionally, so a state where
    // B went first was silently mis-reported. With B first and A active on turn 3, the projection must
    // preserve firstPlayer: 'B' (independent of activePlayer). check() also runs the fidelity helper.
    const game = check(board(
      player({ active: pip('A-act', RALTS) }),
      player({ active: pip('B-act', RALTS) }),
      { firstPlayer: 'B' },
    ));
    expect(projectGame(game).firstPlayer).toBe('B');
  });

  it('after attaching energy: energy flag + attached iid + hand shrink', () => {
    check(
      board(player({ active: pip('A-act', RALTS), hand: [{ iid: 'e', printing: PSY }] }), player({ active: pip('B-act', RALTS) })),
      [{ actor: 'A', type: 'attachEnergy', card: 'e', target: 'A-act' }],
    );
  });

  it('after retreating: retreat flag + promotion + discarded energy', () => {
    check(
      board(
        player({ active: pip('A-act', RALTS, { energy: [{ iid: 'e0', printing: PSY }] }), bench: [pip('A-b0', RALTS)] }),
        player({ active: pip('B-act', RALTS) }),
      ),
      [{ actor: 'A', type: 'retreat', to: 0 }],
    );
  });

  it('after a prompt-free attack: damage on the defender + turn flip + checkup', () => {
    check(
      board(
        player({ active: pip('A-act', KIRLIA, { energy: [{ iid: 'e0', printing: PSY }, { iid: 'e1', printing: WATER }] }) }),
        player({ active: pip('B-act', RALTS), deck: [{ iid: 'B-d', printing: WATER }] }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Slap' }],
    );
  });

  it('stadium board: stadium + owner', () => {
    check(board(
      player({ active: pip('A-act', RALTS) }),
      player({ active: pip('B-act', RALTS) }),
      { stadium: { iid: 'stad', printing: ALTAR, owner: 'B' } },
    ));
  });

  it('game over (deck-out): outcome + phase project correctly', () => {
    const initial = board(
      player({ active: pip('A-act', RALTS), deck: [{ iid: 'A-d', printing: WATER }] }),
      player({ active: pip('B-act', RALTS) }),
    );
    initial.players.B.deck = []; // force the deck-out (board() auto-fills empty decks)
    const game = check(initial, [{ actor: 'A', type: 'endTurn' }]);
    expect(projectGame(game).outcome).toBe('winA');
    expect(projectGame(game).phase).toBe('gameOver');
  });
});

describe('Tier 1 — deferred-default fields stay at their documented defaults (no faithful engine source)', () => {

  // Until 2026-10-23 this retreat stopped at the cost pending, so the promotion never happened and the -1 it asserted was
  // vacuous. B.25 (amended 2026-10-23) collapses the forced one-Energy payment, the retreat completes, and the marker is
  // the real turn of the move (CF-16 made the engine stamp it).
  it('movedToActiveOnTurn is the turn a retreat moved the benched Pokemon to the Active Spot', () => {
    const game = check(
      board(
        player({ active: pip('A-act', RALTS, { energy: [{ iid: 'e0', printing: PSY }] }), bench: [pip('A-b0', RALTS)] }),
        player({ active: pip('B-act', RALTS) }),
      ),
      [{ actor: 'A', type: 'retreat', to: 0 }],
    );
    expect(projectGame(game).players.A.active!.stack[0].iid).toBe('A-b0');
    expect(projectGame(game).players.A.active!.markers.movedToActiveOnTurn).toBe(3);
  });

  it('damageTakenThisTurn stays 0 after taking attack damage (engine field is damageTakenLastTurn — TODO candidate)', () => {
    const game = check(
      board(
        player({ active: pip('A-act', KIRLIA, { energy: [{ iid: 'e0', printing: PSY }, { iid: 'e1', printing: WATER }] }) }),
        player({ active: pip('B-act', RALTS), deck: [{ iid: 'B-d', printing: WATER }] }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Slap' }],
    );
    expect(projectGame(game).players.B.active!.markers.damageTakenThisTurn).toBe(0);
  });

  it('abilitiesUsedThisTurn carries the label after a once-per-turn ability whose re-use the engine refuses (G-59, derived from enforcement)', () => {
    const game = check(
      board(
        player({ active: pip('A-act', ALAKAZAM) }),
        player({ active: pip('B-act', RALTS, { damage: 20 }), bench: [pip('B-b0', RALTS)] }),
      ),
      [
        { actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Painful Spoons' },
        { actor: 'A', type: 'choose', target: 'B-act' },
        { actor: 'A', type: 'placeCounter', target: 'B-b0' },
        { actor: 'A', type: 'choose', target: 'B-act' },
        { actor: 'A', type: 'placeCounter', target: 'B-b0' },
      ],
    );
    expect(projectGame(game).players.A.active!.markers.abilitiesUsedThisTurn).toEqual(['Painful Spoons']);
  });

  it('cardsPlayedThisTurn stays 0 after playing several cards (no per-turn counter on Player)', () => {
    const game = check(
      board(
        player({ active: pip('A-act', RALTS), hand: [{ iid: 'b', printing: RALTS }, { iid: 'e', printing: PSY }] }),
        player({ active: pip('B-act', RALTS) }),
      ),
      [
        { actor: 'A', type: 'benchBasic', card: 'b' },
        { actor: 'A', type: 'attachEnergy', card: 'e', target: 'A-act' },
      ],
    );
    expect(projectGame(game).players.A.flags.cardsPlayedThisTurn).toBe(0);
  });
});
