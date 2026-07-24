import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * CF-31 — a FORCED (`allowCancel:false`) prompt that reaches 0 eligible targets is a WHIFF the adapter
 * must resolve, not a 500. Salvatore `tef-160` ("Search your deck for a Pokémon … that evolves from 1 of
 * your Pokémon in play and put it on that Pokémon to evolve it") offers a searched Pokémon, then raises a
 * `Choose pokemon` (CHOOSE_POKEMON_TO_EVOLVE, allowCancel:false) to pick the in-play target; when the
 * searched card can't be placed on any in-play Pokémon there are 0 eligible targets. CF-29's cancelable
 * whiff→null path does NOT apply (allowCancel:false), so the driver used to throw `decomposed result
 * failed validate for prompt 'Choose pokemon'`. But the ENGINE itself whiffs there — Salvatore's callback
 * tolerates the empty selection (`targets.length === 0 -> shuffle+return`), so the game store never
 * crashes. The driver now dispatches the empty result and lets the store's own reducer decide.
 *
 * Surfaced by the varied-deck census: seeding a complete evolution line (Erika's Oddish → Gloom) into
 * every deck let Salvatore's search find a Pokémon that doesn't evolve from the in-play Pokémon.
 */

const BELLSPROUT = 'asc-004';  // Erika's Bellsprout (Basic; evolves into Erika's Weepinbell asc-005 → Salvatore is playable)
const ODDISH = 'asc-001';      // Erika's Oddish (Basic; NOT an evolution of Bellsprout → not a valid Salvatore target)
const SALVATORE = 'tef-160';
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
    active: basic('A-act', BELLSPROUT), bench: [], hand: [{ iid: 'A-sal', printing: SALVATORE }],
    deck: [{ iid: 'A-d0', printing: ODDISH }, { iid: 'A-d1', printing: WATER }, { iid: 'A-d2', printing: WATER }],
    discard: [], lostZone: [], prizes: prize('A'), flags: flags(),
  };
  const B: PlayerState = {
    active: basic('B-act', BELLSPROUT), bench: [], hand: [], deck: [{ iid: 'B-d0', printing: WATER }],
    discard: [], lostZone: [], prizes: prize('B'), flags: flags(),
  };
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}

describe('Conformance — CF-31 forced-prompt 0-eligible whiff (Salvatore evolve-target)', () => {
  it('plays Salvatore with no valid evolution target and whiffs cleanly, not a 500', () => {
    // Play Salvatore, then take the only offered search pick (the ineligible Oddish); the forced
    // Choose pokemon then has 0 eligible targets. Pre-CF-31 this threw "decomposed result failed validate".
    let res: ReturnType<typeof step> | undefined;
    expect(() => {
      res = step(board(), [
        { actor: 'A', type: 'playSupporter', card: 'A-sal' },
        { actor: 'A', type: 'choose', target: 'A-d0' },
      ]);
    }).not.toThrow();
    expect(res!.status).toBe('awaitingAction');
    // Salvatore whiffed: Bellsprout is still A's active (unevolved), and the Supporter was spent.
    expect(res!.state.players.A.active!.stack[0].printing).toBe(BELLSPROUT);
    expect(res!.state.players.A.flags.supporterPlayedThisTurn).toBe(true);
  });
});
