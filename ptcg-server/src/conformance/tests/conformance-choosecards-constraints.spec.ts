import { importState, ImportedGame } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, WireLegalAction, NeutralAction,
  PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { SuperType, EnergyType } from '../../game/store/card/card-types';

/**
 * TA-204 / SD-14: the `choose-cards` menu enforced only COUNT, `blocked` and `filter`, while
 * `ChooseCardsPrompt.validate()` enforces sixteen further predicates — `differentTypes`,
 * `allowDifferentSuperTypes`, the basics-XOR-evolutions rule, and 13 category caps
 * (`maxPokemons`, `maxBasicEnergies`, `maxEnergies`, `maxTrainers`, `maxItems`, `maxStadiums`,
 * `maxSupporters`, `maxSpecialEnergies`, `maxTools`, `maxBasics`, `maxEvolutions`, `maxStage1`,
 * `maxStage2`).
 *
 * So the adapter advertised picks that made its own assembled result fail validation, which the
 * driver reports as `engineFault` → **HTTP 500**. Same failure shape as the `put-damage` `slots`
 * misread (Dragapult ex `asc-160`) and the third instance of SD-14's "menu does not mirror
 * validate()" class.
 *
 * Measured 2026-08-04 on Energy Search Pro `ssp-176` (*"Search your deck for up to 3 basic Energy
 * cards of different types"*), which passes `differentTypes: true`. Deck = 2 Fire + 2 Water:
 *
 *   after picking one Fire —  twinleaf offered the SECOND Fire; rotomancer offered only the Water
 *   taking that offer      —  twinleaf HTTP 500 `decomposed result failed validate`
 *
 * Defaults are permissive (`allowDifferentSuperTypes: true`, `differentTypes: false`, caps
 * `undefined`), so the gap only bites where a card opts in: 20 of 1504 `ChooseCardsPrompt`
 * constructions in `src/sets`, `differentTypes` dominating at 14.
 *
 * The constraints are all MONOTONE in the picked set, so "the extended set is already invalid" is
 * the exact offer test — a candidate refused here can never become legal later. The check calls the
 * prompt's own public `getCardType` rather than reimplementing it, so classification cannot drift.
 */

const FIRE = 'Fire Energy SVE';
const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT';

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

/** A deck of the given printings, iids d0..dN. */
function deck(...printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `d${i}`, printing }));
}

function board(deckCards: CardRef[]): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: ralts('a1'), deck: deckCards, prizes: [{ iid: 'A-pz', printing: WATER, faceUp: false }] }),
      B: player({ active: ralts('b1'), prizes: [{ iid: 'B-pz', printing: WATER, faceUp: false }] }),
    },
  };
}

/** Open a ChooseCardsPrompt over A's deck with the given options. */
function openPrompt(game: ImportedGame, options: object, filter: object = {}): void {
  const p = game.state.players[0];
  game.store.prompt(game.state, new ChooseCardsPrompt(
    p, GameMessage.CHOOSE_CARD_TO_HAND, p.deck, filter, options as never
  ), () => { /* result unused: this spec asserts the MENU */ });
}

/** The `choose` targets offered after driving `actions`. */
function offered(game: ImportedGame, actions: NeutralAction[] = []): string[] {
  const pending = replay(game, actions).pending;
  if (pending === null) {
    return [];
  }
  return (pending.legalActions as WireLegalAction[])
    .filter((a): a is Extract<WireLegalAction, { type: 'choose' }> => a.type === 'choose')
    .map(a => a.target);
}

const pick = (target: string): NeutralAction => ({ actor: 'A', type: 'choose', target } as NeutralAction);

const BASIC_ENERGY_FILTER = { superType: SuperType.ENERGY, energyType: EnergyType.BASIC };

describe('Conformance — choose-cards menu mirrors ChooseCardsPrompt.validate()', () => {

  describe('differentTypes (regression: Energy Search Pro ssp-176 → HTTP 500)', () => {

    it('a second card of an already-picked type is not offered', () => {
      const game = importState(board(deck(FIRE, FIRE, WATER, WATER)));
      openPrompt(game, { min: 0, max: 3, allowCancel: false, differentTypes: true }, BASIC_ENERGY_FILTER);

      expect(offered(game)).toEqual(['d0', 'd1', 'd2', 'd3']);   // nothing picked yet: all legal

      const afterFire = offered(game, [pick('d0')]);
      expect(afterFire).not.toContain('d1');                      // the defect: the second FIRE
      expect(afterFire).toContain('d2');                          // a different type is still legal
      expect(afterFire).toContain('d3');
    });

    it('without differentTypes the same board offers the duplicate — the fix must not over-filter', () => {
      const game = importState(board(deck(FIRE, FIRE, WATER, WATER)));
      openPrompt(game, { min: 0, max: 3, allowCancel: false }, BASIC_ENERGY_FILTER);

      expect(offered(game, [pick('d0')])).toContain('d1');
    });
  });

  describe('allowDifferentSuperTypes', () => {

    it('with it false, a card of a different superType is not offered once one is picked', () => {
      const game = importState(board(deck(FIRE, WATER, RALTS)));
      openPrompt(game, { min: 0, max: 3, allowCancel: false, allowDifferentSuperTypes: false });

      const after = offered(game, [pick('d0')]);
      expect(after).toContain('d1');        // ENERGY, same superType
      expect(after).not.toContain('d2');    // POKEMON, different superType
    });

    it('the permissive default still offers the mix', () => {
      const game = importState(board(deck(FIRE, WATER, RALTS)));
      openPrompt(game, { min: 0, max: 3, allowCancel: false });

      expect(offered(game, [pick('d0')])).toContain('d2');
    });
  });

  describe('category caps', () => {

    it('maxBasicEnergies stops offering basic Energy once the cap is reached', () => {
      const game = importState(board(deck(FIRE, WATER, RALTS)));
      openPrompt(game, { min: 0, max: 3, allowCancel: false, maxBasicEnergies: 1 });

      const after = offered(game, [pick('d0')]);
      expect(after).not.toContain('d1');    // a second basic Energy would exceed the cap
      expect(after).toContain('d2');        // the Pokemon is uncapped
    });

    it('maxPokemons stops offering Pokemon once the cap is reached', () => {
      const game = importState(board(deck(RALTS, RALTS, FIRE)));
      openPrompt(game, { min: 0, max: 3, allowCancel: false, maxPokemons: 1 });

      const after = offered(game, [pick('d0')]);
      expect(after).not.toContain('d1');
      expect(after).toContain('d2');
    });
  });
});
