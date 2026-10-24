import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-766 — Heave-Ho Catcher meg-073 (Hariyama) and Cast-Off Shell meg-017 / meg-137 (Ninjask) are printed "Once during
 * your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability." Accepting
 * the "may" is the use (CF-77, TA-455), so the Pokémon's `abilitiesUsedThisTurn` carries the name afterwards, as Psychic
 * Draw meg-056 (Alakazam) does. Neither script marked the accepted use (and Ninjask's text lacked the once-per-turn
 * clause the projection keys on).
 * Mutation guard: drop ABILITY_USED from either card -> its cell reads [].
 */

/** The spec cell labels, literal so the registry can read them (one per printing and cell). */
const CELLS: Record<string, string> = {
  'meg-073': '[TA-766 meg-073]',
  'meg-073 declined': '[TA-766 meg-073 declined]',
  'meg-017': '[TA-766 meg-017]',
  'meg-017 declined': '[TA-766 meg-017 declined]',
  'meg-137': '[TA-766 meg-137]',
  'meg-137 declined': '[TA-766 meg-137 declined]',
};

const WATER = 'sve-003', FILLER = 'asc-004';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    flags: flags(), ...over,
  };
}
function state(A: PlayerState, B: PlayerState): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}


const CASES: Array<[string, string, string, string]> = [
  ['meg-073', 'meg-072', 'Heave-Ho Catcher', 'Hariyama'],
  ['meg-017', 'meg-016', 'Cast-Off Shell', 'Ninjask'],
  ['meg-137', 'meg-016', 'Cast-Off Shell', 'Ninjask'],
];

for (const [printing, basic, ability, name] of CASES) {
  describe(`TA-766 — ${ability} ${printing} (${name}) is marked used once accepted`, () => {
    const board = () => state(
      player('a', { active: pip([{ iid: 'a1s0', printing: basic }]), hand: [{ iid: 'ah0', printing }] }),
      player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]), bench: [pip([{ iid: 'bb1s0', printing: FILLER }])] }),
    );
    const evolve = { actor: 'A', type: 'evolve', card: 'ah0', target: 'a1s0' } as unknown as NeutralAction;
    it(`accepted: abilitiesUsedThisTurn is [${ability}] ${CELLS[printing + '']}`, () => {
      const r = step(board(), [evolve, { actor: 'A', type: 'confirm', value: true } as unknown as NeutralAction]);
      expect(r.status).not.toBe('invalidAction');
      expect(r.state.players.A.active?.markers.abilitiesUsedThisTurn).toEqual([ability]);
    });
    it(`declined: abilitiesUsedThisTurn stays [] ${CELLS[printing + ' declined']}`, () => {
      const r = step(board(), [evolve, { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction]);
      expect(r.status).not.toBe('invalidAction');
      expect(r.state.players.A.active?.markers.abilitiesUsedThisTurn).toEqual([]);
    });
  });
}

