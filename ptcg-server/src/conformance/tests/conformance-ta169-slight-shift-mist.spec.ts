import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-169: Elgyem blk-040 Slight Shift ("Move an Energy from 1 of your opponent's Pokémon to another of their
 * Pokémon.") offered every Energy on the opponent's side as a source, including the Energy on a Pokémon that Mist
 * Energy tef-161 protects ("Prevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this
 * card is attached to."). Compendium #2375: "If I use Elgyem's 'Slight Shift' attack, can I move a Mist Energy
 * attached to the Defending Pokemon onto a different Pokemon? -- No, you cannot." Answering such an offer moved nothing
 * (the MoveOpponentEnergyEffect is prevented), so the offer was inert (CF-33). The prefab now leaves out every source
 * whose move would be prevented, and asks nothing when no Energy can move.
 *
 * Moving an Energy ONTO the protected Pokémon is not adjudicated and is left as it was.
 */

const GRASS = 'sve-001';
const PSYCHIC = 'sve-005';
const MIST = 'tef-161';
const HOLDER = 'twm-118';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, GRASS).map(c => ({ ...c, faceUp: false }));
}
function board(activeEnergy: string[], benchEnergy: string[] = []): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'B', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', HOLDER, activeEnergy.map((p, i) => ({ iid: `a1e${i}`, printing: p }))),
        bench: [mon('a2', HOLDER, benchEnergy.map((p, i) => ({ iid: `a2e${i}`, printing: p }))), mon('a3', HOLDER)],
        deck: cards('ad', 6, GRASS), prizes: prizes('ap', 6),
      }),
      B: player({ active: mon('b1', 'blk-040', [{ iid: 'b1e0', printing: PSYCHIC }]), deck: cards('bd', 6, GRASS), prizes: prizes('bp', 6) }),
    },
  };
}

const shift = { actor: 'B', type: 'declareAttack', source: 'b1', name: 'Slight Shift' } as never;
const offeredMoves = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? [])
  .filter(a => a.type === 'moveEnergy')
  .map(a => { const m = a as { card?: string; source?: string; target?: string }; return `${m.card}:${m.source}->${m.target}`; })
  .sort();

describe('TA-169: Slight Shift does not offer an Energy on a Mist-protected Pokémon', () => {
  it('Mist Energy the only Energy in play: nothing offered, the Mist stays [TA-169]', () => {
    const r = step(board([MIST]), [shift]);
    expect(offeredMoves(r)).toEqual([]);
    expect(r.state.players.A.active?.energy.map(c => c.iid)).toEqual(['a1e0']);
  });

  it('a Basic Grass beside the Mist on the protected Active: nothing offered, both stay [TA-169]', () => {
    const r = step(board([MIST, GRASS]), [shift]);
    expect(offeredMoves(r)).toEqual([]);
    expect(r.state.players.A.active?.energy.map(c => c.iid)).toEqual(['a1e0', 'a1e1']);
  });

  it('Mist on the Active and a Basic Grass on an unprotected Benched Pokemon: only the Benched Energy is offered [TA-169]', () => {
    const r = step(board([MIST], [GRASS]), [shift]);
    expect(offeredMoves(r)).toEqual(['a2e0:a2->a1', 'a2e0:a2->a3']);
  });

  it('control: no Mist, a Basic Grass on the Active is offered to both Benched Pokemon [TA-169]', () => {
    const r = step(board([GRASS]), [shift]);
    expect(offeredMoves(r)).toEqual(['a1e0:a1->a2', 'a1e0:a1->a3']);
  });
});
