import { importState } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION,
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { SelectOptionPrompt } from '../../game/store/prompts/select-option-prompt';

/**
 * SelectOptionPrompt ('SelectOption', `Prompt<number>`) is a single-select branch chooser (Windstorm,
 * many "choose one" trainers). It decomposes to one `selectOption{option}` legalAction per non-disabled
 * index and resolves to the chosen index. `disabled[i]` options are omitted from the menu and rejected
 * if named. (Before this decomposer the driver threw 'prompt SelectOption has no decomposer'.)
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

const VALUES = ['Discard the Stadium and up to 1 Tool.', 'Discard up to 2 Tools.', 'Do nothing.'];

describe('Conformance — SelectOptionPrompt decomposer', () => {

  it('surfaces one selectOption legalAction per option (log dry mid-decision)', () => {
    const game = importState(board());
    const p = game.state.players[0];
    game.store.prompt(game.state, new SelectOptionPrompt(p.id, GameMessage.CHOOSE_OPTION, VALUES), () => { /* unresolved */ });

    const res = replay(game, []);
    expect(res.pending).not.toBeNull();
    expect(res.pending!.descriptor).toContain('SelectOption');
    expect(res.pending!.legalActions).toEqual([
      { actor: 'A', type: 'selectOption', option: 0 },
      { actor: 'A', type: 'selectOption', option: 1 },
      { actor: 'A', type: 'selectOption', option: 2 },
    ]);
  });

  it('resolves to the chosen index and drives past to the main menu', () => {
    const game = importState(board());
    const p = game.state.players[0];
    let picked: number | undefined;
    game.store.prompt(game.state, new SelectOptionPrompt(p.id, GameMessage.CHOOSE_OPTION, VALUES), choice => { picked = choice; });

    const res = replay(game, [{ actor: 'A', type: 'selectOption', option: 2 }]);
    expect(picked).toBe(2);                 // callback got the chosen index
    expect(res.pending).not.toBeNull();
    expect(res.pending!.descriptor).toBe('main'); // drove past to A's main-phase menu
  });

  it('omits disabled options from the menu and rejects a disabled/out-of-range pick', () => {
    const mk = () => {
      const game = importState(board());
      const p = game.state.players[0];
      game.store.prompt(
        game.state,
        new SelectOptionPrompt(p.id, GameMessage.CHOOSE_OPTION, VALUES, { disabled: [false, true, false] }),
        () => { /* unresolved */ });
      return game;
    };

    // disabled index 1 is not offered
    const menu = replay(mk(), []);
    expect(menu.pending!.legalActions).toEqual([
      { actor: 'A', type: 'selectOption', option: 0 },
      { actor: 'A', type: 'selectOption', option: 2 },
    ]);

    // naming the disabled index is a malformed log (contract violation) → hard throw
    expect(() => replay(mk(), [{ actor: 'A', type: 'selectOption', option: 1 }])).toThrowError(/disabled/);

    // out-of-range index likewise throws
    expect(() => replay(mk(), [{ actor: 'A', type: 'selectOption', option: 9 }])).toThrowError(/out of range/);
  });
});
