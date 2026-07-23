import { importState } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { SuperType } from '../../game/store/card/card-types';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';

/**
 * A ChooseCardsPrompt search that matches NO card is a WHIFF, not a fault. Love Ball twm ("Search your
 * deck for a Pokémon with the same name as your opponent's, …") raises `{min:1, max:1, allowCancel:true}`
 * but with a deck holding no matching Pokémon there are 0 eligible cards. The decomposer used to assemble
 * an empty `[]`, which fails `validate` against `min:1` → the driver threw `decomposed result failed
 * validate for prompt 'Choose cards'` (a 500, surfaced by seeding non-Pokémon Trainers into the census).
 * The correct resolution is CANCEL (null), which the prompt accepts iff `allowCancel` and which the card's
 * `selected || []` callback already treats as "found nothing".
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
function deck(tag: string, n: number): CardRef[] {
  const cards: CardRef[] = [];
  for (let i = 0; i < n; i++) { cards.push({ iid: `${tag}-d${i}`, printing: WATER }); }
  return cards;
}
function board(): NeutralState {
  const side = (tag: string): PlayerState =>
    player({ active: ralts(`${tag}-act`), deck: deck(tag, 4), prizes: [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }] });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: side('A'), B: side('B') },
  };
}

describe('Conformance — ChooseCardsPrompt empty-search whiff', () => {

  it('resolves a min:1 search that matches nothing as a whiff (null), not a validate fault', () => {
    const game = importState(board());
    const p = game.state.players[0];
    let received: any = 'unset';
    // deck is all Water Energy; a POKEMON filter matches nothing -> 0 eligible, min:1, allowCancel.
    game.store.prompt(game.state, new ChooseCardsPrompt(
      p, GameMessage.CHOOSE_CARD_TO_HAND, p.deck, { superType: SuperType.POKEMON },
      { min: 1, max: 1, allowCancel: true },
    ), selected => { received = selected; });

    // Must NOT throw "decomposed result failed validate"; the whiff auto-resolves and drives past.
    let res: ReturnType<typeof replay> | undefined;
    expect(() => { res = replay(game, []); }).not.toThrow();
    expect(received === null || (Array.isArray(received) && received.length === 0)).toBe(true);
    expect(res!.pending).not.toBeNull();
    expect(res!.pending!.descriptor).toBe('main'); // drove past to A's main-phase menu
  });
});
