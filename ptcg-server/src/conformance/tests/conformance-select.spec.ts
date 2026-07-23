import { importState } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION,
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { SelectPrompt } from '../../game/store/prompts/select-prompt';

/**
 * SelectPrompt ('Select', `Prompt<number>`) is the twin of SelectOptionPrompt — a single-select branch
 * chooser cards raise for an in-effect "Choose 1: …" (e.g. Kieran ssp: switch, or +30 damage). It has no
 * per-index `disabled` mask; every value is selectable. It decomposes to one `selectOption{option}`
 * legalAction per index and resolves to the chosen index. Before the `select` decomposer the driver threw
 * `prompt 'Select' has no decomposer (out of scope)` — a 500 that silently defeated any card raising it
 * (surfaced first by seeding non-Pokémon Trainers into the enumeration census).
 */

const RALTS = 'Ralts SIT';
const WATER = 'Water Energy SVE';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function ralts(iid: string): PokemonInPlay {
  return { stack: [{ iid, printing: RALTS }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(): NeutralState {
  const side = (tag: string): PlayerState =>
    player({ active: ralts(`${tag}-act`), prizes: [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }] });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: side('A'), B: side('B') },
  };
}

const VALUES = ['Switch your Active Pokémon.', 'Your attacks do 30 more damage.'];

describe('Conformance — SelectPrompt decomposer', () => {

  it('surfaces one selectOption legalAction per option (log dry mid-decision)', () => {
    const game = importState(board());
    const p = game.state.players[0];
    game.store.prompt(game.state, new SelectPrompt(p.id, GameMessage.CHOOSE_OPTION, VALUES), () => { /* unresolved */ });

    const res = replay(game, []);
    expect(res.pending).not.toBeNull();
    expect(res.pending!.descriptor).toContain('Select');
    expect(res.pending!.legalActions).toEqual([
      { actor: 'A', type: 'selectOption', option: 0 },
      { actor: 'A', type: 'selectOption', option: 1 },
    ]);
  });

  it('resolves to the chosen index and drives past to the main menu', () => {
    const game = importState(board());
    const p = game.state.players[0];
    let picked: number | undefined;
    game.store.prompt(game.state, new SelectPrompt(p.id, GameMessage.CHOOSE_OPTION, VALUES), choice => { picked = choice; });

    const res = replay(game, [{ actor: 'A', type: 'selectOption', option: 1 }]);
    expect(picked).toBe(1);                        // callback got the chosen index
    expect(res.pending).not.toBeNull();
    expect(res.pending!.descriptor).toBe('main');  // drove past to A's main-phase menu
  });

  it('rejects an out-of-range pick', () => {
    const mk = () => {
      const game = importState(board());
      const p = game.state.players[0];
      game.store.prompt(game.state, new SelectPrompt(p.id, GameMessage.CHOOSE_OPTION, VALUES), () => { /* unresolved */ });
      return game;
    };
    expect(() => replay(mk(), [{ actor: 'A', type: 'selectOption', option: 9 }])).toThrowError(/out of range/);
  });
});
