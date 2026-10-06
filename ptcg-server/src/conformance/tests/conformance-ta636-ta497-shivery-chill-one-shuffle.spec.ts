import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * Chien-Pao ex pal-061 Shivery Chill: "Once during your turn, if this Pokémon is in the Active Spot, you may search your
 * deck for up to 2 Basic [Water] Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
 * TA-636: the shuffle was raised inside a loop over the player's Pokémon, so with one Benched Pokémon the deck was
 * shuffled twice. TA-497: taking 0 cards returned before the shuffle.
 */

const W = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, W).map(c => ({ ...c, faceUp: false }));
}
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: mon('a1', 'pal-061'), bench: [mon('ab1', 'asc-004')], deck: cards('ad', 6, W), prizes: prizes('ap', 6) }),
      B: player({ active: mon('b1', 'asc-004'), deck: cards('bd', 6, W), prizes: prizes('bp', 6) }),
    },
  };
}

const use = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Shivery Chill' } as never;
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as never);
const stop = { actor: 'A', type: 'confirm', value: false } as never;
const shuffles = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []).filter(a => a.type === 'shuffle') as Array<{ deck?: string[] }>;
const answer = (r: ReturnType<typeof step>) => ({ actor: 'system', type: 'shuffle', order: shuffles(r)[0]?.deck ?? [] } as never);

describe('TA-636 / TA-497: Chien-Pao ex pal-061 Shivery Chill shuffles once', () => {
  it('one pick then stop: one shuffle, then A is back at the main menu [TA-636]', () => {
    const acts = [use, choose('ad0'), stop];
    const atShuffle = step(board(), acts);
    expect(shuffles(atShuffle).length).toBe(1);
    const r = step(board(), [...acts, answer(atShuffle)]);
    expect(shuffles(r).length).toBe(0);
    expect(r.pending?.actor).toBe('A');
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ad0']);
  });

  it('taking 0 cards still shuffles once [TA-497]', () => {
    const atShuffle = step(board(), [use, stop]);
    expect(shuffles(atShuffle).length).toBe(1);
    const r = step(board(), [use, stop, answer(atShuffle)]);
    expect(shuffles(r).length).toBe(0);
    expect(r.state.players.A.hand.length).toBe(0);
  });
});
