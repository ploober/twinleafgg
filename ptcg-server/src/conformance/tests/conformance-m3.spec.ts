import { importState } from '../state-adapter';
import { replay, step, projectGame } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';
import { ShuffleDeckPrompt } from '../../game/store/prompts/shuffle-prompt';

const PSY = 'Psychic Energy SVE';
const WATER = 'Water Energy SVE';
const LIGHT = 'Lightning Energy SVE';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function pip(iid: string, printing: string, energy: Array<{ iid: string; printing: string }> = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const withPrize = (ps: PlayerState, tag: string): PlayerState =>
    ps.prizes.length ? ps : { ...ps, prizes: [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }] };
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withPrize(A, 'A'), B: withPrize(B, 'B') },
  };
}

// Boards for the two coin-flip attackers, parameterized by the flip face.
function attackTurn(activeIid: string, printing: string, energy: Array<{ iid: string; printing: string }>): NeutralState {
  return board(
    player({ active: pip(activeIid, printing, energy), deck: [{ iid: 'A-d1', printing: WATER }] }),
    player({ active: pip('B-act', 'Ralts SIT'), deck: [{ iid: 'B-d1', printing: WATER }, { iid: 'B-d2', printing: WATER }] }),
  );
}

describe('Conformance M3 — the system actor (shuffle + coin flip)', () => {

  it('resolves a ShuffleDeckPrompt by applying the supplied order', () => {
    const game = importState(board(
      player({ active: pip('A-act', 'Ralts SIT'), deck: [{ iid: 'd0', printing: WATER }, { iid: 'd1', printing: PSY }, { iid: 'd2', printing: LIGHT }] }),
      player({ active: pip('B-act', 'Ralts SIT') }),
    ));
    const p = game.state.players[0];
    game.store.prompt(game.state, new ShuffleDeckPrompt(p.id), (order: number[]) => { p.deck.applyOrder(order); });

    const res = replay(game, [{ actor: 'system', type: 'shuffle', order: ['d2', 'd0', 'd1'] }]);
    expect(res.pending!.descriptor).toBe('main'); // shuffle resolved → A's main-phase menu (M5)
    expect(projectGame(game).players.A.deck.map(c => c.iid)).toEqual(['d2', 'd0', 'd1']);
  });

  it('surfaces a ShuffleDeckPrompt as a system pending when the order is not yet in the log', () => {
    const game = importState(board(
      player({ active: pip('A-act', 'Ralts SIT'), deck: [{ iid: 'd0', printing: WATER }, { iid: 'd1', printing: PSY }] }),
      player({ active: pip('B-act', 'Ralts SIT') }),
    ));
    const p = game.state.players[0];
    game.store.prompt(game.state, new ShuffleDeckPrompt(p.id), () => { /* noop */ });
    const pending = replay(game, []).pending!;
    expect(pending.actor).toBe('system');
    expect(pending.legalActions[0]).toEqual({ type: 'shuffle', deck: ['d0', 'd1'] });
  });

  it('inline coin flip (CoinFlipEffect): Pikachu Whimsy Tackle does 50 on heads, 0 on tails', () => {
    const energy = [{ iid: 'e0', printing: LIGHT }, { iid: 'e1', printing: WATER }, { iid: 'e2', printing: WATER }];

    const heads = step(attackTurn('A-act', 'Pikachu LOR', energy), [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Whimsy Tackle' },
      { actor: 'system', type: 'flip', face: 'heads' },
    ]);
    expect(heads.state.players.B.active!.damage).toBe(50);
    expect(heads.state.activePlayer).toBe('B'); // attack auto-ended the turn

    const tails = step(attackTurn('A-act', 'Pikachu LOR', energy), [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Whimsy Tackle' },
      { actor: 'system', type: 'flip', face: 'tails' },
    ]);
    expect(tails.state.players.B.active!.damage).toBe(0);
  });

  it('CoinFlipPrompt: Rufflet Jump On does 40 on heads, 10 on tails', () => {
    const energy = [{ iid: 'e0', printing: WATER }, { iid: 'e1', printing: WATER }];

    const heads = step(attackTurn('A-act', 'Rufflet SIT', energy), [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Jump On' },
      { actor: 'system', type: 'flip', face: 'heads' },
    ]);
    expect(heads.state.players.B.active!.damage).toBe(40);

    const tails = step(attackTurn('A-act', 'Rufflet SIT', energy), [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Jump On' },
      { actor: 'system', type: 'flip', face: 'tails' },
    ]);
    expect(tails.state.players.B.active!.damage).toBe(10);
  });

  it('surfaces a CoinFlipPrompt as a system pending when the flip is not yet in the log', () => {
    const energy = [{ iid: 'e0', printing: WATER }, { iid: 'e1', printing: WATER }];
    const res = step(attackTurn('A-act', 'Rufflet SIT', energy), [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Jump On' },
    ]);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.actor).toBe('system');
    expect(res.pending!.legalActions).toEqual([{ type: 'flip', face: 'heads' }, { type: 'flip', face: 'tails' }]);
  });

  it('replays coin-flip attacks deterministically', () => {
    const energy = [{ iid: 'e0', printing: LIGHT }, { iid: 'e1', printing: WATER }, { iid: 'e2', printing: WATER }];
    const actions: NeutralAction[] = [
      { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Whimsy Tackle' },
      { actor: 'system', type: 'flip', face: 'heads' },
    ];
    const a = step(attackTurn('A-act', 'Pikachu LOR', energy), actions);
    const b = step(attackTurn('A-act', 'Pikachu LOR', energy), actions);
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
  });
});
