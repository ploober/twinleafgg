import { importState } from '../state-adapter';
import { replay, step } from '../driver';
import { collectAllCardIds } from '../../sets/tests/card-test-helpers';
import { assertInvariants, withNoRandomness, stepChecked } from './support/invariants';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// Negative controls for the Foundations helpers (testing design doc §3): each helper must catch the
// thing it claims to catch, and pass on a clean in-scope replay.

const PSY = 'Psychic Energy SVE';
const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT';
const KIRLIA = 'Kirlia SIT'; // Slap [P,C] 30 dmg, prompt-free

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function pip(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const withPz = (ps: PlayerState, t: string): PlayerState =>
    ps.prizes.length ? ps : { ...ps, prizes: [{ iid: `${t}-pz`, printing: WATER, faceUp: false }] };
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withPz(A, 'A'), B: withPz(B, 'B') },
  };
}

const simpleBoard = () => board(
  player({ active: pip('A-act', RALTS), deck: [{ iid: 'A-d', printing: WATER }] }),
  player({ active: pip('B-act', RALTS), deck: [{ iid: 'B-d', printing: WATER }] }),
);
const attackBoard = () => board(
  player({ active: pip('A-act', KIRLIA, [{ iid: 'e0', printing: PSY }, { iid: 'e1', printing: WATER }]) }),
  player({ active: pip('B-act', RALTS), deck: [{ iid: 'B-d', printing: WATER }] }),
);

describe('Foundations — assertInvariants', () => {

  it('passes on a freshly imported valid board', () => {
    const game = importState(simpleBoard());
    expect(() => assertInvariants(game.state)).not.toThrow();
  });

  it('throws on a duplicate card id', () => {
    const game = importState(simpleBoard());
    game.state.players[0].deck.cards[0].id = game.state.players[0].active.cards[0].id;
    expect(() => assertInvariants(game.state)).toThrowError(/Duplicate card id/);
  });

  it('throws on damage that is not a multiple of 10', () => {
    const game = importState(simpleBoard());
    game.state.players[0].active.damage = 15;
    expect(() => assertInvariants(game.state)).toThrowError(/multiple of 10/);
  });

  it('conservation: passes when cards are conserved, throws when a card vanishes', () => {
    const game = importState(simpleBoard());
    const idsBefore = collectAllCardIds(game.state);
    replay(game, []); // no-op; nothing moves
    expect(() => assertInvariants(game.state, { idsBefore })).not.toThrow();

    game.state.players[0].deck.cards.pop(); // drop a card
    expect(() => assertInvariants(game.state, { idsBefore })).toThrowError(/not conserved/);
  });
});

describe('Foundations — withNoRandomness', () => {

  it('passes a clean in-scope attack (the stats-tracker Math.random is allow-listed)', () => {
    expect(() => withNoRandomness(() => {
      const game = importState(attackBoard());
      replay(game, [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Slap' }]);
    })).not.toThrow();
  });

  it('throws when game logic calls Math.random (a randomness leak)', () => {
    expect(() => withNoRandomness(() => { Math.random(); })).toThrowError(/randomness leak/);
  });

  it('restores Math.random afterwards (even on throw)', () => {
    const original = Math.random;
    try { withNoRandomness(() => { Math.random(); }); } catch { /* expected */ }
    expect(Math.random).toBe(original);
  });
});

describe('Foundations — stepChecked', () => {

  it('runs a turn with invariants checked and returns the canonical step response', () => {
    const initial = board(
      player({ active: pip('A-act', RALTS), hand: [{ iid: 'e', printing: PSY }], deck: [{ iid: 'A-d', printing: WATER }] }),
      player({ active: pip('B-act', RALTS), deck: [{ iid: 'B-d', printing: WATER }] }),
    );
    const actions: NeutralAction[] = [{ actor: 'A', type: 'attachEnergy', card: 'e', target: 'A-act' }];
    const checked = stepChecked(initial, actions);
    expect(checked).toEqual(step(initial, actions));
    expect(checked.status).toBe('awaitingAction');
  });
});
